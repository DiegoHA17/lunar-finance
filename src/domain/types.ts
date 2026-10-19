import type { ISODate } from './dates'
import type { Cents } from './money'

/** Naturaleza contable de un movimiento. */
export type MovementKind = 'expense' | 'income' | 'refund' | 'transfer'
export type CategoryKind = 'expense' | 'income'
export type CategoryStatus = 'active' | 'archived'

/** Quién asignó la categoría actual. `unknown`: no hay propiedad de origen o el movimiento venía ya clasificado. */
export type ClassificationOrigin = 'rule' | 'manual' | 'ai' | 'unknown'

export const KIND_LABEL: Record<MovementKind, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  refund: 'Devolución',
  transfer: 'Transferencia',
}

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = { expense: 'Gasto', income: 'Ingreso' }

export type IssueCode =
  | 'missing_date'
  | 'missing_amount'
  | 'excess_decimals'
  | 'negative_amount'
  | 'missing_kind'
  | 'unknown_kind'
  | 'unknown_category'
  | 'kind_mismatch'
  | 'possible_duplicate'
  | 'missing_description'

export interface MovementIssue {
  code: IssueCode
  message: string
  /** Si es `true`, el movimiento no se incluye en ningún total. */
  blocking: boolean
}

/** Cómo guarda el movimiento su categoría en Notion. */
export type CategoryLink = { type: 'name'; name: string } | { type: 'id'; id: string }

export interface Movement {
  id: string
  url: string | null
  description: string
  date: ISODate | null
  /** Valor absoluto en céntimos; el sentido lo da `kind`. */
  amountCents: Cents | null
  kind: MovementKind | null
  /** Valor original de «Tipo» en Notion. */
  rawKind: string | null
  /** Vínculo tal como está en Notion (nombre o ID). */
  categoryLink: CategoryLink | null
  /** Categoría del catálogo resuelta, si existe. */
  categoryId: string | null
  paymentMethod: string | null
  origin: ClassificationOrigin
  issues: MovementIssue[]
  createdTime: string
  lastEditedTime: string
}

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  /** Clave de la paleta de Lunar (ver ui/palette). */
  color: string
  /** Nombre del icono (ver ui/icons). */
  icon: string
  status: CategoryStatus
  description: string
  /** Nombres anteriores o alternativos con los que se reconoce la categoría. */
  aliases: string[]
  url: string | null
  /**
   * `notion`: página de la base de datos «Categorías».
   * `implicit`: deducida de los valores de los movimientos porque aún no existe el catálogo (solo lectura).
   */
  source: 'notion' | 'implicit'
}

export function isCounted(m: Movement): boolean {
  return !m.issues.some((i) => i.blocking)
}
