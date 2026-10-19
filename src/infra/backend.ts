import type {
  AiClassifyInput,
  AiStatus,
  AiSuggestion,
  AppConfig,
  DuplicatePair,
  PullEvent,
  DiagnosticReport,
  PageDto,
  PropValue,
  PropWrite,
  PropertySpec,
  QueryResult,
  Role,
  SchemaDto,
  SourceSummary,
} from './contracts'

export type StoreName = 'rules' | 'preferences'

/** Operaciones de datos. La interfaz nunca habla con Notion fuera de este contrato. */
export interface Backend {
  readonly kind: 'tauri' | 'demo'
  credentialsStatus(): Promise<{ configured: boolean }>
  setToken(token: string): Promise<{ configured: boolean }>
  clearToken(): Promise<{ configured: boolean }>
  getConfig(): Promise<AppConfig>
  setConfig(config: AppConfig): Promise<AppConfig>
  diagnose(): Promise<DiagnosticReport>
  listSources(): Promise<SourceSummary[]>
  resolveSource(input: string): Promise<SourceSummary[]>
  getSchema(dataSourceId: string): Promise<SchemaDto>
  query(role: Role): Promise<QueryResult>
  createPage(role: Role, properties: Record<string, PropWrite>): Promise<PageDto>
  updatePage(role: Role, pageId: string, expected: Record<string, PropValue>, properties: Record<string, PropWrite>): Promise<PageDto>
  addProperties(role: Role, specs: Record<string, PropertySpec>): Promise<SchemaDto>
  createCategoriesDatabase(parentPageId: string, title: string): Promise<SchemaDto>
  readStore(name: StoreName): Promise<unknown | null>
  writeStore(name: StoreName, value: unknown): Promise<void>
}

/** Servicios del sistema anfitrión (independientes de si los datos son reales o de demostración). */
export interface Host {
  readonly native: boolean
  exportFile(suggestedName: string, format: 'pdf' | 'csv', bytes: Uint8Array): Promise<string | null>
  openNotionUrl(url: string): Promise<void>
  readPreferences(): Promise<unknown | null>
  writePreferences(value: unknown): Promise<void>
  /** IA local. `null` si el anfitrión no la admite (navegador). */
  readonly ai: AiHost | null
}

/** Operaciones de IA local (Ollama). Solo hablan con el propio equipo. */
export interface AiHost {
  status(): Promise<AiStatus>
  start(): Promise<AiStatus>
  pull(model: string, onEvent: (e: PullEvent) => void): Promise<boolean>
  cancelPull(): Promise<void>
  classify(model: string, input: AiClassifyInput): Promise<AiSuggestion>
  reviewDuplicates(model: string, names: string[]): Promise<DuplicatePair[]>
  openDownloadPage(): Promise<void>
}
