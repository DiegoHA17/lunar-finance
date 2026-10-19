/** Datos sintéticos para pruebas. Nunca se usan movimientos reales. */

import { CategoryIndex } from '../domain/categories'
import type { Rule } from '../domain/classifier/rules'
import type { Category, Movement, MovementIssue, MovementKind } from '../domain/types'

let seq = 0

export function cat(name: string, over: Partial<Category> = {}): Category {
  return {
    id: over.id ?? `cat-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    kind: 'expense',
    color: 'slate',
    icon: 'tag',
    status: 'active',
    description: '',
    aliases: [],
    url: null,
    source: 'notion',
    ...over,
  }
}

export function mov(over: Partial<Movement> & { euros?: number } = {}): Movement {
  seq++
  const { euros, ...rest } = over
  return {
    id: `m-${seq}`,
    url: null,
    description: 'Movimiento',
    date: '2026-10-10',
    amountCents: euros !== undefined ? Math.round(euros * 100) : 1000,
    kind: 'expense' as MovementKind,
    rawKind: 'Gasto',
    categoryLink: null,
    categoryId: null,
    paymentMethod: 'Tarjeta',
    origin: 'unknown',
    issues: [],
    createdTime: `2026-10-10T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    lastEditedTime: '2026-10-10T10:00:00.000Z',
    ...rest,
  }
}

export function withCategory(m: Movement, c: Category): Movement {
  return { ...m, categoryId: c.id, categoryLink: { type: 'name', name: c.name } }
}

export const blocking = (code: MovementIssue['code'] = 'missing_amount'): MovementIssue => ({ code, message: code, blocking: true })

export function rule(pattern: string, category: Category, over: Partial<Rule> = {}): Rule {
  seq++
  return {
    id: `r-${seq}`,
    pattern,
    field: 'description',
    match: 'contains',
    accentSensitive: false,
    categoryId: category.id,
    categoryName: category.name,
    priority: 50,
    active: true,
    conditions: {},
    exceptions: [],
    createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    source: 'manual',
    ...over,
  }
}

export const index = (cats: Category[]) => new CategoryIndex(cats)
