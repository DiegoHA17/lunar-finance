/**
 * Pagos periódicos: calendario de ocurrencias, claves estables y plan de registro. Funciones puras (sin E/S); el
 * servicio `services/recurring.ts` las aplica contra Notion y el documento local.
 *
 * Garantías contra duplicados:
 *   - cada ocurrencia tiene una clave estable `lunar-rp:<regla>:<fecha nominal>` que se escribe en Notion junto al
 *     movimiento (propiedad «Pago periódico»); si Notion ya tiene esa clave, la ocurrencia está registrada;
 *   - el registro local (`ledger`) marca la ocurrencia como «enviándose» antes de pedir a Notion que la cree; si la
 *     respuesta no llega y la clave no aparece en Notion, la ocurrencia pasa a revisión manual, nunca se repite sola;
 *   - lo registrado u omitido no se vuelve a generar aunque se borre en Notion o se edite la regla;
 *   - nada se registra solo si la consulta a Notion está incompleta o existe un movimiento igual sin clave.
 */

import { type CategoryIndex, canAssign } from './categories'
import { type ISODate, addDays, daysInMonth, isValidISODate, isoWeekday, makeDate, parts, toDayNumber } from './dates'
import type { Cents } from './money'
import { findDuplicatesOf } from './movements'
import type { Category, Movement, MovementKind } from './types'

export type Frequency = 'weekly' | 'monthly' | 'yearly'
export type RecurringMode = 'auto' | 'confirm'

export const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: 'Semanal', monthly: 'Mensual', yearly: 'Anual' }
export const MODE_LABEL: Record<RecurringMode, string> = { auto: 'Automático', confirm: 'Con confirmación' }

/** Datos con los que se crea el movimiento de una ocurrencia. */
export interface OccurrenceDraft {
  date: ISODate
  description: string
  amountCents: Cents
  kind: MovementKind
  categoryId: string | null
  categoryName: string | null
  paymentMethod: string | null
}

export interface RecurringRule {
  id: string
  description: string
  amountCents: Cents
  kind: MovementKind
  categoryId: string | null
  categoryName: string | null
  paymentMethod: string | null
  frequency: Frequency
  /** Ancla del calendario: fija el día del mes (o de la semana) de todas las ocurrencias. */
  startDate: ISODate
  /** No se generan ocurrencias anteriores (inicio, o día de reanudación tras una pausa). */
  from: ISODate
  /** Las ocurrencias anteriores a esta fecha (alta o cambio de calendario) solo se registran con confirmación. */
  autoFrom: ISODate
  mode: RecurringMode
  active: boolean
  createdAt: string
  updatedAt: string
}

export type LedgerEntry =
  | { state: 'sending'; ruleId: string; date: ISODate; at: string; draft: OccurrenceDraft }
  | { state: 'registered'; ruleId: string; date: ISODate; at: string; pageId: string }
  | { state: 'skipped'; ruleId: string; date: ISODate; at: string }

export interface RecurringDoc {
  version: 1
  /** Base de datos de movimientos en la que se registran las ocurrencias (se fija con el primer registro). */
  dataSourceId: string | null
  rules: RecurringRule[]
  ledger: Record<string, LedgerEntry>
}

export const EMPTY_RECURRING: RecurringDoc = { version: 1, dataSourceId: null, rules: [], ledger: {} }

/** Antigüedad máxima de la fecha de inicio al crear una regla (evita generar listas interminables de atrasos). */
export const MAX_PAST_DAYS = 366

const KEY_PREFIX = 'lunar-rp:'

export function occurrenceKey(ruleId: string, date: ISODate): string {
  return `${KEY_PREFIX}${ruleId}:${date}`
}

/** Clave de ocurrencia escrita en Notion, o `null` si el texto no es una clave de Lunar. */
export function parseOccurrenceKey(text: string | null): { ruleId: string; date: ISODate } | null {
  if (!text) return null
  const t = text.trim()
  if (!t.startsWith(KEY_PREFIX)) return null
  const rest = t.slice(KEY_PREFIX.length)
  const i = rest.lastIndexOf(':')
  if (i <= 0) return null
  const date = rest.slice(i + 1)
  return isValidISODate(date) ? { ruleId: rest.slice(0, i), date } : null
}

export function newRecurringId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `rp_${rnd}`
}

/**
 * Fecha de la ocurrencia `n` (0 = la de inicio). Mensual y anual se calculan desde el ancla, no desde la anterior:
 * un pago el día 31 cae el 30 en abril, el 28 o 29 en febrero y vuelve al 31 en marzo; uno el 29 de febrero cae el
 * 28 en los años no bisiestos.
 */
export function occurrenceDate(startDate: ISODate, frequency: Frequency, n: number): ISODate {
  if (frequency === 'weekly') return addDays(startDate, 7 * n)
  const { year, month, day } = parts(startDate)
  if (frequency === 'yearly') {
    const y = year + n
    return makeDate(y, month, Math.min(day, daysInMonth(y, month)))
  }
  const m0 = month - 1 + n
  const y = year + Math.floor(m0 / 12)
  const m = (m0 % 12) + 1
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)))
}

/** Fechas de la regla entre `from` y `to` (ambas incluidas), en orden. */
export function occurrencesBetween(rule: Pick<RecurringRule, 'startDate' | 'frequency'>, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  if (to < rule.startDate || to < from) return out
  // Primer índice candidato sin recorrer desde el inicio (las semanas son exactas; meses y años, por defecto).
  const { year, month } = parts(rule.startDate)
  const f = parts(from)
  let n = 0
  if (from > rule.startDate) {
    if (rule.frequency === 'weekly') n = Math.floor((toDayNumber(from) - toDayNumber(rule.startDate)) / 7)
    else if (rule.frequency === 'monthly') n = (f.year - year) * 12 + (f.month - month) - 1
    else n = f.year - year - 1
    n = Math.max(0, n)
  }
  for (; ; n++) {
    const d = occurrenceDate(rule.startDate, rule.frequency, n)
    if (d > to) break
    if (d >= from) out.push(d)
  }
  return out
}

/** Próxima ocurrencia aún no registrada ni omitida (puede estar vencida). `null` si la regla está pausada. */
export function nextOccurrence(rule: RecurringRule, ledger: Record<string, LedgerEntry>): ISODate | null {
  if (!rule.active) return null
  for (let n = 0; n < 5000; n++) {
    const d = occurrenceDate(rule.startDate, rule.frequency, n)
    if (d < rule.from) continue
    const e = ledger[occurrenceKey(rule.id, d)]
    if (!e || e.state === 'sending') return d
  }
  return null
}

/** Última fecha registrada u omitida de una regla (para validar cambios de calendario). */
export function lastHandled(ruleId: string, ledger: Record<string, LedgerEntry>): ISODate | null {
  let last: ISODate | null = null
  for (const e of Object.values(ledger)) if (e.ruleId === ruleId && e.state !== 'sending' && (!last || e.date > last)) last = e.date
  return last
}

export function hasSending(ruleId: string, ledger: Record<string, LedgerEntry>): boolean {
  return Object.values(ledger).some((e) => e.ruleId === ruleId && e.state === 'sending')
}

export function scheduleLabel(rule: Pick<RecurringRule, 'frequency' | 'startDate'>): string {
  const { day, month } = parts(rule.startDate)
  if (rule.frequency === 'weekly') return `Semanal, los ${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'][isoWeekday(rule.startDate) - 1]}`
  if (rule.frequency === 'monthly') return `Mensual, el día ${day}${day > 28 ? ' (o el último del mes)' : ''}`
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `Anual, el ${day} de ${MONTHS[month - 1]}`
}

export function draftFromRule(rule: RecurringRule, date: ISODate): OccurrenceDraft {
  return {
    date,
    description: rule.description,
    amountCents: rule.amountCents,
    kind: rule.kind,
    categoryId: rule.categoryId,
    categoryName: rule.categoryName,
    paymentMethod: rule.paymentMethod,
  }
}

/** Categoría con la que se registraría el borrador, o el motivo por el que no se puede. */
export function resolveDraftCategory(d: OccurrenceDraft, index: CategoryIndex): { ok: true; category: Category | null } | { ok: false; reason: string } {
  if (d.kind === 'transfer' || (!d.categoryId && !d.categoryName)) return { ok: true, category: null }
  const c = (d.categoryId ? index.get(d.categoryId) : undefined) ?? (d.categoryName ? index.findByName(d.categoryName) : undefined)
  if (!c) return { ok: false, reason: `La categoría «${d.categoryName ?? d.categoryId}» ya no existe.` }
  const check = canAssign(c, { kind: d.kind })
  if (!check.ok) return { ok: false, reason: check.reason }
  return { ok: true, category: c }
}

export interface PlanItem {
  key: string
  ruleId: string
  draft: OccurrenceDraft
  /** `auto`: se registra sola. `manual`: espera a que el usuario la registre u omita. */
  action: 'auto' | 'manual'
  /** Por qué necesita revisión (además de la confirmación normal). */
  warning: string | null
  /** El registro se intentó y no consta el resultado. */
  uncertain: boolean
  /** Marca del intento sin comprobar (cambia con cada reintento): invalida aprobaciones hechas sobre otro intento. */
  attempt: string | null
}

export interface RecurringPlan {
  items: PlanItem[]
  /** Ocurrencias que ya están en Notion: se anotan como registradas. */
  found: Record<string, { ruleId: string; date: ISODate; pageId: string }>
  /** Claves que aparecen en más de un movimiento de Notion. */
  repeatedKeys: string[]
  /** Si no es `null`, no se puede registrar nada (ni automática ni manualmente). */
  blocked: string | null
}

export interface PlanContext {
  today: ISODate
  /** Clave → IDs de las páginas de Notion que la llevan. */
  notionKeys: Map<string, string[]>
  /** La consulta a Notion devolvió todos los movimientos. */
  complete: boolean
  /** La propiedad «Pago periódico» está configurada. */
  propertyReady: boolean
  dataSourceId: string | null
  movements: Movement[]
  index: CategoryIndex
}

export function planRecurring(doc: RecurringDoc, ctx: PlanContext): RecurringPlan {
  const items: PlanItem[] = []
  const found: RecurringPlan['found'] = {}
  const repeatedKeys: string[] = []
  let blocked: string | null = null
  if (!ctx.propertyReady) blocked = 'Falta la propiedad «Pago periódico» en tu base de movimientos de Notion.'
  else if (!ctx.complete) blocked = 'Notion no devolvió todos los movimientos: no se registra nada hasta que la consulta esté completa.'
  else if (doc.dataSourceId && ctx.dataSourceId !== doc.dataSourceId) blocked = 'La base de movimientos configurada no es en la que se registraron los pagos periódicos.'

  const inNotion = (key: string) => {
    const pages = ctx.notionKeys.get(key)
    if (pages && pages.length > 1) repeatedKeys.push(key)
    return pages?.[0] ?? null
  }

  // 1. Envíos sin resultado conocido: si Notion tiene la clave, quedan registrados; si no, a revisión.
  for (const [key, e] of Object.entries(doc.ledger)) {
    if (e.state !== 'sending') continue
    const pageId = inNotion(key)
    if (pageId) found[key] = { ruleId: e.ruleId, date: e.date, pageId }
    else {
      items.push({
        key,
        ruleId: e.ruleId,
        draft: e.draft,
        action: 'manual',
        uncertain: true,
        attempt: e.at,
        warning: 'Se intentó registrar, pero no consta que Notion lo creara. Búscalo en Notion antes de registrarlo de nuevo.',
      })
    }
  }

  // 2. Ocurrencias vencidas de las reglas activas.
  for (const rule of doc.rules) {
    if (!rule.active) continue
    for (const date of occurrencesBetween(rule, rule.from, ctx.today)) {
      const key = occurrenceKey(rule.id, date)
      if (doc.ledger[key]) continue
      const pageId = inNotion(key)
      if (pageId) {
        found[key] = { ruleId: rule.id, date, pageId }
        continue
      }
      const draft = draftFromRule(rule, date)
      let warning: string | null = null
      const cat = resolveDraftCategory(draft, ctx.index)
      if (!cat.ok) warning = cat.reason
      else if (findDuplicatesOf(draft, ctx.movements).length > 0) warning = 'Ya hay un movimiento igual (fecha, importe, tipo y descripción) que no está vinculado a este pago.'
      const auto = rule.mode === 'auto' && date >= rule.autoFrom && !warning
      items.push({ key, ruleId: rule.id, draft, action: auto ? 'auto' : 'manual', warning, uncertain: false, attempt: null })
    }
  }

  if (blocked) for (const it of items) it.action = 'manual'
  items.sort((a, b) => (a.draft.date === b.draft.date ? a.key.localeCompare(b.key) : a.draft.date < b.draft.date ? -1 : 1))
  return { items, found, repeatedKeys: [...new Set(repeatedKeys)], blocked }
}

/** Valida y normaliza el documento leído del disco. Lanza si no es un documento de pagos periódicos. */
export function parseRecurringDoc(raw: unknown): RecurringDoc {
  if (raw === null || raw === undefined) return structuredClone(EMPTY_RECURRING)
  if (typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new Error('El archivo de pagos periódicos no tiene un formato reconocido.')
  const r = raw as Partial<RecurringDoc>
  const rules = Array.isArray(r.rules) ? r.rules.filter(isRule) : null
  const ledger = r.ledger && typeof r.ledger === 'object' ? r.ledger : null
  if (!rules || !ledger || rules.length !== (r.rules as unknown[]).length) throw new Error('El archivo de pagos periódicos está dañado.')
  for (const e of Object.values(ledger)) if (!isEntry(e)) throw new Error('El registro de pagos periódicos está dañado.')
  return { version: 1, dataSourceId: typeof r.dataSourceId === 'string' ? r.dataSourceId : null, rules, ledger }
}

function isRule(x: unknown): x is RecurringRule {
  const r = x as RecurringRule
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.description === 'string' &&
    Number.isSafeInteger(r.amountCents) &&
    r.amountCents > 0 &&
    ['expense', 'income', 'refund', 'transfer'].includes(r.kind) &&
    ['weekly', 'monthly', 'yearly'].includes(r.frequency) &&
    ['auto', 'confirm'].includes(r.mode) &&
    isValidISODate(r.startDate) &&
    isValidISODate(r.from) &&
    isValidISODate(r.autoFrom) &&
    typeof r.active === 'boolean'
  )
}

function isEntry(x: unknown): x is LedgerEntry {
  const e = x as LedgerEntry
  if (!e || typeof e.ruleId !== 'string' || !isValidISODate(e.date)) return false
  if (e.state === 'registered') return typeof e.pageId === 'string'
  if (e.state === 'sending') return !!e.draft && isValidISODate(e.draft.date) && Number.isSafeInteger(e.draft.amountCents)
  return e.state === 'skipped'
}
