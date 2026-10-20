/**
 * Revisión global de categorías: segunda opinión de la IA local y aplicación de las correcciones confirmadas.
 *
 * - La IA solo recibe el nombre escrito, el tipo y los nombres del catálogo; su respuesta se valida contra las
 *   categorías activas y compatibles. Sus propuestas nunca son «seguras»: siempre requieren revisarlas.
 * - Aplicar cambia únicamente la propiedad de categoría de los movimientos seleccionados (ni siquiera el origen),
 *   uno a uno y con control de concurrencia; no crea, fusiona ni archiva categorías.
 */

import { type CategoryIndex, canAssign } from '../domain/categories'
import type { CategoryReview, ReviewGroup, ReviewProposal } from '../domain/categoryReview'
import { CATEGORY_KIND_LABEL, type Movement } from '../domain/types'
import type { AiHost } from '../infra/backend'
import { LunarError, type PageDto } from '../infra/contracts'
import { type WriteContext, updateMovement } from './movements'

export interface AiReviewResult {
  review: CategoryReview
  /** Grupos para los que la IA no dio una respuesta válida. */
  failures: number
  /** Se detuvo antes de terminar (cancelado, o Ollama dejó de responder / falta el modelo). */
  stopped: boolean
  error: LunarError | null
}

const pct = (n: number) => `${Math.round(n * 100)} %`

/**
 * Confianza mínima para que una opinión de la IA rellene la categoría propuesta. Por debajo solo se anota: con
 * `gemma3:4b` real, «Varios» → «Alimentación» llegó con 0,80.
 */
export const AI_MIN_PROPOSAL_CONFIDENCE = 0.85

/**
 * Consulta a la IA los grupos sin propuesta segura. Una propuesta de la IA solo se acepta si la categoría está en la
 * lista ofrecida (activa y del mismo tipo). Si contradice una propuesta por nombre, se mantiene la del nombre y se
 * anota la discrepancia.
 */
export async function reviewWithAi(
  review: CategoryReview,
  ai: AiHost,
  model: string,
  index: CategoryIndex,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AiReviewResult> {
  const groups = [...review.groups]
  const targets = groups.map((g, i) => [g, i] as const).filter(([g]) => g.level !== 'safe')
  let failures = 0
  let stopped = false
  let error: LunarError | null = null
  for (const [n, [g, i]] of targets.entries()) {
    if (signal?.aborted) {
      stopped = true
      break
    }
    onProgress(n, targets.length)
    const options = index.list.filter((c) => c.status === 'active' && (!g.kind || c.kind === g.kind))
    if (options.length === 0) continue
    try {
      const s = await ai.matchCategory(model, {
        name: g.name,
        kind: g.kind ? CATEGORY_KIND_LABEL[g.kind] : '—',
        categories: options.map((c) => ({ id: c.id, name: c.name })),
      })
      const valid = s.categoryId === null || options.some((c) => c.id === s.categoryId)
      if (!valid || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) {
        failures++
        continue
      }
      groups[i] = mergeAi(g, s.categoryId, s.confidence, s.reason, index)
    } catch (e) {
      const err = LunarError.from(e)
      failures++
      error = err
      if (err.code === 'offline' || err.code === 'not_found') {
        stopped = true
        break
      }
    }
  }
  onProgress(targets.length, targets.length)
  return { review: { ...review, groups }, failures, stopped, error }
}

function mergeAi(g: ReviewGroup, categoryId: string | null, confidence: number, reason: string, index: CategoryIndex): ReviewGroup {
  const said = reason.trim().slice(0, 160)
  if (categoryId === null) {
    return g.proposal ? { ...g, note: `${g.note} La IA no ve una equivalencia clara.`.trim() } : { ...g, note: 'La IA no ve una equivalencia clara.' }
  }
  const name = index.get(categoryId)?.name ?? '—'
  if (g.proposal) {
    if (g.proposal.categoryId === categoryId) {
      return { ...g, proposal: { ...g.proposal, reason: `${g.proposal.reason} · la IA coincide (${pct(confidence)})` } }
    }
    return { ...g, note: `${g.note} La IA propone «${name}».`.trim() }
  }
  // Caso ambiguo: la IA solo puede deshacer el empate eligiendo uno de los candidatos.
  if (g.candidates.length > 0 && !g.candidates.includes(categoryId)) return { ...g, note: `${g.note} La IA propone «${name}», que no es ninguno de ellos.` }
  if (confidence < AI_MIN_PROPOSAL_CONFIDENCE) return { ...g, note: `${g.note} La IA sugiere «${name}» con poca seguridad (${pct(confidence)}).`.trim() }
  const proposal: ReviewProposal = { categoryId, source: 'ai', reason: `IA: ${said || `equivale a «${name}»`}`, confidence }
  return { ...g, proposal, level: 'doubtful' }
}

// ── Aplicación ────────────────────────────────────────────────────────────────────────────────────────────────

export interface Correction {
  group: ReviewGroup
  /** Categoría de destino elegida (la propuesta o la que el usuario seleccionó a mano). */
  categoryId: string
}

export interface CorrectionOutcome {
  movement: Movement
  from: string
  to: string
  status: 'applied' | 'failed' | 'not_attempted'
  page?: PageDto
  error?: LunarError
}

const FATAL = ['offline', 'invalid_token', 'forbidden', 'no_token', 'rate_limited']

/**
 * Aplica las correcciones confirmadas, una a una. Antes de escribir comprueba que la categoría de destino sigue
 * existiendo, activa y compatible, y que el movimiento sigue sin categoría del catálogo. Un fallo no detiene el
 * resto salvo que sea de conexión o permisos; lo no intentado se informa como tal.
 */
export async function applyCorrections(
  ctx: WriteContext,
  corrections: Correction[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CorrectionOutcome[]> {
  const seen = new Set<string>()
  const work: { movement: Movement; from: string; categoryId: string }[] = []
  for (const c of corrections) {
    for (const m of c.group.movements) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      work.push({ movement: m, from: c.group.name, categoryId: c.categoryId })
    }
  }
  const out: CorrectionOutcome[] = []
  let halted: LunarError | null = null
  for (const [i, w] of work.entries()) {
    const target = ctx.index.get(w.categoryId)
    const base = { movement: w.movement, from: w.from, to: target?.name ?? '—' }
    if (halted || signal?.aborted) {
      out.push({ ...base, status: 'not_attempted', error: halted ?? new LunarError({ code: 'internal', message: 'Cancelado.' }) })
      continue
    }
    onProgress(i, work.length)
    const check = canAssign(target, w.movement)
    if (!check.ok) {
      out.push({ ...base, status: 'failed', error: new LunarError({ code: 'validation', message: target ? check.reason : 'La categoría de destino ya no existe.' }) })
      continue
    }
    if (w.movement.categoryId !== null && ctx.index.get(w.movement.categoryId)?.source === 'notion') {
      out.push({ ...base, status: 'failed', error: new LunarError({ code: 'conflict', message: 'El movimiento ya tiene una categoría del catálogo.' }) })
      continue
    }
    try {
      // Origen `null`: solo se escribe la propiedad de categoría.
      const page = await updateMovement(ctx, w.movement, { category: target! }, null)
      ctx.pages.set(page.id, page)
      out.push({ ...base, status: 'applied', page })
    } catch (e) {
      const err = LunarError.from(e)
      out.push({ ...base, status: 'failed', error: err })
      if (FATAL.includes(err.code)) halted = err
    }
  }
  onProgress(work.length, work.length)
  return out
}
