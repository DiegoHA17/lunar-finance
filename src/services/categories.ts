/** Casos de uso del catálogo de categorías (base de datos «Categorías» en Notion). */

import { type CategoryDraft, type SuggestedCategory, aliasesAfterRename, validateCategoryDraft } from '../domain/categories'
import { nameKey } from '../domain/text'
import type { Category } from '../domain/types'
import type { Backend } from '../infra/backend'
import { type AppConfig, LunarError, type PageDto, type SourceConfig } from '../infra/contracts'
import { suggestMapping } from '../infra/fieldSpecs'
import { categoryWrites, expectedValues, pageToCategory } from '../infra/mapping'

function catalogSource(config: AppConfig): SourceConfig {
  const src = config.notion.categories
  if (!src) {
    throw new LunarError({
      code: 'config',
      message: 'Todavía no hay una base de datos de categorías en Notion.',
      hint: 'Créala desde la pantalla Categorías → «Crear catálogo en Notion».',
    })
  }
  return src
}

function firstError(errors: Record<string, string | undefined>): void {
  const msg = Object.values(errors).find(Boolean)
  if (msg) throw new LunarError({ code: 'validation', message: msg })
}

export async function createCategory(backend: Backend, config: AppConfig, draft: CategoryDraft, all: Category[]): Promise<Category> {
  const src = catalogSource(config)
  firstError(validateCategoryDraft(draft, all))
  const page = await backend.createPage(
    'categories',
    categoryWrites(src, { name: draft.name, kind: draft.kind, status: 'active', color: draft.color, icon: draft.icon, description: draft.description, aliases: draft.aliases }),
  )
  const cat = pageToCategory(page, src)
  if (!cat) throw new LunarError({ code: 'schema', message: 'Notion creó la categoría pero no se pudo leer su nombre.' })
  return cat
}

/** Página actual de una categoría en el formato que compara el control de concurrencia. */
type CategoryPages = Map<string, PageDto>

export async function updateCategory(backend: Backend, config: AppConfig, pages: CategoryPages, current: Category, draft: CategoryDraft, all: Category[]): Promise<Category> {
  const src = catalogSource(config)
  firstError(validateCategoryDraft({ ...draft, id: current.id }, all))
  const aliases = aliasesAfterRename(current, draft.name, draft.aliases)
  const writes = categoryWrites(src, { name: draft.name, kind: draft.kind, color: draft.color, icon: draft.icon, description: draft.description, aliases })
  return save(backend, src, pages, current, writes)
}

export async function setArchived(backend: Backend, config: AppConfig, pages: CategoryPages, current: Category, archived: boolean): Promise<Category> {
  const src = catalogSource(config)
  return save(backend, src, pages, current, categoryWrites(src, { status: archived ? 'archived' : 'active' }))
}

async function save(backend: Backend, src: SourceConfig, pages: CategoryPages, current: Category, writes: ReturnType<typeof categoryWrites>): Promise<Category> {
  const page = pages.get(current.id)
  if (!page) throw new LunarError({ code: 'conflict', message: 'La categoría ya no está en los datos cargados.', hint: 'Actualiza los datos.' })
  const updated = await backend.updatePage('categories', current.id, expectedValues(page, Object.keys(writes)), writes)
  pages.set(updated.id, updated)
  const cat = pageToCategory(updated, src)
  if (!cat) throw new LunarError({ code: 'schema', message: 'No se pudo leer la categoría actualizada.' })
  return cat
}

export interface CatalogSetupProgress {
  done: number
  total: number
  current: string
}

/**
 * Crea la base de datos «Categorías» en la página indicada, la configura y da de alta las categorías elegidas
 * (las que ya se usan en los movimientos y las sugeridas que el usuario marque). No toca los movimientos.
 */
export async function setupCatalog(
  backend: Backend,
  config: AppConfig,
  parentPageId: string,
  seed: SuggestedCategory[],
  onProgress: (p: CatalogSetupProgress) => void,
): Promise<{ config: AppConfig; created: number; failed: { name: string; error: string }[] }> {
  const schema = await backend.createCategoriesDatabase(parentPageId, 'Categorías')
  const fields = suggestMapping('categories', schema)
  const next: AppConfig = {
    ...config,
    notion: { ...config.notion, categories: { dataSourceId: schema.id, databaseId: schema.databaseId, title: schema.title, fields, valueMap: {} } },
  }
  const saved = await backend.setConfig(next)
  const src = saved.notion.categories!
  const failed: { name: string; error: string }[] = []
  const seen = new Set<string>()
  const unique = seed.filter((s) => {
    const k = nameKey(s.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
  let created = 0
  for (const [i, s] of unique.entries()) {
    onProgress({ done: i, total: unique.length, current: s.name })
    try {
      await backend.createPage('categories', categoryWrites(src, { name: s.name, kind: s.kind, status: 'active', color: s.color, icon: s.icon, description: '', aliases: [] }))
      created++
    } catch (e) {
      failed.push({ name: s.name, error: LunarError.from(e).message })
    }
  }
  onProgress({ done: unique.length, total: unique.length, current: '' })
  return { config: saved, created, failed }
}
