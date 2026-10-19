/**
 * Fechas de calendario como cadenas ISO `AAAA-MM-DD`, sin horas ni zonas horarias. Se comparan
 * lexicográficamente y la aritmética se hace con números de día UTC, así no hay sorpresas por cambios de horario.
 */

export type ISODate = string

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false
  const m = ISO_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Extrae la fecha de calendario de un valor de Notion (`2026-10-01` o `2026-10-01T10:00:00.000+02:00`). */
export function notionDateToISO(value: string | null | undefined): ISODate | null {
  if (!value) return null
  const head = value.slice(0, 10)
  return isValidISODate(head) ? head : null
}

export function toDayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function fromDayNumber(day: number): ISODate {
  const dt = new Date(day * DAY_MS)
  return `${dt.getUTCFullYear().toString().padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days)
}

export function makeDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parts(date: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

/** Día de la semana ISO: lunes = 1 … domingo = 7. */
export function isoWeekday(date: ISODate): number {
  const dow = new Date(toDayNumber(date) * DAY_MS).getUTCDay()
  return dow === 0 ? 7 : dow
}

/** Semana ISO 8601 (año ISO y número de semana). */
export function isoWeek(date: ISODate): { year: number; week: number } {
  const thursday = addDays(date, 4 - isoWeekday(date))
  const year = parts(thursday).year
  const jan1 = makeDate(year, 1, 1)
  const week = Math.floor((toDayNumber(thursday) - toDayNumber(jan1)) / 7) + 1
  return { year, week }
}

export function daysBetweenInclusive(start: ISODate, end: ISODate): number {
  return toDayNumber(end) - toDayNumber(start) + 1
}

/** Fecha local de hoy (no UTC: a las 00:30 en Madrid sigue siendo «hoy»). */
export function today(now: Date = new Date()): ISODate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

export function monthName(month: number): string {
  return MONTHS[month - 1]
}

export function monthShort(month: number): string {
  return MONTHS_SHORT[month - 1]
}

/** `19/10/2026` */
export function formatDateES(date: ISODate): string {
  const { year, month, day } = parts(date)
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

/** `19 oct 2026` */
export function formatDateShort(date: ISODate, withYear = true): string {
  const { year, month, day } = parts(date)
  return withYear ? `${day} ${monthShort(month)} ${year}` : `${day} ${monthShort(month)}`
}

/** `19 de octubre de 2026` */
export function formatDateLong(date: ISODate): string {
  const { year, month, day } = parts(date)
  return `${day} de ${monthName(month)} de ${year}`
}

/** Fecha y hora local legible a partir de un instante RFC 3339. */
export function formatInstant(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
