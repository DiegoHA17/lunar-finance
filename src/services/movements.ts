/** Casos de uso sobre movimientos: clasificar, editar y crear. */

import { type CategoryIndex, canAssign } from '../domain/categories'
import { isValidISODate } from '../domain/dates'
import { findDuplicatesOf } from '../domain/movements'
import type { Category, ClassificationOrigin, Movement } from '../domain/types'
import type { Backend } from '../infra/backend'
import { type AppConfig, LunarError, type PageDto } from '../infra/contracts'
import { MappingError, type MovementDraft, type WriteVariants, expectedValues, movementWrites, variantsOf } from '../infra/mapping'

export interface WriteContext {
  backend: Backend
  config: AppConfig
  index: CategoryIndex
  pages: Map<string, PageDto>
}

function mappingError(e: unknown): never {
  if (e instanceof MappingError) throw new LunarError({ code: 'config', message: e.message, hint: 'Revisa el mapeo en Ajustes → Conexión con Notion.' })
  throw e
}

/** Variantes exactas que ya usan tus movimientos (respeta lo que escribe el atajo, p. ej. «Gasto »). */
function writeVariants(ctx: WriteContext): WriteVariants {
  const f = ctx.config.notion.movements?.fields ?? {}
  const pages = [...ctx.pages.values()]
  return { kind: variantsOf(pages, f.kind), category: variantsOf(pages, f.category), paymentMethod: variantsOf(pages, f.paymentMethod) }
}

function sourceOf(ctx: WriteContext) {
  const src = ctx.config.notion.movements
  if (!src) throw new LunarError({ code: 'config', message: 'No hay ninguna base de datos de movimientos configurada.' })
  return src
}

/** Asigna (o quita) la categoría de un movimiento. Devuelve la página actualizada. */
export async function assignCategory(ctx: WriteContext, m: Movement, category: Category | null, origin: Exclude<ClassificationOrigin, 'unknown'>): Promise<PageDto> {
  if (category) {
    const check = canAssign(category, m)
    if (!check.ok) throw new LunarError({ code: 'validation', message: check.reason })
  }
  return updateMovement(ctx, m, { category }, origin)
}

export async function updateMovement(
  ctx: WriteContext,
  m: Movement,
  draft: Partial<MovementDraft>,
  origin: Exclude<ClassificationOrigin, 'unknown'> | null,
): Promise<PageDto> {
  const src = sourceOf(ctx)
  const page = ctx.pages.get(m.id)
  if (!page) throw new LunarError({ code: 'conflict', message: 'El movimiento ya no está en los datos cargados.', hint: 'Actualiza los datos.' })
  validateDraft(draft)
  let writes
  try {
    writes = movementWrites(src, draft, origin, writeVariants(ctx))
  } catch (e) {
    mappingError(e)
  }
  if (Object.keys(writes).length === 0) throw new LunarError({ code: 'validation', message: 'No hay cambios que guardar.' })
  // Valores esperados: solo de las propiedades que cambian (si otra persona editó otra propiedad, no hay conflicto).
  return ctx.backend.updatePage('movements', m.id, expectedValues(page, Object.keys(writes)), writes)
}

export interface CreateResult {
  page: PageDto
}

export function validateDraft(d: Partial<MovementDraft>) {
  if (d.description !== undefined && !d.description.trim()) throw new LunarError({ code: 'validation', message: 'La descripción es obligatoria.' })
  if (d.date !== undefined && !isValidISODate(d.date)) throw new LunarError({ code: 'validation', message: 'La fecha no es válida.' })
  if (d.amountCents !== undefined && (!Number.isSafeInteger(d.amountCents) || d.amountCents <= 0)) {
    throw new LunarError({ code: 'validation', message: 'El importe debe ser mayor que cero.' })
  }
}

/**
 * Crea un movimiento. Si ya existe uno igual (fecha, importe, tipo y descripción) se rechaza salvo que el usuario
 * confirme expresamente que no es un duplicado.
 */
export async function createMovement(ctx: WriteContext, draft: MovementDraft, existing: Movement[], opts: { allowDuplicate: boolean; origin: 'manual' | 'rule' }): Promise<PageDto> {
  const src = sourceOf(ctx)
  validateDraft(draft)
  if (draft.category) {
    const check = canAssign(draft.category, { kind: draft.kind })
    if (!check.ok) throw new LunarError({ code: 'validation', message: check.reason })
  }
  if (!opts.allowDuplicate) {
    const dups = findDuplicatesOf(draft, existing)
    if (dups.length > 0) {
      throw new LunarError({
        code: 'validation',
        message: `Ya existe un movimiento igual (${draft.description}, misma fecha e importe).`,
        hint: 'Si de verdad son dos movimientos distintos, confirma que quieres crearlo igualmente.',
        detail: 'duplicate',
      })
    }
  }
  let writes
  try {
    writes = movementWrites(src, draft, draft.category ? opts.origin : null, writeVariants(ctx))
  } catch (e) {
    mappingError(e)
  }
  return ctx.backend.createPage('movements', writes)
}
