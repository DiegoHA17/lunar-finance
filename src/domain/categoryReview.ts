/**
 * Revisión global de las categorías escritas en los movimientos: nombres que no están en el catálogo (erratas,
 * plurales, nombres inventados) y variantes de escritura que ya se reconocen. Determinista y sin efectos: solo
 * propone; aplicar es un paso aparte que el usuario confirma.
 *
 * Criterio: una propuesta es «segura» solo si hay un único candidato y la diferencia es un plural o una errata de
 * una letra en un nombre largo. Todo lo demás es «dudosa» (requiere revisarla) o queda sin propuesta.
 */

import { type CategoryIndex, categoryKindFor } from './categories'
import { nameKey, words } from './text'
import { type Category, type CategoryKind, type Movement, isCounted } from './types'

export type ReviewLevel = 'safe' | 'doubtful' | 'none'
export type ProposalSource = 'plural' | 'spelling' | 'ai'

export interface ReviewProposal {
  categoryId: string
  source: ProposalSource
  reason: string
  /** 0–1. Estimada por la similitud del nombre o declarada por la IA. */
  confidence: number
}

export interface ReviewGroup {
  /** `tipo:nombre normalizado`. Estable entre revisiones mientras no cambien los datos. */
  key: string
  /** Variante escrita más frecuente. */
  name: string
  variants: string[]
  /** Tipo de categoría que admiten sus movimientos (`null`: movimientos sin tipo). */
  kind: CategoryKind | null
  movements: Movement[]
  proposal: ReviewProposal | null
  level: ReviewLevel
  /** Explicación cuando no hay propuesta o hay dudas (p. ej. varios candidatos). */
  note: string
  /** Categorías empatadas (casos ambiguos): el usuario elige. */
  candidates: string[]
}

/** Nombre escrito distinto del catálogo que ya se reconoce (mayúsculas, tildes, espacios): no hace falta tocarlo. */
export interface RecognizedVariant {
  written: string
  category: Category
  count: number
  difference: string
}

export interface CategoryReview {
  groups: ReviewGroup[]
  recognized: RecognizedVariant[]
  /** Movimientos con categoría desconocida que no admiten categoría (transferencias): se dejan como están. */
  skipped: number
}

/** Formas de una palabra sin plural: «ocios» → ocios, ocio; «devoluciones» → … devolucion. */
function wordForms(w: string): string[] {
  const out = [w]
  if (w.length > 3 && w.endsWith('s')) out.push(w.slice(0, -1))
  if (w.length > 4 && w.endsWith('es')) out.push(w.slice(0, -2))
  return out
}

/** ¿Solo difieren en singular/plural (palabra a palabra)? */
export function samePlural(a: string, b: string): boolean {
  const wa = words(a)
  const wb = words(b)
  if (wa.length !== wb.length || a === b) return false
  return wa.every((w, i) => {
    const fb = wordForms(wb[i])
    return wordForms(w).some((f) => fb.includes(f))
  })
}

/** Distancia de edición con transposiciones (Damerau-Levenshtein restringida). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

interface Match {
  category: Category
  source: 'plural' | 'spelling'
  distance: number
  /** Nombre o alias con el que coincide. */
  via: string
}

/** Mejor coincidencia de un nombre con una categoría (por nombre o alias). `null` si no se parecen lo suficiente. */
function matchOne(key: string, c: Category): Match | null {
  let best: Match | null = null
  for (const n of [c.name, ...c.aliases]) {
    const k = nameKey(n)
    if (!k) continue
    // Igual al normalizar: solo llega aquí si el nombre no se pudo resolver por empate entre varias categorías.
    if (k === key) return { category: c, source: 'spelling', distance: -1, via: n }
    if (samePlural(key, k)) return { category: c, source: 'plural', distance: 0, via: n }
    const len = Math.min(key.length, k.length)
    const max = len >= 8 ? 2 : len >= 4 ? 1 : 0
    // Sin dígitos distintos: «Gastos 2024» y «Gastos 2025» no son una errata.
    if (max === 0 || /\d/.test(key + k)) continue
    const dist = editDistance(key, k)
    if (dist <= max && (!best || dist < best.distance)) best = { category: c, source: 'spelling', distance: dist, via: n }
  }
  return best
}

function classify(key: string, candidates: Category[]): Pick<ReviewGroup, 'proposal' | 'level' | 'note' | 'candidates'> {
  const matches = candidates.map((c) => matchOne(key, c)).filter((m): m is Match => m !== null)
  if (matches.length === 0) return { proposal: null, level: 'none', note: 'No se parece a ninguna categoría del catálogo.', candidates: [] }
  matches.sort((a, b) => a.distance - b.distance)
  const top = matches.filter((m) => m.distance === matches[0].distance)
  if (top.length > 1) {
    return { proposal: null, level: 'doubtful', note: `Se parece a varias: ${top.map((m) => m.category.name).join(', ')}.`, candidates: top.map((m) => m.category.id) }
  }
  const m = top[0]
  const via = nameKey(m.via) === nameKey(m.category.name) ? '' : ` (alias «${m.via}»)`
  if (m.source === 'plural') {
    return { proposal: { categoryId: m.category.id, source: 'plural', reason: `Singular/plural de «${m.category.name}»${via}`, confidence: 0.95 }, level: 'safe', note: '', candidates: [] }
  }
  // Errata segura: una sola letra, nombre largo, misma inicial y ningún otro candidato cercano.
  const runnerUp = matches.find((x) => x !== m)
  if (m.distance === -1) {
    return { proposal: { categoryId: m.category.id, source: 'spelling', reason: `Coincide con «${m.category.name}»${via}`, confidence: 0.95 }, level: runnerUp ? 'doubtful' : 'safe', note: '', candidates: [] }
  }
  const safe = m.distance === 1 && key.length >= 5 && key[0] === nameKey(m.via)[0] && !runnerUp
  return {
    proposal: {
      categoryId: m.category.id,
      source: 'spelling',
      reason: `${m.distance === 1 ? 'Una letra' : 'Dos letras'} de diferencia con «${m.category.name}»${via}`,
      confidence: safe ? 0.9 : m.distance === 1 ? 0.7 : 0.55,
    },
    level: safe ? 'safe' : 'doubtful',
    note: safe ? '' : 'Nombres parecidos: compruébalo antes de aplicarlo.',
    candidates: [],
  }
}

function difference(written: string, name: string): string {
  const parts: string[] = []
  const a = written.replace(/\s+/g, ' ').trim()
  if (a !== written) parts.push('espacios')
  const strip = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '')
  const lower = (s: string) => s.toLocaleLowerCase('es')
  if (lower(a) !== lower(name) && lower(strip(a)) === lower(strip(name))) parts.push('tildes')
  if (strip(a) !== strip(name) && lower(strip(a)) === lower(strip(name))) parts.push('mayúsculas')
  if (parts.length === 0 && a !== name) parts.push('signos')
  return parts.join(', ')
}

function mostCommon(list: string[]): string {
  const counts = new Map<string, number>()
  for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0][0]
}

/**
 * Revisa todos los movimientos. Con catálogo de Notion, agrupa los nombres que no están en el catálogo y busca su
 * equivalente entre las categorías activas del mismo tipo. Sin catálogo (categorías implícitas), compara cada
 * variante minoritaria con la categoría implícita más usada que se le parezca.
 */
export function reviewCategories(movements: Movement[], index: CategoryIndex, catalog: 'notion' | 'implicit'): CategoryReview {
  const byGroup = new Map<string, { kind: CategoryKind | null; movements: Movement[]; written: string[]; ownId: string | null }>()
  const recognized = new Map<string, RecognizedVariant>()
  let skipped = 0
  const usage = new Map<string, number>()
  for (const m of movements) if (m.categoryId) usage.set(m.categoryId, (usage.get(m.categoryId) ?? 0) + 1)

  for (const m of movements) {
    if (m.categoryLink?.type !== 'name' || !isCounted(m)) continue
    const written = m.categoryLink.name
    const key = nameKey(written)
    if (!key) continue
    const cat = m.categoryId ? index.get(m.categoryId) : undefined
    const unknown = !cat
    const implicitSource = catalog === 'implicit' && cat?.source === 'implicit'
    if (cat && !implicitSource) {
      if (written !== cat.name && nameKey(cat.name) === key) {
        const k = `${cat.id}|${written}`
        const r = recognized.get(k) ?? { written, category: cat, count: 0, difference: difference(written, cat.name) }
        r.count++
        recognized.set(k, r)
      }
      continue
    }
    if (!unknown && !implicitSource) continue
    if (m.kind === 'transfer') {
      if (unknown) skipped++
      continue
    }
    const kind = categoryKindFor(m.kind)
    const gk = `${kind ?? 'any'}:${key}`
    const g = byGroup.get(gk) ?? { kind, movements: [], written: [], ownId: cat?.id ?? null }
    g.movements.push(m)
    g.written.push(written)
    byGroup.set(gk, g)
  }

  const groups: ReviewGroup[] = []
  for (const [gk, g] of byGroup) {
    const key = gk.slice(gk.indexOf(':') + 1)
    const pool = index.list.filter((c) => c.status === 'active' && (!g.kind || c.kind === g.kind))
    // Sin catálogo, solo se propone ir hacia una variante más usada (nunca al revés).
    const candidates = catalog === 'implicit' ? pool.filter((c) => c.id !== g.ownId && (usage.get(c.id) ?? 0) > g.movements.length) : pool
    const result = classify(key, candidates)
    // En modo implícito, una variante sin parecido con otra no es un problema: no se lista.
    if (catalog === 'implicit' && result.level === 'none') continue
    groups.push({ key: gk, name: mostCommon(g.written), variants: [...new Set(g.written)], kind: g.kind, movements: g.movements, ...result })
  }
  const order: Record<ReviewLevel, number> = { safe: 0, doubtful: 1, none: 2 }
  groups.sort((a, b) => order[a.level] - order[b.level] || b.movements.length - a.movements.length || a.name.localeCompare(b.name, 'es'))
  return { groups, recognized: [...recognized.values()].sort((a, b) => b.count - a.count), skipped }
}
