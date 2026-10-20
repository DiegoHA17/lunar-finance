/**
 * Acciones de la aplicación: orquestan los servicios y actualizan el estado. Los componentes solo llaman a estas
 * funciones (nunca a la capa de infraestructura).
 */

import { CategoryIndex } from '../domain/categories'
import type { CategoryDraft, SuggestedCategory } from '../domain/categories'
import type { Rule } from '../domain/classifier/rules'
import type { Period } from '../domain/periods'
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
import * as rulesSvc from '../services/rules'
import { OllamaProvider, aggregatePull, chooseModel } from '../services/ai'
import { loadAll, remapMovements } from '../services/sync'
import { DEFAULT_PREFS, type DataMode, EMPTY_DATA, type Preferences, type Screen, type Toast, store } from './store'

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
  store.set({ mode, data: EMPTY_DATA, rules: [], rulesNotice: null })
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
  }
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
