/**
 * Contratos con la capa nativa (espejo de los tipos serializados en `src-tauri/src`). Cualquier cambio aquí debe
 * reflejarse en Rust y viceversa.
 */

export type PropValue =
  | { type: 'title'; value: string }
  | { type: 'rich_text'; value: string }
  | { type: 'number'; value: number | null }
  | { type: 'select'; value: string | null }
  | { type: 'status'; value: string | null }
  | { type: 'multi_select'; value: string[] }
  | { type: 'date'; value: { start: string; end?: string | null } | null }
  | { type: 'relation'; value: string[] }
  | { type: 'checkbox'; value: boolean }
  | { type: 'created_time'; value: string }
  | { type: 'last_edited_time'; value: string }
  | { type: 'url'; value: string | null }
  | { type: 'unsupported'; value: string }

export type PropWrite =
  | { type: 'title'; value: string }
  | { type: 'rich_text'; value: string }
  | { type: 'number'; value: number | null }
  | { type: 'select'; value: string | null }
  | { type: 'status'; value: string | null }
  | { type: 'date'; value: string | null }
  | { type: 'relation'; value: string[] }
  | { type: 'checkbox'; value: boolean }

export interface PropEntry {
  name: string
  value: PropValue
}

export interface PageDto {
  id: string
  url: string | null
  createdTime: string
  lastEditedTime: string
  /** ID de propiedad → valor. */
  properties: Record<string, PropEntry>
}

export interface SchemaProperty {
  id: string
  name: string
  type: string
  options?: string[]
  relationDataSourceId?: string | null
}

export interface SchemaDto {
  id: string
  title: string
  databaseId: string | null
  parentPageId: string | null
  url: string | null
  properties: SchemaProperty[]
}

export interface SourceSummary {
  id: string
  title: string
  databaseId: string | null
  url: string | null
}

export interface QueryResult {
  pages: PageDto[]
  fetchedAt: string
  complete: boolean
  incompleteReason: string | null
  skippedInTrash: number
  duplicatesRemoved: number
}

export type Role = 'movements' | 'categories'

export interface FieldRef {
  id: string
  name: string
  kind: string
}

export interface SourceConfig {
  dataSourceId: string
  databaseId?: string | null
  title?: string | null
  fields: Record<string, FieldRef>
  valueMap: Record<string, string[]>
}

export interface AppConfig {
  version: number
  notion: { movements?: SourceConfig; categories?: SourceConfig }
}

export type PropertySpec =
  | { type: 'rich_text' }
  | { type: 'number' }
  | { type: 'date' }
  | { type: 'select'; options: string[] }
  | { type: 'relation'; data_source_id: string }

export type ErrorCode =
  | 'no_token'
  | 'invalid_token'
  | 'offline'
  | 'forbidden'
  | 'not_found'
  | 'schema'
  | 'validation'
  | 'rate_limited'
  | 'conflict'
  | 'server'
  | 'config'
  | 'io'
  | 'internal'

export interface AppErrorDto {
  code: ErrorCode
  message: string
  hint?: string
  detail?: string
  retryAfterSecs?: number
}

export type StepStatus = 'ok' | 'warning' | 'error'

export interface DiagnosticStep {
  id: string
  title: string
  status: StepStatus
  detail: string
  hint?: string
  error?: AppErrorDto
}

export interface DiagnosticReport {
  steps: DiagnosticStep[]
  movementsReady: boolean
  categoriesReady: boolean
  integrationName: string | null
  workspaceName: string | null
}

/** Error de la aplicación con código estable, mensaje y acción sugerida. */
export class LunarError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  readonly detail?: string
  readonly retryAfterSecs?: number

  constructor(dto: AppErrorDto) {
    super(dto.message)
    this.name = 'LunarError'
    this.code = dto.code
    this.hint = dto.hint
    this.detail = dto.detail
    this.retryAfterSecs = dto.retryAfterSecs
  }

  static from(err: unknown): LunarError {
    if (err instanceof LunarError) return err
    if (err && typeof err === 'object' && 'code' in err && 'message' in err) return new LunarError(err as AppErrorDto)
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error inesperado.'
    return new LunarError({ code: 'internal', message })
  }
}

// ── IA local (Ollama) ─────────────────────────────────────────────────────────────────────────────────────────

export interface LocalModel {
  name: string
  size: number
  family: string | null
  parameterSize: string | null
  quantization: string | null
  capabilities: string[]
}

export interface AiStatus {
  installed: boolean
  canStart: boolean
  running: boolean
  version: string | null
  models: LocalModel[]
  resources: { totalMemoryBytes: number | null; freeDiskBytes: number | null }
  error?: AppErrorDto
}

export type PullEvent =
  | { kind: 'status'; status: string }
  | { kind: 'progress'; status: string; digest: string; completed: number; total: number }
  | { kind: 'done' }

export interface AiClassifyInput {
  description: string
  amount: string
  kind: string
  paymentMethod: string | null
  categories: { id: string; name: string }[]
}

/** Nombre de categoría que no está en el catálogo. Solo se envía el nombre, el tipo y los nombres del catálogo. */
export interface AiMatchCategoryInput {
  name: string
  kind: string
  categories: { id: string; name: string }[]
}

export interface AiSuggestion {
  categoryId: string | null
  confidence: number
  reason: string
}

export interface DuplicatePair {
  a: string
  b: string
  reason: string
}
