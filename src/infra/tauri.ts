/**
 * Backend real: comandos IPC de la capa nativa. ÚNICO módulo que importa `@tauri-apps/*`.
 * El token nunca vuelve a la interfaz; solo se envía una vez al guardarlo.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import type { AiHost, Backend, Host, StoreName } from './backend'
import { LunarError } from './contracts'
import type { AiClassifyInput, AiMatchCategoryInput, AiStatus, AiSuggestion, DuplicatePair, PullEvent, AppConfig, DiagnosticReport, PageDto, PropValue, PropWrite, PropertySpec, QueryResult, Role, SchemaDto, SourceSummary } from './contracts'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (err) {
    throw LunarError.from(err)
  }
}

export class TauriBackend implements Backend {
  readonly kind = 'tauri' as const

  credentialsStatus() {
    return call<{ configured: boolean }>('credentials_status')
  }
  setToken(token: string) {
    return call<{ configured: boolean }>('credentials_set', { token })
  }
  clearToken() {
    return call<{ configured: boolean }>('credentials_clear')
  }
  getConfig() {
    return call<AppConfig>('config_get')
  }
  setConfig(config: AppConfig) {
    return call<AppConfig>('config_set', { config })
  }
  diagnose() {
    return call<DiagnosticReport>('notion_diagnose')
  }
  listSources() {
    return call<SourceSummary[]>('notion_list_sources')
  }
  resolveSource(input: string) {
    return call<SourceSummary[]>('notion_resolve_source', { input })
  }
  getSchema(dataSourceId: string) {
    return call<SchemaDto>('notion_get_schema', { dataSourceId })
  }
  query(role: Role) {
    return call<QueryResult>('notion_query', { role })
  }
  createPage(role: Role, properties: Record<string, PropWrite>) {
    return call<PageDto>('notion_create_page', { role, properties })
  }
  updatePage(role: Role, pageId: string, expected: Record<string, PropValue>, properties: Record<string, PropWrite>) {
    return call<PageDto>('notion_update_page', { role, pageId, expected, properties })
  }
  addProperties(role: Role, specs: Record<string, PropertySpec>) {
    return call<SchemaDto>('notion_add_properties', { role, specs })
  }
  createCategoriesDatabase(parentPageId: string, title: string) {
    return call<SchemaDto>('notion_create_categories_database', { parentPageId, title })
  }
  readStore(name: StoreName) {
    return call<unknown | null>('store_read', { name })
  }
  writeStore(name: StoreName, value: unknown) {
    return call<void>('store_write', { name, value })
  }
}

export class TauriAi implements AiHost {
  status() {
    return call<AiStatus>('ai_status')
  }
  start() {
    return call<AiStatus>('ai_start')
  }
  pull(model: string, onEvent: (e: PullEvent) => void) {
    const channel = new Channel<PullEvent>()
    channel.onmessage = onEvent
    return call<boolean>('ai_pull', { model, onEvent: channel })
  }
  cancelPull() {
    return call<void>('ai_cancel_pull')
  }
  classify(model: string, input: AiClassifyInput) {
    return call<AiSuggestion>('ai_classify', { model, input })
  }
  matchCategory(model: string, input: AiMatchCategoryInput) {
    return call<AiSuggestion>('ai_match_category', { model, input })
  }
  reviewDuplicates(model: string, names: string[]) {
    return call<DuplicatePair[]>('ai_review_duplicates', { model, names })
  }
  openDownloadPage() {
    return call<void>('open_ollama_download')
  }
}

export class TauriHost implements Host {
  readonly native = true
  readonly ai = new TauriAi()
  exportFile(suggestedName: string, format: 'pdf' | 'csv', bytes: Uint8Array) {
    return call<string | null>('export_save', { suggestedName, format, bytes: Array.from(bytes) })
  }
  openNotionUrl(url: string) {
    return call<void>('open_notion_url', { url })
  }
  readPreferences() {
    return call<unknown | null>('store_read', { name: 'preferences' })
  }
  writePreferences(value: unknown) {
    return call<void>('store_write', { name: 'preferences', value })
  }
}

/** Anfitrión en el navegador (solo desarrollo): descarga con un enlace y preferencias en localStorage (sin secretos). */
export class BrowserHost implements Host {
  readonly native = false
  readonly ai = null
  async exportFile(suggestedName: string, format: 'pdf' | 'csv', bytes: Uint8Array) {
    const name = suggestedName.endsWith(`.${format}`) ? suggestedName : `${suggestedName}.${format}`
    const blob = new Blob([bytes as BlobPart], { type: format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return name
  }
  async openNotionUrl(url: string) {
    window.open(url, '_blank', 'noopener')
  }
  async readPreferences() {
    try {
      const raw = localStorage.getItem('lunar.preferences')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  async writePreferences(value: unknown) {
    try {
      localStorage.setItem('lunar.preferences', JSON.stringify(value))
    } catch {
      /* almacenamiento no disponible: las preferencias no persisten */
    }
  }
}
