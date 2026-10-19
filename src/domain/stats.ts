/**
 * Estadísticas financieras. ÚNICA implementación de las fórmulas: el dashboard, la pantalla de movimientos, los
 * informes, el PDF y el CSV consumen estas funciones.
 *
 *   gasto neto  = gastos − devoluciones
 *   balance     = ingresos − gasto neto
 *
 * Las transferencias no cuentan como gasto ni como ingreso. Los movimientos con incidencias bloqueantes no se
 * suman en ningún total (se listan aparte). El balance NO es el saldo bancario.
 */

import type { CategoryIndex } from './categories'
import { type ISODate, addDays, daysBetweenInclusive } from './dates'
import { type Cents, changeBasisPoints, shareBasisPoints } from './money'
import { sortMovements } from './movements'
import { type Bucket, type Granularity, type Period, bucketIndex, buckets, granularityFor, inPeriod, previousPeriod } from './periods'
import { nameKey } from './text'
import { type CategoryKind, type Movement, isCounted } from './types'

export interface Totals {
  incomeCents: Cents
  expenseCents: Cents
  refundCents: Cents
  netExpenseCents: Cents
  balanceCents: Cents
  transferCents: Cents
  /** Movimientos incluidos en los totales (de cualquier tipo, transferencias incluidas). */
  countedCount: number
  incomeCount: number
  expenseCount: number
  refundCount: number
  transferCount: number
  /** Movimientos excluidos por incidencias bloqueantes. */
  excludedCount: number
}

export function computeTotals(list: Movement[]): Totals {
  const t: Totals = {
    incomeCents: 0,
    expenseCents: 0,
    refundCents: 0,
    netExpenseCents: 0,
    balanceCents: 0,
    transferCents: 0,
    countedCount: 0,
    incomeCount: 0,
    expenseCount: 0,
    refundCount: 0,
    transferCount: 0,
    excludedCount: 0,
  }
  for (const m of list) {
    if (!isCounted(m) || m.amountCents === null || m.kind === null) {
      t.excludedCount++
      continue
    }
    t.countedCount++
    switch (m.kind) {
      case 'income':
        t.incomeCents += m.amountCents
        t.incomeCount++
        break
      case 'expense':
        t.expenseCents += m.amountCents
        t.expenseCount++
        break
      case 'refund':
        t.refundCents += m.amountCents
        t.refundCount++
        break
      case 'transfer':
        t.transferCents += m.amountCents
        t.transferCount++
        break
    }
  }
  t.netExpenseCents = t.expenseCents - t.refundCents
  t.balanceCents = t.incomeCents - t.netExpenseCents
  return t
}

/** Importe con signo de un movimiento contado: gastos negativos; ingresos y devoluciones positivos; transferencias 0. */
export function signedCents(m: Movement): Cents | null {
  if (!isCounted(m) || m.amountCents === null) return null
  switch (m.kind) {
    case 'expense':
      return -m.amountCents
    case 'income':
    case 'refund':
      return m.amountCents
    case 'transfer':
      return 0
    default:
      return null
  }
}

export type CategoryRowStatus = 'active' | 'archived' | 'unknown' | 'none'

export interface CategoryRow {
  /** ID de categoría, `raw:<nombre>` si no está en el catálogo o `none` si no tiene. */
  key: string
  categoryId: string | null
  name: string
  color: string
  icon: string
  status: CategoryRowStatus
  kind: CategoryKind
  grossCents: Cents
  refundCents: Cents
  netCents: Cents
  count: number
  /** Parte del total en puntos básicos; `null` si no es significativa (total o importe no positivos). */
  shareBp: number | null
}

export const UNCATEGORIZED_KEY = 'none'

export interface CategoryKeyInfo {
  key: string
  categoryId: string | null
  name: string
  color: string
  icon: string
  status: CategoryRowStatus
}

/** Clave de agrupación de un movimiento por categoría. */
export function categoryKeyOf(m: Movement, categories: CategoryIndex): CategoryKeyInfo {
  const cat = categories.get(m.categoryId)
  if (cat) return { key: cat.id, categoryId: cat.id, name: cat.name, color: cat.color, icon: cat.icon, status: cat.status }
  if (m.categoryLink?.type === 'name') {
    return { key: `raw:${nameKey(m.categoryLink.name)}`, categoryId: null, name: m.categoryLink.name.trim(), color: 'stone', icon: 'tag', status: 'unknown' }
  }
  if (m.categoryLink?.type === 'id') {
    return { key: `raw:${m.categoryLink.id}`, categoryId: null, name: 'Categoría no encontrada', color: 'stone', icon: 'tag', status: 'unknown' }
  }
  return { key: UNCATEGORIZED_KEY, categoryId: null, name: 'Sin categoría', color: 'none', icon: 'circle-help', status: 'none' }
}

function groupByCategory(list: Movement[], categories: CategoryIndex, kind: CategoryKind, total: Cents): CategoryRow[] {
  const rows = new Map<string, CategoryRow>()
  for (const m of list) {
    if (!isCounted(m) || m.amountCents === null) continue
    const relevant = kind === 'expense' ? m.kind === 'expense' || m.kind === 'refund' : m.kind === 'income'
    if (!relevant) continue
    const info = categoryKeyOf(m, categories)
    let row = rows.get(info.key)
    if (!row) {
      row = { ...info, kind, grossCents: 0, refundCents: 0, netCents: 0, count: 0, shareBp: null }
      rows.set(info.key, row)
    }
    if (m.kind === 'refund') row.refundCents += m.amountCents
    else row.grossCents += m.amountCents
    row.count++
  }
  const out = [...rows.values()]
  for (const r of out) {
    r.netCents = r.grossCents - r.refundCents
    r.shareBp = shareBasisPoints(r.netCents, total)
  }
  // Mayor importe primero; empates por nombre para que el orden sea estable.
  return out.sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name, 'es'))
}

export interface TimelinePoint {
  bucket: Bucket
  expenseCents: Cents
  refundCents: Cents
  netExpenseCents: Cents
  incomeCents: Cents
}

export interface Timeline {
  granularity: Granularity
  points: TimelinePoint[]
  /** Hay al menos dos tramos con datos: tiene sentido dibujar una evolución. */
  meaningful: boolean
}

export function computeTimeline(list: Movement[], period: Period, granularity: Granularity = granularityFor(period)): Timeline {
  const bs = buckets(period, granularity)
  const points: TimelinePoint[] = bs.map((bucket) => ({ bucket, expenseCents: 0, refundCents: 0, netExpenseCents: 0, incomeCents: 0 }))
  for (const m of list) {
    if (!isCounted(m) || m.amountCents === null || !m.date) continue
    const i = bucketIndex(bs, m.date)
    if (i < 0) continue
    if (m.kind === 'expense') points[i].expenseCents += m.amountCents
    else if (m.kind === 'refund') points[i].refundCents += m.amountCents
    else if (m.kind === 'income') points[i].incomeCents += m.amountCents
  }
  for (const p of points) p.netExpenseCents = p.expenseCents - p.refundCents
  const withData = points.filter((p) => p.expenseCents || p.refundCents || p.incomeCents).length
  return { granularity, points, meaningful: withData >= 2 }
}

export interface Summary {
  period: Period
  totals: Totals
  expenseByCategory: CategoryRow[]
  incomeByCategory: CategoryRow[]
  timeline: Timeline
  /** Movimientos del periodo (contados y excluidos), más recientes primero. */
  movements: Movement[]
  excluded: Movement[]
  /** Gastos/ingresos/devoluciones contados sin categoría. */
  uncategorizedCount: number
  /** Movimientos contados cuya categoría no está en el catálogo. */
  unknownCategoryCount: number
}

export function movementsInPeriod(all: Movement[], period: Period): Movement[] {
  return all.filter((m) => inPeriod(period, m.date))
}

/** Movimientos sin fecha válida: no pertenecen a ningún periodo, se listan aparte. */
export function undatedMovements(all: Movement[]): Movement[] {
  return all.filter((m) => m.date === null)
}

export function summarize(all: Movement[], categories: CategoryIndex, period: Period): Summary {
  const list = sortMovements(movementsInPeriod(all, period))
  const totals = computeTotals(list)
  const expenseByCategory = groupByCategory(list, categories, 'expense', totals.netExpenseCents)
  const incomeByCategory = groupByCategory(list, categories, 'income', totals.incomeCents)
  return {
    period,
    totals,
    expenseByCategory,
    incomeByCategory,
    timeline: computeTimeline(list, period),
    movements: list,
    excluded: list.filter((m) => !isCounted(m)),
    uncategorizedCount: list.filter((m) => isCounted(m) && m.kind !== 'transfer' && categoryKeyOf(m, categories).status === 'none').length,
    unknownCategoryCount: list.filter((m) => isCounted(m) && categoryKeyOf(m, categories).status === 'unknown').length,
  }
}

export interface Comparison {
  /** Periodo anterior completo (para nombrarlo). */
  previousPeriod: Period
  /** Tramos realmente comparados: iguales a los periodos completos salvo si el actual está en curso. */
  currentRange: Period
  previousRange: Period
  /** `true` si el periodo actual está en curso y se compara hasta el mismo punto del anterior. */
  partial: boolean
  current: Totals
  previous: Totals
  /** Variaciones en puntos básicos; `null` cuando el periodo anterior no tiene base para comparar. */
  netExpenseChangeBp: number | null
  incomeChangeBp: number | null
  balanceDiffCents: Cents
}

/**
 * Comparación con el periodo anterior del mismo tipo. Si el periodo actual está en curso, se compara lo
 * transcurrido (del inicio a hoy) con el mismo número de días del anterior: comparar medio mes con un mes completo
 * sería engañoso. Devuelve `null` si el tramo anterior no tiene ningún movimiento contado.
 */
export function compareWithPrevious(all: Movement[], period: Period, asOf: ISODate): Comparison | null {
  const prev = previousPeriod(period)
  let currentRange = period
  let previousRange = prev
  const partial = asOf >= period.start && asOf < period.end
  if (partial) {
    const elapsed = daysBetweenInclusive(period.start, asOf)
    const prevEnd = addDays(prev.start, elapsed - 1)
    currentRange = { ...period, end: asOf }
    previousRange = { ...prev, end: prevEnd < prev.end ? prevEnd : prev.end }
  }
  const previous = computeTotals(movementsInPeriod(all, previousRange))
  if (previous.countedCount === 0) return null
  const current = computeTotals(movementsInPeriod(all, currentRange))
  return {
    previousPeriod: prev,
    currentRange,
    previousRange,
    partial,
    current,
    previous,
    netExpenseChangeBp: changeBasisPoints(current.netExpenseCents, previous.netExpenseCents),
    incomeChangeBp: changeBasisPoints(current.incomeCents, previous.incomeCents),
    balanceDiffCents: current.balanceCents - previous.balanceCents,
  }
}
