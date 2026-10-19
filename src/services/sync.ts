/** Carga completa desde Notion: movimientos y catálogo de categorías. */

import { CategoryIndex } from '../domain/categories'
import { flagPossibleDuplicates } from '../domain/movements'
import type { Category, Movement } from '../domain/types'
import type { Backend } from '../infra/backend'
import { type AppConfig, LunarError, type PageDto } from '../infra/contracts'
import { buildCategories, pageToMovement } from '../infra/mapping'

export interface LoadedData {
  movements: Movement[]
  categories: Category[]
  /** Páginas originales por ID: necesarias para el control de concurrencia al escribir. */
  pages: Map<string, PageDto>
  /** Páginas de «Categorías» por ID (vacío si el catálogo es implícito). */
  categoryPages: Map<string, PageDto>
  fetchedAt: string
  complete: boolean
  notices: string[]
  /** El catálogo de Notion existe y se ha leído (si no, las categorías son implícitas). */
  catalog: 'notion' | 'implicit'
}

export function remapMovements(pages: Map<string, PageDto>, config: AppConfig, index: CategoryIndex): Movement[] {
  const src = config.notion.movements!
  return flagPossibleDuplicates([...pages.values()].map((p) => pageToMovement(p, src, index)))
}

export async function loadAll(backend: Backend, config: AppConfig): Promise<LoadedData> {
  const movSrc = config.notion.movements
  if (!movSrc) {
    throw new LunarError({ code: 'config', message: 'No hay ninguna base de datos de movimientos configurada.', hint: 'Configúrala en Ajustes → Conexión con Notion.' })
  }
  const catSrc = config.notion.categories
  const notices: string[] = []
  const [movResult, catResult] = await Promise.all([
    backend.query('movements'),
    catSrc ? backend.query('categories').then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e: LunarError.from(e) })) : Promise.resolve(null),
  ])

  let categoryPages: PageDto[] | null = null
  if (catResult?.ok) categoryPages = catResult.r.pages
  else if (catResult && !catResult.ok) {
    notices.push(`No se pudo leer la base de datos de categorías: ${catResult.e.message} Se muestran las categorías deducidas de los movimientos.`)
  }

  const categories = buildCategories(categoryPages, catSrc, movResult.pages, movSrc)
  const index = new CategoryIndex(categories)
  const pages = new Map(movResult.pages.map((p) => [p.id, p]))
  const movements = remapMovements(pages, config, index)

  if (!movResult.complete) notices.push('Notion indicó que la consulta está incompleta (límite de 10 000 registros por consulta). Algunas cifras pueden faltar.')
  if (movResult.duplicatesRemoved > 0) notices.push(`Notion devolvió ${movResult.duplicatesRemoved} registro(s) repetidos durante la paginación; se ha conservado una sola copia.`)
  const catalogComplete = !catResult || !catResult.ok || catResult.r.complete

  return {
    movements,
    categories,
    pages,
    categoryPages: new Map((categoryPages ?? []).map((p) => [p.id, p])),
    fetchedAt: movResult.fetchedAt,
    complete: movResult.complete && catalogComplete,
    notices,
    catalog: categoryPages ? 'notion' : 'implicit',
  }
}
