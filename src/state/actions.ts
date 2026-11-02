/**
 * Acciones de la aplicación: orquestan los servicios y actualizan el estado. Los componentes solo llaman a estas
 * funciones (nunca a la capa de infraestructura).
 */

import { CategoryIndex } from '../domain/categories'
import type { CategoryDraft, SuggestedCategory } from '../domain/categories'
import type { Rule } from '../domain/classifier/rules'
import type { Period } from '../domain/periods'
import type { PlanItem, RecurringDoc } from '../domain/recurring'
import { isReportStyle } from '../domain/pdf/theme'
import type { Category, Movement } from '../domain/types'
import type { AiHost, Backend, Host } from '../infra/backend'
import { type AppConfig, LunarError, type PageDto } from '../infra/contracts'
import { DemoBackend } from '../infra/demo'
import type { MovementDraft } from '../infra/mapping'
import { BrowserHost, TauriBackend, TauriHost, isTauri } from '../infra/tauri'
import * as categoriesSvc from '../services/categories'
import { type Correction, type CorrectionOutcome, applyCorrections } from '../services/categoryReview'
import { type ApplyOutcome, type PreviewItem, applyProposals } from '../services/classification'
import * as migrationSvc from '../services/migration'
import * as movementsSvc from '../services/movements'
import * as recurringSvc from '../services/recurring'
import * as rulesSvc from '../services/rules'
import { OllamaProvider, aggregatePull, chooseModel } from '../services/ai'
import { loadAll, remapMovements } from '../services/sync'
import { DEFAULT_PREFS, type DataMode, EMPTY_DATA, EMPTY_RECURRING_STATE, type Preferences, type RecurringState, type Screen, type Toast, store } from './store'

let host: Host = new BrowserHost()
let native: Backend | null = null
let demo: DemoBackend | null = null

export function backend(): Backend {
  if (store.get().mode === 'demo' || !native) {
    demo ??= new DemoBackend()
    return demo
  }
  return native
}

export function getHost(): Host {
  return host
}

export function currentIndex(): CategoryIndex {
  return new CategoryIndex(store.get().data.categories)
}

// ── Avisos ────────────────────────────────────────────────────────────────────────────────────────────────────

let toastSeq = 0
export function toast(t: Omit<Toast, 'id'>, ms = 5000) {
  const id = ++toastSeq
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
  if (ms > 0) setTimeout(() => dismissToast(id), t.action ? Math.max(ms * 4, 20000) : ms)
}

export function dismissToast(id: number) {
  store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function toastError(e: unknown, prefix?: string) {
  const err = LunarError.from(e)
  toast({ kind: 'error', message: prefix ? `${prefix}: ${err.message}` : err.message, hint: err.hint }, 9000)
}

// ── Arranque y preferencias ───────────────────────────────────────────────────────────────────────────────────

function parsePrefs(raw: unknown): Preferences {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Preferences>
  return {
    theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
    mode: p.mode === 'demo' ? 'demo' : 'notion',
    periodKind: p.periodKind === 'week' || p.periodKind === 'quarter' || p.periodKind === 'year' ? p.periodKind : 'month',
    welcomed: p.welcomed === true,
    ai: {
      enabled: p.ai?.enabled === true,
      model: typeof p.ai?.model === 'string' && p.ai.model.length <= 100 ? p.ai.model : null,
    },
    reportStyle: isReportStyle(p.reportStyle) ? p.reportStyle : 'classic',
  }
}

export async function setPrefs(patch: Partial<Preferences>) {
  const prefs = { ...store.get().prefs, ...patch }
  store.set({ prefs })
  try {
    await host.writePreferences(prefs)
  } catch (e) {
    toastError(e, 'No se pudieron guardar las preferencias')
  }
}

export async function boot() {
  if (isTauri()) {
    host = new TauriHost()
    native = new TauriBackend()
  }
  let prefs = DEFAULT_PREFS
  try {
    prefs = parsePrefs(await host.readPreferences())
  } catch {
    /* preferencias por defecto */
  }
  const mode: DataMode = native ? prefs.mode : 'demo'
  store.set({ native: Boolean(native), prefs, mode })
  await reloadSetup()
  store.set({ booted: true })
  // La IA se comprueba en segundo plano: nunca retrasa ni bloquea el arranque.
  if (host.ai) void refreshAi()
  if (isReady()) await refresh()
}

/** Lee el estado del token y la configuración del backend activo. */
export async function reloadSetup() {
  const b = backend()
  try {
    const [cred, config] = await Promise.all([b.credentialsStatus(), b.getConfig()])
    store.set({ tokenConfigured: cred.configured, config })
  } catch (e) {
    toastError(e, 'No se pudo leer la configuración')
  }
}

export function isReady(): boolean {
  const s = store.get()
  return s.tokenConfigured && Boolean(s.config.notion.movements)
}

export async function switchMode(mode: DataMode) {
  if (mode === 'notion' && !native) {
    toast({ kind: 'info', message: 'Notion solo está disponible en la aplicación de escritorio.' })
    return
  }
  store.set({ mode, data: EMPTY_DATA, rules: [], rulesNotice: null, recurring: EMPTY_RECURRING_STATE })
  await setPrefs({ mode, welcomed: true })
  await reloadSetup()
  if (isReady()) await refresh()
}

export function navigate(screen: Screen) {
  store.set({ screen })
}

export function openMovements(nav: { categoryKey?: string; status?: 'pending' | 'excluded' }) {
  store.set({ screen: 'movements', movementsNav: { ...nav, nonce: Date.now() } })
}

export function setPeriod(period: Period) {
  store.set({ period })
  if (period.kind !== 'custom' && period.kind !== store.get().prefs.periodKind) void setPrefs({ periodKind: period.kind })
}

// ── Datos ─────────────────────────────────────────────────────────────────────────────────────────────────────

let loadSeq = 0

export async function refresh() {
  const seq = ++loadSeq
  const b = backend()
  store.set((s) => ({ data: { ...s.data, status: 'loading' } }))
  try {
    const loaded = await loadAll(b, store.get().config)
    if (seq !== loadSeq) return
    store.set({
      data: {
        status: 'ready',
        movements: loaded.movements,
        categories: loaded.categories,
        pages: loaded.pages,
        categoryPages: loaded.categoryPages,
        fetchedAt: loaded.fetchedAt,
        complete: loaded.complete,
        notices: loaded.notices,
        catalog: loaded.catalog,
        error: null,
      },
    })
    await loadRulesFor(b, new CategoryIndex(loaded.categories))
  } catch (e) {
    if (seq !== loadSeq) return
    store.set((s) => ({ data: { ...s.data, status: 'error', error: LunarError.from(e) } }))
    return
  }
  // Al abrir y al sincronizar: se registran los pagos periódicos automáticos ya vencidos.
  if (seq === loadSeq) await processRecurring({ auto: true })
}

async function loadRulesFor(b: Backend, index: CategoryIndex) {
  try {
    const { rules, discarded } = await rulesSvc.loadRules(b)
    const repaired = rulesSvc.repairRuleTargets(rules, index)
    if (repaired.changed) await rulesSvc.saveRules(b, repaired.rules)
    store.set({
      rules: repaired.rules,
      rulesNotice: discarded > 0 ? `Se han descartado ${discarded} regla(s) dañadas al leer el archivo de reglas (hay una copia en rules.json.bak).` : null,
    })
  } catch (e) {
    store.set({ rulesNotice: `No se pudieron leer las reglas: ${LunarError.from(e).message}` })
  }
}

function writeContext() {
  const s = store.get()
  return { backend: backend(), config: s.config, index: new CategoryIndex(s.data.categories), pages: s.data.pages }
}

/** Integra páginas de movimientos actualizadas y recalcula (incluidos los posibles duplicados). */
function mergeMovementPages(pages: PageDto[]) {
  const s = store.get()
  const map = new Map(s.data.pages)
  for (const p of pages) map.set(p.id, p)
  const movements = remapMovements(map, s.config, new CategoryIndex(s.data.categories))
  store.set({ data: { ...s.data, pages: map, movements } })
}

// ── Pagos periódicos ──────────────────────────────────────────────────────────────────────────────────────────

function setRecurring(patch: Partial<RecurringState>) {
  store.set((s) => ({ recurring: { ...s.recurring, ...patch } }))
}

function currentPlan(doc: RecurringDoc) {
  const s = store.get()
  return recurringSvc.buildPlan(doc, recurringSvc.planData(s.data), s.config)
}

/**
 * Concilia con los datos de Notion recién cargados y registra: con `auto`, las ocurrencias automáticas vencidas;
 * con `approve`, las que el usuario ha confirmado (solo si siguen igual que cuando las vio). Nunca registra con
 * datos desactualizados o incompletos.
 *
 * El backend, la configuración y los datos se capturan una vez: si el usuario cambia entre Notion y demostración
 * durante la operación, todo (Notion y registro local) sigue yendo al mismo backend y no se toca el estado nuevo.
 */
async function processRecurring(opts: { auto: boolean; approve?: PlanItem[] }): Promise<void> {
  const mode = store.get().mode
  const b = backend()
  const sameMode = () => store.get().mode === mode
  setRecurring({ busy: true })
  try {
    await recurringSvc.withRecurringLock(b, async () => {
      const doc = await recurringSvc.loadRecurring(b)
      const s = store.get()
      if (!sameMode()) return
      if (s.data.status !== 'ready') {
        setRecurring({ doc, plan: null, error: null })
        return
      }
      const data = recurringSvc.planData(s.data)
      let plan = recurringSvc.buildPlan(doc, data, s.config)
      if (recurringSvc.applyFound(doc, plan, new Date().toISOString())) {
        await recurringSvc.saveRecurring(b, doc)
        plan = recurringSvc.buildPlan(doc, data, s.config)
      }
      const approved = recurringSvc.selectApproved(plan, opts.approve ?? [])
      const todo = plan.blocked ? [] : [...(opts.auto ? plan.items.filter((it) => it.action === 'auto') : []), ...approved.todo]
      let outcomes: recurringSvc.RegisterOutcome[] = []
      if (todo.length > 0) {
        const ctx = { backend: b, config: s.config, index: data.index, pages: s.data.pages }
        outcomes = await recurringSvc.registerOccurrences(ctx, doc, todo, (d) => recurringSvc.saveRecurring(b, d))
      }
      if (!sameMode()) return
      const pages = outcomes.flatMap((o) => (o.page ? [o.page] : []))
      if (pages.length) mergeMovementPages(pages)
      setRecurring({ doc, plan: currentPlan(doc), error: null })
      reportOutcomes(outcomes)
      if (approved.changed > 0) {
        toast({ kind: 'info', message: 'Algún pago ha cambiado al volver a leer Notion y no se ha registrado.', hint: 'Revísalo de nuevo en «Pendientes de registrar».' }, 9000)
      }
    })
  } catch (e) {
    if (sameMode()) setRecurring({ error: LunarError.from(e) })
  } finally {
    setRecurring({ busy: false })
  }
}

function reportOutcomes(outcomes: recurringSvc.RegisterOutcome[]) {
  const created = outcomes.filter((o) => o.page).length
  if (created > 0) toast({ kind: 'success', message: `${created === 1 ? '1 pago periódico registrado' : `${created} pagos periódicos registrados`}${savedWhere()}.` })
  const failed = outcomes.find((o) => o.error)
  if (!failed?.error) return
  if (failed.uncertain) {
    toast(
      {
        kind: 'error',
        message: 'No consta si Notion registró un pago periódico.',
        hint: 'Se comprobará en la próxima sincronización; si no aparece en Notion, se te pedirá revisarlo. No se repetirá solo.',
      },
      12000,
    )
  } else toastError(failed.error, 'No se registró el pago periódico')
}

/** Registra las ocurrencias confirmadas por el usuario (tal como las vio) después de volver a leer Notion. */
export async function approveOccurrences(items: PlanItem[]): Promise<void> {
  const mode = store.get().mode
  await refresh()
  const s = store.get()
  if (s.mode !== mode || s.data.status !== 'ready' || s.data.error) return
  await processRecurring({ auto: false, approve: items })
}

/**
 * Modifica el documento local en exclusiva y recalcula lo pendiente (sin registrar nada). El catálogo y la
 * configuración se capturan al empezar, junto con el backend.
 */
async function mutateRecurring(fn: (doc: RecurringDoc, ctx: { index: CategoryIndex; config: AppConfig }) => void, success?: string): Promise<boolean> {
  const mode = store.get().mode
  const b = backend()
  const ctx = { index: currentIndex(), config: store.get().config }
  try {
    await recurringSvc.withRecurringLock(b, async () => {
      const doc = await recurringSvc.loadRecurring(b)
      if (store.get().mode !== mode) return
      fn(doc, ctx)
      await recurringSvc.saveRecurring(b, doc)
      if (store.get().mode !== mode) return
      setRecurring({ doc, plan: store.get().data.status === 'ready' ? currentPlan(doc) : null, error: null })
    })
    if (success) toast({ kind: 'success', message: success })
    return true
  } catch (e) {
    toastError(e, 'No se guardó el pago periódico')
    return false
  }
}

export function saveRecurringRule(input: recurringSvc.RecurringInput, id: string | null): Promise<boolean> {
  return mutateRecurring(
    (doc, { index }) => {
      const error = recurringSvc.validateRecurringInput(input, id ? (doc.rules.find((r) => r.id === id) ?? null) : null, doc, index)
      if (error) throw new LunarError({ code: 'validation', message: error })
      recurringSvc.upsertRule(doc, input, id, new Date().toISOString())
    },
    id ? 'Pago periódico actualizado.' : 'Pago periódico creado.',
  )
}

export function setRecurringActive(id: string, active: boolean): Promise<boolean> {
  return mutateRecurring((doc) => recurringSvc.setRuleActive(doc, id, active, new Date().toISOString()), active ? 'Pago periódico reanudado.' : 'Pago periódico en pausa.')
}

export function deleteRecurringRule(id: string): Promise<boolean> {
  return mutateRecurring((doc) => recurringSvc.deleteRule(doc, id), 'Pago periódico eliminado. Los movimientos ya registrados no se han modificado.')
}

export function skipOccurrences(items: PlanItem[]): Promise<boolean> {
  return mutateRecurring((doc) => recurringSvc.skipOccurrences(doc, items, new Date().toISOString()))
}

export function relinkRecurring(): Promise<boolean> {
  return mutateRecurring((doc, { config }) => recurringSvc.relinkDataSource(doc, config), 'Pagos periódicos vinculados a la base de movimientos actual.')
}

/** Lee el documento local (al abrir la pantalla) sin registrar nada. */
export async function loadRecurringState(): Promise<void> {
  const mode = store.get().mode
  try {
    const doc = await recurringSvc.loadRecurring(backend())
    if (store.get().mode !== mode) return
    setRecurring({ doc, plan: store.get().data.status === 'ready' ? currentPlan(doc) : null, error: null })
  } catch (e) {
    setRecurring({ doc: null, plan: null, error: LunarError.from(e) })
  }
}

export async function applyRecurrenceMigration(): Promise<boolean> {
  try {
    const config = await migrationSvc.applyRecurrenceProperty(backend(), store.get().config)
    store.set({ config })
    toast({ kind: 'success', message: `Propiedad «${migrationSvc.RECURRENCE_PROPERTY_NAME}» añadida en Notion.` })
    await refresh()
    return true
  } catch (e) {
    toastError(e, 'No se aplicó el cambio')
    return false
  }
}

export function movementById(id: string): Movement | undefined {
  return store.get().data.movements.find((m) => m.id === id)
}

export async function assignCategory(m: Movement, category: Category | null): Promise<boolean> {
  try {
    const page = await movementsSvc.assignCategory(writeContext(), m, category, 'manual')
    mergeMovementPages([page])
    return true
  } catch (e) {
    toastError(e, 'No se guardó la categoría')
    return false
  }
}

export async function saveMovement(m: Movement, draft: Partial<MovementDraft>): Promise<boolean> {
  try {
    const page = await movementsSvc.updateMovement(writeContext(), m, draft, draft.category !== undefined ? 'manual' : null)
    mergeMovementPages([page])
    toast({ kind: 'success', message: `Movimiento guardado${savedWhere()}.` })
    return true
  } catch (e) {
    toastError(e, 'No se guardó el movimiento')
    return false
  }
}

export async function createMovement(draft: MovementDraft, allowDuplicate: boolean): Promise<'ok' | 'duplicate' | 'error'> {
  try {
    const page = await movementsSvc.createMovement(writeContext(), draft, store.get().data.movements, { allowDuplicate, origin: 'manual' })
    mergeMovementPages([page])
    toast({ kind: 'success', message: `Movimiento creado${savedWhere()}.` })
    return 'ok'
  } catch (e) {
    const err = LunarError.from(e)
    if (err.detail === 'duplicate') return 'duplicate'
    toastError(err, 'No se creó el movimiento')
    return 'error'
  }
}

export async function applyClassification(items: PreviewItem[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<ApplyOutcome[]> {
  const ctx = writeContext()
  ctx.pages = new Map(ctx.pages)
  const outcomes = await applyProposals(ctx, items, onProgress, signal)
  const pages = outcomes.flatMap((o) => (o.page ? [o.page] : []))
  if (pages.length) mergeMovementPages(pages)
  return outcomes
}

// ── Categorías ────────────────────────────────────────────────────────────────────────────────────────────────

function replaceCategory(cat: Category) {
  const s = store.get()
  const exists = s.data.categories.some((c) => c.id === cat.id)
  const categories = exists ? s.data.categories.map((c) => (c.id === cat.id ? cat : c)) : [...s.data.categories, cat]
  const index = new CategoryIndex(categories)
  store.set({ data: { ...s.data, categories, movements: remapMovements(s.data.pages, s.config, index) } })
}

export async function createCategory(draft: CategoryDraft): Promise<Category | null> {
  const s = store.get()
  try {
    const cat = await categoriesSvc.createCategory(backend(), s.config, draft, s.data.categories)
    // La página nueva se lee en la próxima actualización; se incorpora ya al catálogo en memoria.
    replaceCategory(cat)
    await refreshCategoryPages()
    toast({ kind: 'success', message: `Categoría «${cat.name}» creada.` })
    return cat
  } catch (e) {
    toastError(e, 'No se creó la categoría')
    return null
  }
}

async function refreshCategoryPages() {
  try {
    const r = await backend().query('categories')
    const s = store.get()
    store.set({ data: { ...s.data, categoryPages: new Map(r.pages.map((p) => [p.id, p])) } })
  } catch {
    /* se recargará en la próxima actualización */
  }
}

export async function updateCategory(current: Category, draft: CategoryDraft): Promise<boolean> {
  const s = store.get()
  try {
    const cat = await categoriesSvc.updateCategory(backend(), s.config, new Map(s.data.categoryPages), current, draft, s.data.categories)
    replaceCategory(cat)
    await refreshCategoryPages()
    toast({ kind: 'success', message: `Categoría «${cat.name}» guardada.` })
    return true
  } catch (e) {
    toastError(e, 'No se guardó la categoría')
    return false
  }
}

export async function setCategoryArchived(current: Category, archived: boolean): Promise<boolean> {
  const s = store.get()
  try {
    const cat = await categoriesSvc.setArchived(backend(), s.config, new Map(s.data.categoryPages), current, archived)
    replaceCategory(cat)
    await refreshCategoryPages()
    toast({ kind: 'success', message: archived ? `«${cat.name}» archivada.` : `«${cat.name}» reactivada.` })
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

export async function setupCatalog(parentPageId: string, seed: SuggestedCategory[], onProgress: (p: categoriesSvc.CatalogSetupProgress) => void) {
  const s = store.get()
  const result = await categoriesSvc.setupCatalog(backend(), s.config, parentPageId, seed, onProgress)
  store.set({ config: result.config })
  await refresh()
  return result
}

// ── Reglas ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveRules(rules: Rule[], message?: string): Promise<boolean> {
  try {
    await rulesSvc.saveRules(backend(), rules)
    store.set({ rules })
    if (message) toast({ kind: 'success', message })
    return true
  } catch (e) {
    toastError(e, 'No se guardaron las reglas')
    return false
  }
}

export async function upsertRule(rule: Rule): Promise<boolean> {
  const rules = store.get().rules
  const exists = rules.some((r) => r.id === rule.id)
  return saveRules(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule], exists ? 'Regla guardada.' : 'Regla creada.')
}

export async function deleteRule(id: string): Promise<boolean> {
  return saveRules(
    store.get().rules.filter((r) => r.id !== id),
    'Regla eliminada.',
  )
}

// ── Ajustes ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveToken(token: string): Promise<boolean> {
  try {
    const r = await backend().setToken(token)
    store.set({ tokenConfigured: r.configured })
    toast({ kind: 'success', message: 'Token guardado.' })
    return true
  } catch (e) {
    toastError(e, 'No se guardó el token')
    return false
  }
}

export async function clearToken() {
  try {
    const r = await backend().clearToken()
    store.set({ tokenConfigured: r.configured, data: EMPTY_DATA })
    toast({ kind: 'info', message: 'Token eliminado.' })
  } catch (e) {
    toastError(e)
  }
}

export async function saveConfig(config: AppConfig): Promise<boolean> {
  try {
    const saved = await backend().setConfig(config)
    store.set({ config: saved })
    toast({ kind: 'success', message: 'Configuración guardada.' })
    if (isReady()) await refresh()
    return true
  } catch (e) {
    toastError(e, 'No se guardó la configuración')
    return false
  }
}

export async function applyOriginMigration(): Promise<boolean> {
  try {
    const config = await migrationSvc.applyOriginProperty(backend(), store.get().config)
    store.set({ config })
    toast({ kind: 'success', message: `Propiedad «${migrationSvc.ORIGIN_PROPERTY_NAME}» añadida en Notion.` })
    await refresh()
    return true
  } catch (e) {
    toastError(e, 'No se aplicó el cambio')
    return false
  }
}

export async function exportWithHost(fn: (host: Host) => Promise<string | null>, label: string) {
  try {
    const path = await fn(host)
    if (path) toast({ kind: 'success', message: `${label} guardado.`, hint: path })
  } catch (e) {
    toastError(e, `No se pudo exportar el ${label.toLowerCase()}`)
  }
}

export async function openNotion(url: string | null) {
  if (!url) return
  try {
    await host.openNotionUrl(url)
  } catch (e) {
    toastError(e)
  }
}

/** Esquema actual de la fuente de movimientos (para el asistente del catálogo y el mapeo). */
export async function fetchSchema(dataSourceId: string) {
  return backend().getSchema(dataSourceId)
}

/** Dónde se guardan los cambios, para que los avisos no digan «en Notion» en modo demostración. */
export function savedWhere(): string {
  return store.get().mode === 'demo' ? ' (demo)' : ''
}

// ── IA local (Ollama) ─────────────────────────────────────────────────────────────────────────────────────────

function setAi(patch: Partial<import('./store').AiUiState>) {
  store.set((s) => ({ ai: { ...s.ai, ...patch } }))
}

export async function refreshAi() {
  if (!host.ai) return
  setAi({ checking: true })
  try {
    setAi({ status: await host.ai.status() })
  } catch (e) {
    toastError(e, 'No se pudo comprobar Ollama')
  } finally {
    setAi({ checking: false })
  }
}

export async function startAi() {
  if (!host.ai) return
  setAi({ starting: true })
  try {
    const status = await host.ai.start()
    setAi({ status })
    if (!status.running) toast({ kind: 'error', message: 'Ollama no ha arrancado.', hint: 'Ábrelo desde el menú Inicio y pulsa «Comprobar».' })
  } catch (e) {
    toastError(e, 'No se pudo abrir Ollama')
  } finally {
    setAi({ starting: false })
  }
}

export async function setAiPrefs(patch: Partial<Preferences['ai']>) {
  await setPrefs({ ai: { ...store.get().prefs.ai, ...patch } })
}

/** Descarga un modelo con el progreso real que informa Ollama. Solo tras la confirmación del usuario. */
export async function pullModel(model: string) {
  if (!host.ai || store.get().ai.pull?.state === 'running') return
  const layers = new Map<string, { completed: number; total: number }>()
  setAi({ pull: { model, state: 'running', status: 'Preparando…', completed: 0, total: 0, error: null } })
  try {
    const done = await host.ai.pull(model, (e) => {
      if (e.kind === 'progress') layers.set(e.digest, { completed: e.completed, total: e.total })
      const agg = aggregatePull(layers, e.kind === 'done' ? 'Completado' : e.status)
      setAi({ pull: { model, state: 'running', status: agg.status, completed: agg.completed, total: agg.total, error: null } })
    })
    const cur = store.get().ai.pull
    setAi({ pull: cur && { ...cur, state: done ? 'done' : 'cancelled' } })
    if (done) {
      await setAiPrefs({ model, enabled: true })
      toast({ kind: 'success', message: `${model} listo.` })
    }
  } catch (e) {
    const cur = store.get().ai.pull
    setAi({ pull: cur && { ...cur, state: 'error', error: LunarError.from(e) } })
  }
  await refreshAi()
}

export async function cancelPull() {
  try {
    await host.ai?.cancelPull()
  } catch (e) {
    toastError(e)
  }
}

export async function openOllamaDownload() {
  try {
    await host.ai?.openDownloadPage()
  } catch (e) {
    toastError(e)
  }
}

/** Proveedor de IA activo, o `null` si está desactivada o no disponible (se usan solo las reglas). */
export function aiProvider(): OllamaProvider | null {
  const s = store.get()
  if (!host.ai || !s.prefs.ai.enabled) return null
  const model = chooseModel(s.ai.status, s.prefs.ai.model)
  return model ? new OllamaProvider(host.ai, model) : null
}

/** IA para la revisión de categorías, o `null` si está desactivada o no disponible (solo comprobaciones por nombre). */
export function aiCategoryMatcher(): { ai: AiHost; model: string } | null {
  const s = store.get()
  const model = chooseModel(s.ai.status, s.prefs.ai.model)
  return host.ai && s.prefs.ai.enabled && model ? { ai: host.ai, model } : null
}

/** Aplica las correcciones de categoría confirmadas e integra las páginas actualizadas. */
export async function applyCategoryCorrections(corrections: Correction[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<CorrectionOutcome[]> {
  const ctx = writeContext()
  ctx.pages = new Map(ctx.pages)
  const outcomes = await applyCorrections(ctx, corrections, onProgress, signal)
  const pages = outcomes.flatMap((o) => (o.page ? [o.page] : []))
  if (pages.length) mergeMovementPages(pages)
  return outcomes
}

export async function reviewDuplicatesWithAi(names: string[]) {
  const s = store.get()
  const model = chooseModel(s.ai.status, s.prefs.ai.model)
  if (!host.ai || !s.prefs.ai.enabled || !model) return []
  return host.ai.reviewDuplicates(model, names)
}
