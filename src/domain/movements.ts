/** Validación de movimientos y detección de posibles duplicados. */

import { categoryKindFor, type CategoryIndex } from './categories'
import type { ISODate } from './dates'
import type { Cents } from './money'
import { normalizeText } from './text'
import type { CategoryLink, Movement, MovementIssue, MovementKind } from './types'

export interface RawMovementInput {
  description: string
  date: ISODate | null
  amount: { cents: Cents; exact: boolean } | null
  /** `true` si el valor original era negativo. */
  negative: boolean
  kind: MovementKind | null
  rawKind: string | null
  categoryLink: CategoryLink | null
}

/**
 * Incidencias de un movimiento. Bloqueantes: sin fecha, sin importe, sin tipo o tipo desconocido (no se puede
 * saber en qué total va). No bloqueantes: se cuentan, pero se señalan para revisarlas.
 */
export function validateMovement(input: RawMovementInput, categories: CategoryIndex): { issues: MovementIssue[]; categoryId: string | null } {
  const issues: MovementIssue[] = []
  if (!input.date) issues.push({ code: 'missing_date', message: 'Sin fecha válida.', blocking: true })
  if (!input.amount) issues.push({ code: 'missing_amount', message: 'Sin importe o importe ilegible.', blocking: true })
  else {
    if (!input.amount.exact) {
      issues.push({ code: 'excess_decimals', message: 'El importe tiene más de dos decimales; se ha redondeado al céntimo.', blocking: false })
    }
    if (input.negative) {
      issues.push({
        code: 'negative_amount',
        message: 'El importe es negativo en Notion. Se usa su valor absoluto: el sentido lo determina el «Tipo».',
        blocking: false,
      })
    }
  }
  if (input.kind === null) {
    if (input.rawKind) {
      issues.push({
        code: 'unknown_kind',
        message: `El tipo «${input.rawKind}» no está asociado a gasto, ingreso, devolución ni transferencia (Ajustes → Valores de «Tipo»).`,
        blocking: true,
      })
    } else {
      issues.push({ code: 'missing_kind', message: 'Sin tipo (gasto, ingreso…).', blocking: true })
    }
  }
  if (!input.description.trim()) issues.push({ code: 'missing_description', message: 'Sin descripción.', blocking: false })

  let categoryId: string | null = null
  if (input.categoryLink) {
    const cat = categories.resolve(input.categoryLink)
    if (!cat) {
      const shown = input.categoryLink.type === 'name' ? `«${input.categoryLink.name}»` : 'vinculada'
      issues.push({ code: 'unknown_category', message: `La categoría ${shown} no está en el catálogo.`, blocking: false })
    } else {
      categoryId = cat.id
      const expected = categoryKindFor(input.kind)
      if (expected && cat.kind !== expected) {
        issues.push({
          code: 'kind_mismatch',
          message: `«${cat.name}» es una categoría de ${cat.kind === 'income' ? 'ingresos' : 'gastos'} pero el movimiento es un ${input.kind === 'income' ? 'ingreso' : 'gasto'}.`,
          blocking: false,
        })
      }
    }
  }
  return { issues, categoryId }
}

function duplicateKey(m: Movement): string | null {
  if (!m.date || m.amountCents === null || m.kind === null) return null
  return `${m.date}|${m.amountCents}|${m.kind}|${normalizeText(m.description)}|${normalizeText(m.paymentMethod)}`
}

/**
 * Marca como posibles duplicados los movimientos con la misma fecha, importe, tipo, descripción y método de pago.
 * No se elimina nada: dos cafés iguales el mismo día pueden ser reales.
 */
export function flagPossibleDuplicates(list: Movement[]): Movement[] {
  const groups = new Map<string, Movement[]>()
  for (const m of list) {
    const k = duplicateKey(m)
    if (!k) continue
    const arr = groups.get(k) ?? []
    arr.push(m)
    groups.set(k, arr)
  }
  const dupIds = new Set<string>()
  for (const arr of groups.values()) if (arr.length > 1) for (const m of arr) dupIds.add(m.id)
  return list.map((m) => {
    if (!dupIds.has(m.id) || m.issues.some((i) => i.code === 'possible_duplicate')) return m
    return {
      ...m,
      issues: [...m.issues, { code: 'possible_duplicate', message: 'Hay otro movimiento con la misma fecha, importe y descripción.', blocking: false }],
    }
  })
}

/** Movimientos existentes que coincidirían con uno nuevo (antes de crearlo). */
export function findDuplicatesOf(
  draft: { date: ISODate; amountCents: Cents; kind: MovementKind; description: string },
  list: Movement[],
): Movement[] {
  const d = normalizeText(draft.description)
  return list.filter((m) => m.date === draft.date && m.amountCents === draft.amountCents && m.kind === draft.kind && normalizeText(m.description) === d)
}

export function sortMovements(list: Movement[], direction: 'desc' | 'asc' = 'desc'): Movement[] {
  const sign = direction === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const da = a.date ?? ''
    const db = b.date ?? ''
    if (da !== db) return da < db ? -sign : sign
    if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? -sign : sign
    return a.id < b.id ? -sign : sign
  })
}

export function needsClassification(m: Movement): boolean {
  return m.categoryLink === null && (m.kind === 'expense' || m.kind === 'income' || m.kind === 'refund')
}
