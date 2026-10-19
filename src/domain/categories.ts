/** Catálogo de categorías: resolución de vínculos, validación de nombres y reglas de asignación. */

import { nameKey } from './text'
import type { Category, CategoryKind, CategoryLink, Movement, MovementKind } from './types'

export function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

export class CategoryIndex {
  private byId = new Map<string, Category>()
  private byName = new Map<string, Category[]>()

  readonly list: Category[]

  constructor(list: Category[]) {
    this.list = list
    for (const c of list) {
      this.byId.set(normalizeId(c.id), c)
      for (const n of [c.name, ...c.aliases]) {
        const k = nameKey(n)
        if (!k) continue
        const arr = this.byName.get(k) ?? []
        if (!arr.includes(c)) arr.push(c)
        this.byName.set(k, arr)
      }
    }
  }

  get(id: string | null | undefined): Category | undefined {
    return id ? this.byId.get(normalizeId(id)) : undefined
  }

  /**
   * Busca por nombre o alias normalizado. Si varios coinciden, se prefiere el nombre principal sobre el alias y la
   * categoría activa sobre la archivada; si sigue habiendo empate, no se resuelve (sería arbitrario).
   */
  findByName(name: string): Category | undefined {
    const k = nameKey(name)
    const candidates = this.byName.get(k)
    if (!candidates || candidates.length === 0) return undefined
    if (candidates.length === 1) return candidates[0]
    const primary = candidates.filter((c) => nameKey(c.name) === k)
    const pool = primary.length > 0 ? primary : candidates
    const active = pool.filter((c) => c.status === 'active')
    const finalPool = active.length > 0 ? active : pool
    return finalPool.length === 1 ? finalPool[0] : undefined
  }

  resolve(link: CategoryLink | null): Category | undefined {
    if (!link) return undefined
    return link.type === 'id' ? this.get(link.id) : this.findByName(link.name)
  }
}

/** Tipo de categoría compatible con un tipo de movimiento. Las transferencias no llevan categoría contable. */
export function categoryKindFor(kind: MovementKind | null): CategoryKind | null {
  if (kind === 'expense' || kind === 'refund') return 'expense'
  if (kind === 'income') return 'income'
  return null
}

export type AssignmentCheck = { ok: true } | { ok: false; reason: string }

/** ¿Se puede asignar esta categoría a este movimiento ahora? */
export function canAssign(category: Category | undefined, movement: Pick<Movement, 'kind'>): AssignmentCheck {
  if (!category) return { ok: false, reason: 'La categoría no existe en el catálogo.' }
  if (category.status === 'archived') return { ok: false, reason: `«${category.name}» está archivada; no admite movimientos nuevos.` }
  const expected = categoryKindFor(movement.kind)
  if (movement.kind === 'transfer') return { ok: false, reason: 'Las transferencias no se clasifican en categorías de gasto o ingreso.' }
  if (expected && category.kind !== expected) {
    return { ok: false, reason: `«${category.name}» es una categoría de ${category.kind === 'income' ? 'ingresos' : 'gastos'}.` }
  }
  return { ok: true }
}

export interface CategoryDraft {
  id?: string
  name: string
  kind: CategoryKind
  color: string
  icon: string
  description: string
  aliases: string[]
}

/** Valida un borrador frente al catálogo. Devuelve los errores por campo. */
export function validateCategoryDraft(draft: CategoryDraft, all: Category[]): Partial<Record<'name' | 'aliases', string>> {
  const errors: Partial<Record<'name' | 'aliases', string>> = {}
  const name = draft.name.trim()
  if (!name) errors.name = 'El nombre es obligatorio.'
  else if (name.length > 60) errors.name = 'El nombre no puede superar los 60 caracteres.'
  else if (name.includes(',')) errors.name = 'Notion no admite comas en los nombres de categoría.'
  else {
    const key = nameKey(name)
    const clash = all.find((c) => c.id !== draft.id && [c.name, ...c.aliases].some((n) => nameKey(n) === key))
    if (clash) {
      errors.name =
        nameKey(clash.name) === key
          ? `Ya existe la categoría «${clash.name}»${clash.status === 'archived' ? ' (archivada; puedes reactivarla)' : ''}.`
          : `«${name}» ya es un alias de «${clash.name}».`
    }
  }
  const seen = new Set<string>([nameKey(name)])
  for (const alias of draft.aliases) {
    const k = nameKey(alias)
    if (!k) continue
    if (seen.has(k)) {
      errors.aliases = `El alias «${alias}» está repetido.`
      break
    }
    seen.add(k)
    const clash = all.find((c) => c.id !== draft.id && [c.name, ...c.aliases].some((n) => nameKey(n) === k))
    if (clash) {
      errors.aliases = `El alias «${alias}» ya pertenece a «${clash.name}».`
      break
    }
  }
  return errors
}

/** Al renombrar, el nombre anterior pasa a ser alias para que los movimientos históricos sigan resolviéndose. */
export function aliasesAfterRename(previous: Category, newName: string, aliases: string[]): string[] {
  const out = [...aliases]
  if (nameKey(previous.name) !== nameKey(newName) && !out.some((a) => nameKey(a) === nameKey(previous.name))) {
    out.push(previous.name)
  }
  return out.filter((a) => nameKey(a) !== nameKey(newName))
}

export interface SuggestedCategory {
  name: string
  kind: CategoryKind
  color: string
  icon: string
}

/** Sugerencias iniciales. No se imponen: el usuario elige cuáles crear. */
export const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
  { name: 'Alimentación', kind: 'expense', color: 'sage', icon: 'shopping-basket' },
  { name: 'Restaurantes', kind: 'expense', color: 'amber', icon: 'utensils' },
  { name: 'Ocio', kind: 'expense', color: 'violet', icon: 'sparkles' },
  { name: 'Ropa', kind: 'expense', color: 'rose', icon: 'shirt' },
  { name: 'Transporte', kind: 'expense', color: 'sky', icon: 'train' },
  { name: 'Vivienda', kind: 'expense', color: 'slate', icon: 'home' },
  { name: 'Suscripciones', kind: 'expense', color: 'indigo', icon: 'repeat' },
  { name: 'Salud', kind: 'expense', color: 'teal', icon: 'heart-pulse' },
  { name: 'Estudios', kind: 'expense', color: 'ochre', icon: 'graduation-cap' },
  { name: 'Viajes', kind: 'expense', color: 'cyan', icon: 'plane' },
  { name: 'Otros', kind: 'expense', color: 'stone', icon: 'circle-dashed' },
  { name: 'Nómina', kind: 'income', color: 'moon', icon: 'briefcase' },
  { name: 'Becas', kind: 'income', color: 'sage', icon: 'graduation-cap' },
  { name: 'Devoluciones', kind: 'income', color: 'sky', icon: 'undo' },
  { name: 'Otros ingresos', kind: 'income', color: 'stone', icon: 'plus-circle' },
]

/** Categorías de solo lectura deducidas de los valores existentes cuando todavía no hay catálogo en Notion. */
export function implicitCategories(names: { name: string; kind: CategoryKind }[]): Category[] {
  const seen = new Map<string, Category>()
  for (const { name, kind } of names) {
    const k = nameKey(name)
    if (!k || seen.has(k)) continue
    const suggestion = SUGGESTED_CATEGORIES.find((s) => nameKey(s.name) === k)
    seen.set(k, {
      id: `implicit:${k}`,
      name: name.trim(),
      kind: suggestion?.kind ?? kind,
      color: suggestion?.color ?? 'stone',
      icon: suggestion?.icon ?? 'tag',
      status: 'active',
      description: '',
      aliases: [],
      url: null,
      source: 'implicit',
    })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function sortCategories(list: Category[]): Category[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'expense' ? -1 : 1
    return a.name.localeCompare(b.name, 'es')
  })
}
