/**
 * IA local opcional (Ollama). Complementa al motor de reglas: solo se consulta para movimientos que las reglas no
 * resuelven, toda propuesta se valida igual que una elección manual y nada se escribe sin pasar por la revisión.
 */

import { type CategoryIndex, canAssign, categoryKindFor } from '../domain/categories'
import { type ClassificationProvider, type Proposal, validateSuggestion } from '../domain/classifier/pipeline'
import { type Rule, ruleMatches, suggestPattern } from '../domain/classifier/rules'
import { formatDecimal } from '../domain/money'
import { needsClassification } from '../domain/movements'
import { nameKey } from '../domain/text'
import { type Category, KIND_LABEL, type Movement, isCounted } from '../domain/types'
import type { AiHost } from '../infra/backend'
import { type AiStatus, LunarError, type LocalModel } from '../infra/contracts'

/** Modelos Gemma 3 del catálogo oficial de Ollama (tamaños de descarga verificados el 2026-10-19). */
export const MODEL_CATALOG = [
  { name: 'gemma3:1b', downloadBytes: 806_000_000, minMemoryGb: 4, label: 'Gemma 3 · 1B', note: 'ligero' },
  { name: 'gemma3:4b', downloadBytes: 3_400_000_000, minMemoryGb: 8, label: 'Gemma 3 · 4B', note: 'recomendado' },
  { name: 'gemma3:12b', downloadBytes: 8_200_000_000, minMemoryGb: 16, label: 'Gemma 3 · 12B', note: 'preciso, más lento' },
] as const

export type CatalogModel = (typeof MODEL_CATALOG)[number]

/** Confianza a partir de la cual una propuesta de la IA llega ya marcada en la revisión. */
export const AI_PRESELECT_CONFIDENCE = 0.85

/** Modelos instalados que sirven para texto: se descartan los de embeddings y los que no generan texto. */
export function suitableModels(models: LocalModel[]): LocalModel[] {
  return models
    .filter((m) => {
      const caps = m.capabilities
      if (caps.includes('embedding')) return false
      if (caps.length > 0 && !caps.includes('completion')) return false
      return !/embed|bert|minilm/i.test(`${m.name} ${m.family ?? ''}`)
    })
    .sort((a, b) => Number(b.family === 'gemma3') - Number(a.family === 'gemma3') || a.size - b.size)
}

/** Modelo a usar: el preferido si está instalado y es adecuado; si no, un Gemma 3 instalado; si no, otro adecuado. */
export function chooseModel(status: AiStatus | null, preferred: string | null): string | null {
  if (!status?.running) return null
  const ok = suitableModels(status.models)
  if (preferred && ok.some((m) => m.name === preferred)) return preferred
  return ok[0]?.name ?? null
}

/**
 * Modelo que se propone descargar según el equipo: el mayor del catálogo que cabe en memoria y en disco (con un
 * 20 % de margen). Sin datos del equipo se propone el ligero.
 */
export function recommendDownload(resources: AiStatus['resources']): CatalogModel {
  const ram = resources.totalMemoryBytes
  const disk = resources.freeDiskBytes
  if (ram == null || disk == null) return MODEL_CATALOG[0]
  const fits = MODEL_CATALOG.filter((m) => ram >= m.minMemoryGb * 1024 ** 3 * 0.9 && disk >= m.downloadBytes * 1.2)
  // El de 12B solo si sobra memoria: con 16 GB justos el de 4B responde mucho más rápido.
  const candidates = fits.filter((m) => m.name !== 'gemma3:12b' || ram >= 24 * 1024 ** 3)
  return candidates.at(-1) ?? MODEL_CATALOG[0]
}

export type AiState = 'unsupported' | 'not_installed' | 'stopped' | 'no_model' | 'ready' | 'error'

export function aiState(status: AiStatus | null, supported: boolean, model: string | null): AiState {
  if (!supported) return 'unsupported'
  if (!status) return 'error'
  if (!status.installed) return 'not_installed'
  if (!status.running) return 'stopped'
  if (status.error) return 'error'
  return model ? 'ready' : 'no_model'
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`
  return `${Math.round(bytes / 1e6).toLocaleString('es-ES')} MB`
}

/** Progreso real agregado de una descarga (suma de las capas que informa Ollama). */
export interface PullProgress {
  status: string
  completed: number
  total: number
}

export function aggregatePull(layers: Map<string, { completed: number; total: number }>, status: string): PullProgress {
  let completed = 0
  let total = 0
  for (const l of layers.values()) {
    completed += Math.min(l.completed, l.total)
    total += l.total
  }
  return { status, completed, total }
}

/** Proveedor de clasificación con Ollama para el pipeline (solo categorías activas y compatibles). */
export class OllamaProvider implements ClassificationProvider {
  readonly id = 'ai' as const
  readonly label: string
  private readonly ai: AiHost
  private readonly model: string

  constructor(ai: AiHost, model: string) {
    this.ai = ai
    this.model = model
    this.label = `IA (${model})`
  }

  async suggest(m: Movement, ctx: { categories: CategoryIndex }) {
    const wanted = categoryKindFor(m.kind)
    const options = ctx.categories.list.filter((c) => c.status === 'active' && (!wanted || c.kind === wanted) && canAssign(c, m).ok)
    if (options.length === 0) return null
    const s = await this.ai.classify(this.model, {
      description: m.description,
      amount: m.amountCents === null ? '' : formatDecimal(m.amountCents),
      kind: m.kind ? KIND_LABEL[m.kind] : '',
      paymentMethod: m.paymentMethod,
      categories: options.map((c) => ({ id: c.id, name: c.name })),
    })
    if (!s.categoryId) return null
    return { categoryId: s.categoryId, confidence: s.confidence, reason: s.reason }
  }
}

export interface AiReviewItem {
  movement: Movement
  proposal: Proposal
}

export interface AiBatchResult {
  items: AiReviewItem[]
  failures: { movementId: string; error: LunarError }[]
  /** Se detuvo antes de terminar (cancelado o Ollama dejó de responder). */
  stopped: boolean
}

/**
 * Pide propuesta a la IA solo para los elementos que las reglas no resolvieron. Valida cada respuesta; las
 * inválidas quedan como estaban. Se detiene si Ollama deja de responder o si se cancela.
 */
/**
 * Categoría mayoritaria con la que ya clasificaste descripciones parecidas (misma palabra significativa).
 * Sirve de segunda opinión: la confianza que declara el modelo no es fiable por sí sola.
 */
export function historyCategory(m: Movement, history: Movement[]): string | null {
  const key = suggestPattern(m.description)
  if (!key) return null
  const counts = new Map<string, number>()
  for (const h of history) {
    if (h.id === m.id || !h.categoryId || !isCounted(h)) continue
    if (suggestPattern(h.description) === key) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top && top[1] >= 2 ? top[0] : null
}

export async function proposeWithAi(
  items: AiReviewItem[],
  provider: ClassificationProvider,
  categories: CategoryIndex,
  rules: Rule[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
  history: Movement[] = [],
): Promise<AiBatchResult> {
  const out = [...items]
  const failures: AiBatchResult['failures'] = []
  const targets = items.map((it, i) => [it, i] as const).filter(([it]) => it.proposal.status !== 'proposed')
  let stopped = false
  for (const [n, [it, i]] of targets.entries()) {
    if (signal?.aborted) {
      stopped = true
      break
    }
    onProgress(n, targets.length)
    try {
      const s = await provider.suggest(it.movement, { categories, rules })
      if (s) {
        let p = validateSuggestion(it.movement, s, { categories, rules }, provider.label)
        const past = historyCategory(it.movement, history)
        if (p.status === 'proposed' && past && past !== p.categoryId) {
          // Contradice tu historial: se muestra, pero con confianza baja y sin marcar.
          p = { ...p, confidence: 'low', confidenceValue: Math.min(p.confidenceValue ?? 0, 0.5), reason: `${p.reason} · Tu historial: ${categories.get(past)?.name ?? '—'}` }
        }
        if (p.status === 'proposed') out[i] = { ...it, proposal: p }
        else failures.push({ movementId: it.movement.id, error: new LunarError({ code: 'validation', message: p.reason }) })
      } else {
        out[i] = { ...it, proposal: { ...it.proposal, reason: 'La IA no ve una categoría clara.' } }
      }
    } catch (e) {
      const err = LunarError.from(e)
      failures.push({ movementId: it.movement.id, error: err })
      if (err.code === 'offline' || err.code === 'not_found') {
        stopped = true
        break
      }
    }
  }
  onProgress(targets.length, targets.length)
  return { items: out, failures, stopped }
}

export function preselect(p: Proposal): boolean {
  if (p.status !== 'proposed') return false
  if (p.source !== 'ai') return true
  return p.confidenceValue !== undefined && p.confidenceValue >= AI_PRESELECT_CONFIDENCE
}

// ── Organización de categorías ───────────────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return dp[a.length][b.length]
}

function singular(k: string): string {
  return k.replace(/(es|s)$/, '')
}

export interface SimilarPair {
  a: Category
  b: Category
  reason: string
}

/** Posibles duplicados por el nombre (plurales, erratas). Determinista; la IA puede añadir sinónimos. */
export function findSimilarCategories(categories: Category[]): SimilarPair[] {
  const out: SimilarPair[] = []
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const a = categories[i]
      const b = categories[j]
      if (a.kind !== b.kind) continue
      const ka = nameKey(a.name)
      const kb = nameKey(b.name)
      if (singular(ka) === singular(kb)) out.push({ a, b, reason: 'Singular y plural' })
      else if (Math.min(ka.length, kb.length) >= 5 && levenshtein(ka, kb) <= 2) out.push({ a, b, reason: 'Nombres casi iguales' })
    }
  }
  return out
}

export interface RuleSuggestion {
  pattern: string
  category: Category
  count: number
}

/**
 * Descripciones repetidas que ya clasificas siempre igual y que ninguna regla cubre: candidatas a regla nueva.
 * Mínimo 3 movimientos y al menos el 80 % en la misma categoría.
 */
export function suggestRules(movements: Movement[], rules: Rule[], index: CategoryIndex): RuleSuggestion[] {
  const groups = new Map<string, Movement[]>()
  for (const m of movements) {
    if (!m.categoryId || !isCounted(m) || needsClassification(m)) continue
    const p = suggestPattern(m.description)
    if (!p || p.length < 3) continue
    const arr = groups.get(p) ?? []
    arr.push(m)
    groups.set(p, arr)
  }
  const out: RuleSuggestion[] = []
  for (const [pattern, list] of groups) {
    if (list.length < 3) continue
    if (list.some((m) => rules.some((r) => ruleMatches(r, m)))) continue
    const counts = new Map<string, number>()
    for (const m of list) counts.set(m.categoryId!, (counts.get(m.categoryId!) ?? 0) + 1)
    const [topId, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const category = index.get(topId)
    if (!category || category.status !== 'active' || top / list.length < 0.8) continue
    out.push({ pattern, category, count: list.length })
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 12)
}
