/**
 * Periodos de análisis. Todos son intervalos cerrados [start, end] de fechas de calendario.
 * El mismo módulo sirve al dashboard y a los informes: no hay otra definición de «mes» o «trimestre».
 */

import {
  type ISODate,
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  formatDateShort,
  isValidISODate,
  isoWeek,
  isoWeekday,
  makeDate,
  monthName,
  monthShort,
  parts,
} from './dates'

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year' | 'custom'

export interface Period {
  kind: PeriodKind
  start: ISODate
  end: ISODate
}

export function weekOf(date: ISODate): Period {
  const start = addDays(date, 1 - isoWeekday(date))
  return { kind: 'week', start, end: addDays(start, 6) }
}

export function monthPeriod(year: number, month: number): Period {
  return { kind: 'month', start: makeDate(year, month, 1), end: makeDate(year, month, daysInMonth(year, month)) }
}

export function quarterPeriod(year: number, quarter: number): Period {
  const firstMonth = (quarter - 1) * 3 + 1
  return { kind: 'quarter', start: makeDate(year, firstMonth, 1), end: makeDate(year, firstMonth + 2, daysInMonth(year, firstMonth + 2)) }
}

export function yearPeriod(year: number): Period {
  return { kind: 'year', start: makeDate(year, 1, 1), end: makeDate(year, 12, 31) }
}

export class PeriodError extends Error {}

export function customPeriod(start: ISODate, end: ISODate): Period {
  if (!isValidISODate(start) || !isValidISODate(end)) throw new PeriodError('Las fechas del intervalo no son válidas.')
  if (start > end) throw new PeriodError('La fecha de inicio es posterior a la de fin.')
  if (daysBetweenInclusive(start, end) > 366 * 20) throw new PeriodError('El intervalo es demasiado largo (máximo 20 años).')
  return { kind: 'custom', start, end }
}

/** Periodo del tipo indicado que contiene la fecha. */
export function periodContaining(kind: Exclude<PeriodKind, 'custom'>, date: ISODate): Period {
  const { year, month } = parts(date)
  switch (kind) {
    case 'week':
      return weekOf(date)
    case 'month':
      return monthPeriod(year, month)
    case 'quarter':
      return quarterPeriod(year, Math.floor((month - 1) / 3) + 1)
    case 'year':
      return yearPeriod(year)
  }
}

export function quarterOf(date: ISODate): number {
  return Math.floor((parts(date).month - 1) / 3) + 1
}

/** Periodo inmediatamente anterior del mismo tipo (o de la misma duración si es personalizado). */
export function previousPeriod(p: Period): Period {
  if (p.kind === 'custom') {
    const len = daysBetweenInclusive(p.start, p.end)
    return { kind: 'custom', start: addDays(p.start, -len), end: addDays(p.start, -1) }
  }
  return periodContaining(p.kind, addDays(p.start, -1))
}

export function nextPeriod(p: Period): Period {
  if (p.kind === 'custom') {
    const len = daysBetweenInclusive(p.start, p.end)
    return { kind: 'custom', start: addDays(p.end, 1), end: addDays(p.end, len) }
  }
  return periodContaining(p.kind, addDays(p.end, 1))
}

export function inPeriod(p: Period, date: ISODate | null): boolean {
  return date !== null && date >= p.start && date <= p.end
}

export function periodLength(p: Period): number {
  return daysBetweenInclusive(p.start, p.end)
}

/** Nombre legible: «octubre de 2026», «T4 2026», «Semana 43 · 19–25 oct 2026», «2026», «1 ene – 15 mar 2026». */
export function periodLabel(p: Period): string {
  const s = parts(p.start)
  const e = parts(p.end)
  switch (p.kind) {
    case 'month':
      return `${monthName(s.month)} de ${s.year}`
    case 'quarter':
      return `T${Math.floor((s.month - 1) / 3) + 1} ${s.year} (${monthShort(s.month)}–${monthShort(e.month)})`
    case 'year':
      return String(s.year)
    case 'week': {
      const w = isoWeek(p.start)
      const range =
        s.month === e.month && s.year === e.year
          ? `${s.day}–${e.day} ${monthShort(s.month)} ${s.year}`
          : `${formatDateShort(p.start, s.year !== e.year)} – ${formatDateShort(p.end)}`
      return `Semana ${w.week} · ${range}`
    }
    case 'custom':
      return s.year === e.year ? `${formatDateShort(p.start, false)} – ${formatDateShort(p.end)}` : `${formatDateShort(p.start)} – ${formatDateShort(p.end)}`
  }
}

/** Nombre corto para nombres de archivo: `2026-10`, `2026-T4`, `2026-S43`, `2026`, `2026-01-01_2026-03-15`. */
export function periodSlug(p: Period): string {
  const s = parts(p.start)
  switch (p.kind) {
    case 'month':
      return `${s.year}-${String(s.month).padStart(2, '0')}`
    case 'quarter':
      return `${s.year}-T${Math.floor((s.month - 1) / 3) + 1}`
    case 'year':
      return String(s.year)
    case 'week': {
      const w = isoWeek(p.start)
      return `${w.year}-S${String(w.week).padStart(2, '0')}`
    }
    case 'custom':
      return `${p.start}_${p.end}`
  }
}

export type Granularity = 'day' | 'week' | 'month'

export interface Bucket {
  key: string
  start: ISODate
  end: ISODate
  label: string
}

export function granularityFor(p: Period): Granularity {
  const len = periodLength(p)
  if (len <= 31) return 'day'
  if (len <= 124) return 'week'
  return 'month'
}

/** Tramos que cubren exactamente el periodo (el primero y el último se recortan a sus límites). */
export function buckets(p: Period, granularity: Granularity = granularityFor(p)): Bucket[] {
  const out: Bucket[] = []
  let cursor = p.start
  while (cursor <= p.end) {
    let natural: Period
    if (granularity === 'day') natural = { kind: 'custom', start: cursor, end: cursor }
    else if (granularity === 'week') natural = weekOf(cursor)
    else natural = periodContaining('month', cursor)
    const start = cursor
    const end = natural.end < p.end ? natural.end : p.end
    const { day, month, year } = parts(start)
    const label =
      granularity === 'day' ? `${day} ${monthShort(month)}` : granularity === 'week' ? `${day} ${monthShort(month)}` : `${monthShort(month)}${parts(p.start).year !== parts(p.end).year ? ` ${String(year).slice(2)}` : ''}`
    out.push({ key: start, start, end, label })
    cursor = addDays(end, 1)
  }
  return out
}

/** Índice del tramo que contiene la fecha (búsqueda binaria), o -1. */
export function bucketIndex(list: Bucket[], date: ISODate): number {
  let lo = 0
  let hi = list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (date < list[mid].start) hi = mid - 1
    else if (date > list[mid].end) lo = mid + 1
    else return mid
  }
  return -1
}

export function sameRange(a: Period, b: Period): boolean {
  return a.start === b.start && a.end === b.end
}
