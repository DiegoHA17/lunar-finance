/**
 * Clasificación en lote de movimientos pendientes. Siempre en dos pasos: vista previa y aplicación explícita.
 * Nunca toca movimientos que ya tienen categoría.
 */

import type { CategoryIndex } from '../domain/categories'
import { type Proposal, classifyWithRules } from '../domain/classifier/pipeline'
import type { Rule } from '../domain/classifier/rules'
import { needsClassification } from '../domain/movements'
import { type Movement, isCounted } from '../domain/types'
import { LunarError, type PageDto } from '../infra/contracts'
import { type WriteContext, assignCategory } from './movements'

export interface PreviewItem {
  movement: Movement
  proposal: Proposal
}

export function previewPending(movements: Movement[], rules: Rule[], index: CategoryIndex): PreviewItem[] {
  return movements
    .filter((m) => needsClassification(m) && isCounted(m))
    .map((movement) => ({ movement, proposal: classifyWithRules(movement, { categories: index, rules }) }))
    .sort((a, b) => (b.movement.date ?? '').localeCompare(a.movement.date ?? ''))
}

export interface ApplyOutcome {
  movementId: string
  ok: boolean
  page?: PageDto
  error?: LunarError
}

/**
 * Aplica las propuestas seleccionadas una a una (Notion limita las peticiones por segundo). Se detiene si la
 * señal se aborta; los cambios ya hechos permanecen y se informan.
 */
export async function applyProposals(
  ctx: WriteContext,
  items: PreviewItem[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ApplyOutcome[]> {
  const out: ApplyOutcome[] = []
  for (const [i, { movement, proposal }] of items.entries()) {
    if (signal?.aborted) break
    onProgress(i, items.length)
    const category = ctx.index.get(proposal.categoryId)
    if (proposal.status !== 'proposed' || !category) {
      out.push({ movementId: movement.id, ok: false, error: new LunarError({ code: 'validation', message: 'La propuesta ya no es válida.' }) })
      continue
    }
    try {
      // Sin proveedor (elección del usuario en la revisión) cuenta como clasificación manual.
      const origin = proposal.source === 'ai' ? 'ai' : proposal.source === 'rule' ? 'rule' : 'manual'
      const page = await assignCategory(ctx, movement, category, origin)
      ctx.pages.set(page.id, page)
      out.push({ movementId: movement.id, ok: true, page })
    } catch (e) {
      const err = LunarError.from(e)
      out.push({ movementId: movement.id, ok: false, error: err })
      // Sin conexión o sin permisos: no tiene sentido seguir intentándolo con el resto.
      if (['offline', 'invalid_token', 'forbidden', 'no_token', 'rate_limited'].includes(err.code)) break
    }
  }
  onProgress(out.length, items.length)
  return out
}
