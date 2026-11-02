/**
 * Pagos periódicos: documento local `recurring.json` (reglas y registro de ocurrencias) y registro en Notion.
 *
 * Orden de cada registro (ver `domain/recurring.ts`):
 *   1. se anota la ocurrencia como «enviándose» y se guarda en disco; si no se puede guardar, no se envía nada;
 *   2. se crea el movimiento en Notion con su clave en «Pago periódico»;
 *   3. se anota como registrada. Si Notion falla de forma ambigua (red, 5xx), queda «enviándose» y la próxima
 *      conciliación decide: si Notion tiene la clave, está registrada; si no, pasa a revisión manual.
 * Ante cualquier error se detiene el lote.
 */

import { CategoryIndex } from '../domain/categories'
import { type ISODate, addDays, isValidISODate, today } from '../domain/dates'
import {
  type Frequency,
  type LedgerEntry,
  MAX_PAST_DAYS,
  type PlanItem,
  type RecurringDoc,
  type RecurringMode,
  type RecurringPlan,
  type RecurringRule,
  hasSending,
  lastHandled,
  newRecurringId,
  parseOccurrenceKey,
  parseRecurringDoc,
  planRecurring,
  resolveDraftCategory,
} from '../domain/recurring'
import type { Movement, MovementKind } from '../domain/types'
import type { Backend } from '../infra/backend'
import { type AppConfig, LunarError, type PageDto } from '../infra/contracts'
import { recurrenceTextOf } from '../infra/mapping'
import { type WriteContext, createMovement } from './movements'

export async function loadRecurring(backend: Backend): Promise<RecurringDoc> {
  try {
    return parseRecurringDoc(await backend.readStore('recurring'))
  } catch (e) {
    if (e instanceof LunarError) throw e
    throw new LunarError({
      code: 'io',
      message: e instanceof Error ? e.message : 'No se pudo leer el archivo de pagos periódicos.',
      hint: 'No se registrará ningún pago periódico hasta resolverlo. Hay una copia anterior en recurring.json.bak.',
    })
  }
}

export async function saveRecurring(backend: Backend, doc: RecurringDoc): Promise<void> {
  await backend.writeStore('recurring', doc)
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * Ejecuta `fn` en exclusiva: una sola operación a la vez en esta ventana y, mediante el cerrojo del sistema, en
 * todas las instancias de Lunar Finance del equipo.
 */
export function withRecurringLock<T>(backend: Backend, fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    if (!(await backend.acquireRunLock())) {
      throw new LunarError({ code: 'conflict', message: 'Otra ventana de Lunar Finance está registrando pagos periódicos.', hint: 'Espera a que termine o ciérrala.' })
    }
    try {
      return await fn()
    } finally {
      await backend.releaseRunLock().catch(() => undefined)
    }
  })
  chain = run.catch(() => undefined)
  return run
}

/** Clave de ocurrencia → páginas de Notion que la llevan. */
export function notionKeys(pages: Iterable<PageDto>, config: AppConfig): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const src = config.notion.movements
  if (!src?.fields.recurrence) return out
  for (const p of pages) {
    const text = recurrenceTextOf(p, src)
    if (!parseOccurrenceKey(text)) continue
    const key = text!.trim()
    out.set(key, [...(out.get(key) ?? []), p.id])
  }
  return out
}

export interface PlanData {
  pages: Map<string, PageDto>
  movements: Movement[]
  index: CategoryIndex
  complete: boolean
}

export function buildPlan(doc: RecurringDoc, data: PlanData, config: AppConfig, day: ISODate = today()): RecurringPlan {
  return planRecurring(doc, {
    today: day,
    notionKeys: notionKeys(data.pages.values(), config),
    complete: data.complete,
    propertyReady: Boolean(config.notion.movements?.fields.recurrence),
    dataSourceId: config.notion.movements?.dataSourceId ?? null,
    movements: data.movements,
    index: data.index,
  })
}

/** Anota como registradas las ocurrencias que ya están en Notion. Devuelve `true` si el documento cambió. */
export function applyFound(doc: RecurringDoc, plan: RecurringPlan, at: string): boolean {
  let changed = false
  for (const [key, f] of Object.entries(plan.found)) {
    const e = doc.ledger[key]
    if (e?.state === 'registered' && e.pageId === f.pageId) continue
    doc.ledger[key] = { state: 'registered', ruleId: f.ruleId, date: f.date, at, pageId: f.pageId }
    changed = true
  }
  return changed
}

/**
 * Errores tras los que Notion seguro que no creó la página (la petición se rechazó o no llegó a procesarse).
 * `schema` no está: también se produce al interpretar la respuesta de una creación que sí se hizo.
 */
const NOT_CREATED = new Set(['validation', 'config', 'forbidden', 'not_found', 'invalid_token', 'no_token', 'rate_limited', 'conflict'])

export interface RegisterOutcome {
  key: string
  page?: PageDto
  error?: LunarError
  /** No se sabe si Notion lo creó: queda pendiente de conciliar. */
  uncertain?: boolean
}

/**
 * Registra las ocurrencias en orden. `persist` guarda el documento en disco (se llama antes y después de cada
 * envío). Se detiene ante el primer error.
 */
export async function registerOccurrences(
  ctx: WriteContext,
  doc: RecurringDoc,
  items: PlanItem[],
  persist: (doc: RecurringDoc) => Promise<void>,
  now: () => string = () => new Date().toISOString(),
): Promise<RegisterOutcome[]> {
  const out: RegisterOutcome[] = []
  const src = ctx.config.notion.movements
  if (!src?.fields.recurrence) throw new LunarError({ code: 'config', message: 'Falta la propiedad «Pago periódico» en la base de movimientos.' })
  for (const item of items) {
    const cat = resolveDraftCategory(item.draft, ctx.index)
    if (!cat.ok) {
      out.push({ key: item.key, error: new LunarError({ code: 'validation', message: cat.reason }) })
      break
    }
    const previous = doc.ledger[item.key]
    doc.ledger[item.key] = { state: 'sending', ruleId: item.ruleId, date: item.draft.date, at: now(), draft: item.draft }
    doc.dataSourceId ??= src.dataSourceId
    try {
      await persist(doc)
    } catch (e) {
      // No se ha enviado nada: se deja el documento como estaba.
      if (previous) doc.ledger[item.key] = previous
      else delete doc.ledger[item.key]
      out.push({ key: item.key, error: LunarError.from(e) })
      break
    }
    let page: PageDto
    try {
      const d = item.draft
      page = await createMovement(
        ctx,
        { description: d.description, date: d.date, amountCents: d.amountCents, kind: d.kind, category: cat.category, paymentMethod: d.paymentMethod, recurrenceKey: item.key },
        [],
        { allowDuplicate: true, origin: 'manual' },
      )
    } catch (e) {
      const err = LunarError.from(e)
      if (NOT_CREATED.has(err.code)) {
        if (previous) doc.ledger[item.key] = previous
        else delete doc.ledger[item.key]
        await persist(doc).catch(() => undefined) // si falla, queda «enviándose» y se concilia después
        out.push({ key: item.key, error: err })
      } else {
        out.push({ key: item.key, error: err, uncertain: true })
      }
      break
    }
    doc.ledger[item.key] = { state: 'registered', ruleId: item.ruleId, date: item.draft.date, at: now(), pageId: page.id }
    try {
      await persist(doc)
    } catch (e) {
      // Está en Notion con su clave: la próxima conciliación lo anotará como registrado.
      out.push({ key: item.key, page, error: LunarError.from(e) })
      break
    }
    out.push({ key: item.key, page })
  }
  return out
}

/**
 * Ocurrencias confirmadas por el usuario que siguen igual tras volver a leer Notion. Si una cambió (ahora está sin
 * comprobar, hubo otro intento, tiene un aviso nuevo u otros datos), no se registra: el usuario debe verla de nuevo.
 */
export function selectApproved(plan: RecurringPlan, approved: PlanItem[]): { todo: PlanItem[]; changed: number } {
  const fresh = new Map(plan.items.map((i) => [i.key, i]))
  const todo: PlanItem[] = []
  let changed = 0
  for (const a of approved) {
    const f = fresh.get(a.key)
    if (!f) continue // ya registrada u omitida
    if (f.uncertain !== a.uncertain || f.attempt !== a.attempt || f.warning !== a.warning || JSON.stringify(f.draft) !== JSON.stringify(a.draft)) changed++
    else todo.push(f)
  }
  return { todo, changed }
}

// ── Reglas ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RecurringInput {
  description: string
  amountCents: number
  kind: MovementKind
  categoryId: string | null
  categoryName: string | null
  paymentMethod: string | null
  frequency: Frequency
  startDate: ISODate
  mode: RecurringMode
}

export function validateRecurringInput(input: RecurringInput, previous: RecurringRule | null, doc: RecurringDoc, index: CategoryIndex, day: ISODate = today()): string | null {
  if (!input.description.trim()) return 'La descripción es obligatoria.'
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return 'El importe debe ser mayor que cero.'
  if (!isValidISODate(input.startDate)) return 'La fecha de inicio no es válida.'
  const cat = resolveDraftCategory({ ...input, date: input.startDate }, index)
  if (!cat.ok) return cat.reason
  const scheduleChanged = !previous || previous.startDate !== input.startDate || previous.frequency !== input.frequency
  if (scheduleChanged && input.startDate < addDays(day, -MAX_PAST_DAYS)) return 'La fecha de inicio no puede ser anterior a hace un año.'
  if (previous && scheduleChanged) {
    if (hasSending(previous.id, doc.ledger)) return 'Hay un registro de este pago pendiente de comprobar. Resuélvelo antes de cambiar el calendario.'
    const last = lastHandled(previous.id, doc.ledger)
    if (last && input.startDate <= last) return `El nuevo calendario debe empezar después del último pago registrado u omitido (${last}).`
  }
  return null
}

/** Crea o edita una regla. Cambiar importe, categoría o descripción solo afecta a lo que aún no se ha registrado. */
export function upsertRule(doc: RecurringDoc, input: RecurringInput, id: string | null, at: string, day: ISODate = today()): RecurringRule {
  const previous = id ? (doc.rules.find((r) => r.id === id) ?? null) : null
  if (id && !previous) throw new LunarError({ code: 'conflict', message: 'El pago periódico ya no existe.' })
  const fields = {
    description: input.description.trim(),
    amountCents: input.amountCents,
    kind: input.kind,
    categoryId: input.kind === 'transfer' ? null : input.categoryId,
    categoryName: input.kind === 'transfer' ? null : input.categoryName,
    paymentMethod: input.paymentMethod?.trim() || null,
    frequency: input.frequency,
    startDate: input.startDate,
    mode: input.mode,
  }
  if (!previous) {
    const rule: RecurringRule = { id: newRecurringId(), ...fields, from: input.startDate, autoFrom: day, active: true, createdAt: at, updatedAt: at }
    doc.rules.push(rule)
    return rule
  }
  const scheduleChanged = previous.startDate !== input.startDate || previous.frequency !== input.frequency
  const rule: RecurringRule = { ...previous, ...fields, updatedAt: at, ...(scheduleChanged ? { from: input.startDate, autoFrom: day } : {}) }
  doc.rules = doc.rules.map((r) => (r.id === id ? rule : r))
  return rule
}

/** Pausar o reanudar. Al reanudar se continúa desde hoy: no se recuperan los pagos del periodo en pausa. */
export function setRuleActive(doc: RecurringDoc, id: string, active: boolean, at: string, day: ISODate = today()) {
  doc.rules = doc.rules.map((r) => (r.id !== id || r.active === active ? r : { ...r, active, updatedAt: at, ...(active && r.from < day ? { from: day } : {}) }))
}

/** Elimina la regla. Los movimientos ya registrados en Notion no se tocan; los envíos sin comprobar se conservan. */
export function deleteRule(doc: RecurringDoc, id: string) {
  doc.rules = doc.rules.filter((r) => r.id !== id)
  doc.ledger = Object.fromEntries(Object.entries(doc.ledger).filter(([, e]) => e.ruleId !== id || e.state === 'sending'))
}

/** Omite ocurrencias (o da por registradas las que quedaron sin comprobar): no se volverán a proponer. */
export function skipOccurrences(doc: RecurringDoc, items: PlanItem[], at: string) {
  for (const it of items) doc.ledger[it.key] = { state: 'skipped', ruleId: it.ruleId, date: it.draft.date, at } satisfies LedgerEntry
}

/** Vincula los pagos periódicos a la base de movimientos configurada ahora (tras cambiarla en Ajustes). */
export function relinkDataSource(doc: RecurringDoc, config: AppConfig) {
  doc.dataSourceId = config.notion.movements?.dataSourceId ?? null
}

export function planData(data: { pages: Map<string, PageDto>; movements: Movement[]; categories: ConstructorParameters<typeof CategoryIndex>[0]; complete: boolean }): PlanData {
  return { pages: data.pages, movements: data.movements, index: new CategoryIndex(data.categories), complete: data.complete }
}
