/**
 * Traducción entre páginas de Notion (`PageDto`) y el dominio, según el mapeo configurado. Es el único lugar que
 * conoce los tipos de propiedad de Notion.
 */

import { CategoryIndex, implicitCategories } from '../domain/categories'
import { notionDateToISO } from '../domain/dates'
import { centsToNumber, toCents } from '../domain/money'
import { validateMovement } from '../domain/movements'
import { nameKey } from '../domain/text'
import type { Category, CategoryKind, CategoryLink, ClassificationOrigin, Movement, MovementKind } from '../domain/types'
import type { FieldRef, PageDto, PropValue, PropWrite, SourceConfig } from './contracts'
import { DEFAULT_KIND_VALUES } from './fieldSpecs'

function prop(page: PageDto, src: SourceConfig, field: string): PropValue | null {
  const ref = src.fields[field]
  if (!ref) return null
  return page.properties[ref.id]?.value ?? null
}

/** Texto de cualquier propiedad textual o de selección. */
export function textOf(v: PropValue | null): string | null {
  if (!v) return null
  switch (v.type) {
    case 'title':
    case 'rich_text':
      return v.value.trim() === '' ? null : v.value
    case 'select':
    case 'status':
    case 'url':
      return v.value && v.value.trim() !== '' ? v.value : null
    case 'multi_select':
      return v.value.length ? v.value.join(', ') : null
    default:
      return null
  }
}

const KIND_SYNONYMS: Record<MovementKind, string[]> = {
  expense: ['gasto', 'gastos', 'expense'],
  income: ['ingreso', 'ingresos', 'income'],
  refund: ['devolucion', 'devoluciones', 'reembolso', 'refund'],
  transfer: ['transferencia', 'transferencia interna', 'traspaso', 'transfer'],
}

/**
 * Tipo de movimiento a partir del valor de «Tipo». Primero las correspondencias configuradas; si un tipo no tiene
 * ninguna, se usan sinónimos habituales. Un valor desconocido devuelve `null` (nunca se adivina).
 */
export function resolveKind(raw: string | null, valueMap: Record<string, string[]>): MovementKind | null {
  if (!raw) return null
  const k = nameKey(raw)
  const kinds: MovementKind[] = ['expense', 'income', 'refund', 'transfer']
  for (const kind of kinds) {
    if ((valueMap[kind] ?? []).some((v) => nameKey(v) === k)) return kind
  }
  for (const kind of kinds) {
    if ((valueMap[kind] ?? []).length === 0 && KIND_SYNONYMS[kind].includes(k)) return kind
  }
  return null
}

/** Etiqueta que se escribe en «Tipo» para un tipo de movimiento. */
export function kindLabel(kind: MovementKind, valueMap: Record<string, string[]>): string {
  return valueMap[kind]?.[0] ?? DEFAULT_KIND_VALUES[kind][0]
}

export const ORIGIN_VALUES: Record<Exclude<ClassificationOrigin, 'unknown'>, string> = { rule: 'Regla', manual: 'Manual', ai: 'IA' }

function resolveOrigin(raw: string | null): ClassificationOrigin {
  const k = nameKey(raw)
  if (k === 'regla' || k === 'automatica') return 'rule'
  if (k === 'manual') return 'manual'
  if (k === 'ia' || k === 'ai') return 'ai'
  return 'unknown'
}

function categoryLinkOf(v: PropValue | null): CategoryLink | null {
  if (!v) return null
  if (v.type === 'relation') return v.value.length ? { type: 'id', id: v.value[0] } : null
  const t = textOf(v)
  return t ? { type: 'name', name: t.trim() } : null
}

export function pageToMovement(page: PageDto, src: SourceConfig, categories: CategoryIndex): Movement {
  const description = textOf(prop(page, src, 'description')) ?? ''
  const dateV = prop(page, src, 'date')
  const date = dateV?.type === 'date' ? notionDateToISO(dateV.value?.start) : dateV?.type === 'created_time' ? notionDateToISO(dateV.value) : null
  const amountV = prop(page, src, 'amount')
  const rawAmount = amountV?.type === 'number' ? amountV.value : null
  const conv = rawAmount === null ? null : toCents(Math.abs(rawAmount))
  const rawKind = textOf(prop(page, src, 'kind'))
  const kind = resolveKind(rawKind, src.valueMap)
  const categoryLink = categoryLinkOf(prop(page, src, 'category'))
  const { issues, categoryId } = validateMovement(
    { description, date, amount: conv, negative: rawAmount !== null && rawAmount < 0, kind, rawKind, categoryLink },
    categories,
  )
  return {
    id: page.id,
    url: page.url,
    description,
    date,
    amountCents: conv?.cents ?? null,
    kind,
    rawKind,
    categoryLink,
    categoryId,
    paymentMethod: textOf(prop(page, src, 'paymentMethod')),
    origin: src.fields.origin ? resolveOrigin(textOf(prop(page, src, 'origin'))) : 'unknown',
    issues,
    createdTime: page.createdTime,
    lastEditedTime: page.lastEditedTime,
  }
}

function splitAliases(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => {
      const k = nameKey(s)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

export function resolveCategoryKind(raw: string | null): CategoryKind {
  const k = nameKey(raw)
  return k === 'ingreso' || k === 'ingresos' || k === 'income' ? 'income' : 'expense'
}

export function pageToCategory(page: PageDto, src: SourceConfig): Category | null {
  const name = textOf(prop(page, src, 'name'))?.trim()
  if (!name) return null
  const statusRaw = nameKey(textOf(prop(page, src, 'status')))
  return {
    id: page.id,
    name,
    kind: resolveCategoryKind(textOf(prop(page, src, 'kind'))),
    color: textOf(prop(page, src, 'color'))?.trim() || 'stone',
    icon: textOf(prop(page, src, 'icon'))?.trim() || 'tag',
    status: statusRaw === 'archivada' || statusRaw === 'archivado' || statusRaw === 'archived' || statusRaw === 'inactiva' ? 'archived' : 'active',
    description: textOf(prop(page, src, 'description')) ?? '',
    aliases: splitAliases(textOf(prop(page, src, 'aliases'))),
    url: page.url,
    source: 'notion',
  }
}

/**
 * Catálogo a partir de las páginas de «Categorías». Si no hay catálogo configurado, se deducen categorías
 * implícitas (solo lectura) de los valores de los movimientos para no perder la agrupación existente.
 */
export function buildCategories(categoryPages: PageDto[] | null, catSrc: SourceConfig | undefined, movementPages: PageDto[], movSrc: SourceConfig): Category[] {
  if (categoryPages && catSrc) return categoryPages.map((p) => pageToCategory(p, catSrc)).filter((c): c is Category => c !== null)
  const names: { name: string; kind: CategoryKind }[] = []
  for (const p of movementPages) {
    const link = categoryLinkOf(prop(p, movSrc, 'category'))
    if (link?.type !== 'name') continue
    const kind = resolveKind(textOf(prop(p, movSrc, 'kind')), movSrc.valueMap)
    names.push({ name: link.name, kind: kind === 'income' ? 'income' : 'expense' })
  }
  return implicitCategories(names)
}

// ── Escrituras ────────────────────────────────────────────────────────────────────────────────────────────────

export class MappingError extends Error {}

function requireRef(src: SourceConfig, field: string, label: string): FieldRef {
  const ref = src.fields[field]
  if (!ref) throw new MappingError(`El campo «${label}» no está asignado a ninguna propiedad de Notion.`)
  return ref
}

function textWrite(ref: FieldRef, value: string | null, label: string): PropWrite {
  switch (ref.kind) {
    case 'title':
      return { type: 'title', value: value ?? '' }
    case 'rich_text':
      return { type: 'rich_text', value: value ?? '' }
    case 'select':
      return { type: 'select', value: value && value.trim() ? value.trim() : null }
    case 'status':
      return { type: 'status', value: value && value.trim() ? value.trim() : null }
    default:
      throw new MappingError(`La propiedad «${ref.name}» (${label}) es de tipo «${ref.kind}» y Lunar no puede escribir en ella.`)
  }
}

/** Escritura del vínculo de categoría según el tipo de la propiedad. */
export function categoryWrite(src: SourceConfig, category: Category | null): [string, PropWrite] {
  const ref = requireRef(src, 'category', 'Categoría')
  if (ref.kind === 'relation') {
    if (category && category.source !== 'notion') throw new MappingError('La relación necesita una categoría del catálogo de Notion.')
    return [ref.id, { type: 'relation', value: category ? [category.id] : [] }]
  }
  return [ref.id, textWrite(ref, category?.name ?? null, 'Categoría')]
}

export function originWrite(src: SourceConfig, origin: Exclude<ClassificationOrigin, 'unknown'>): [string, PropWrite] | null {
  const ref = src.fields.origin
  if (!ref) return null
  return [ref.id, textWrite(ref, ORIGIN_VALUES[origin], 'Origen')]
}

/** Valor actual (tal como lo leyó la interfaz) de las propiedades que se van a escribir. */
export function expectedValues(page: PageDto, propIds: string[]): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const id of propIds) {
    const v = page.properties[id]?.value
    if (v) out[id] = v
  }
  return out
}

export interface MovementDraft {
  description: string
  date: string
  amountCents: number
  kind: MovementKind
  category: Category | null
  paymentMethod: string | null
}

export function movementWrites(src: SourceConfig, draft: Partial<MovementDraft>, origin: Exclude<ClassificationOrigin, 'unknown'> | null): Record<string, PropWrite> {
  const w: Record<string, PropWrite> = {}
  if (draft.description !== undefined) {
    const ref = requireRef(src, 'description', 'Descripción')
    w[ref.id] = textWrite(ref, draft.description.trim(), 'Descripción')
  }
  if (draft.date !== undefined) {
    const ref = requireRef(src, 'date', 'Fecha')
    if (ref.kind !== 'date') throw new MappingError(`La fecha está en «${ref.name}» (${ref.kind}), que no se puede modificar.`)
    w[ref.id] = { type: 'date', value: draft.date }
  }
  if (draft.amountCents !== undefined) {
    const ref = requireRef(src, 'amount', 'Cantidad')
    if (ref.kind !== 'number') throw new MappingError(`El importe está en «${ref.name}» (${ref.kind}), que no se puede modificar.`)
    w[ref.id] = { type: 'number', value: centsToNumber(draft.amountCents) }
  }
  if (draft.kind !== undefined) {
    const ref = requireRef(src, 'kind', 'Tipo')
    w[ref.id] = textWrite(ref, kindLabel(draft.kind, src.valueMap), 'Tipo')
  }
  if (draft.category !== undefined) {
    const [id, write] = categoryWrite(src, draft.category)
    w[id] = write
  }
  if (draft.paymentMethod !== undefined && src.fields.paymentMethod) {
    const ref = src.fields.paymentMethod
    if (ref.kind === 'multi_select') throw new MappingError('El método de pago es de selección múltiple y Lunar no lo modifica.')
    w[ref.id] = textWrite(ref, draft.paymentMethod, 'Método de pago')
  }
  if (origin) {
    const o = originWrite(src, origin)
    if (o) w[o[0]] = o[1]
  }
  return w
}

export interface CategoryWriteDraft {
  name: string
  kind: CategoryKind
  status: 'active' | 'archived'
  color: string
  icon: string
  description: string
  aliases: string[]
}

export function categoryWrites(src: SourceConfig, d: Partial<CategoryWriteDraft>): Record<string, PropWrite> {
  const w: Record<string, PropWrite> = {}
  const set = (field: string, label: string, value: string | null, required = false) => {
    const ref = required ? requireRef(src, field, label) : src.fields[field]
    if (ref) w[ref.id] = textWrite(ref, value, label)
  }
  if (d.name !== undefined) set('name', 'Nombre', d.name.trim(), true)
  if (d.kind !== undefined) set('kind', 'Tipo', d.kind === 'income' ? 'Ingreso' : 'Gasto', true)
  if (d.status !== undefined) set('status', 'Estado', d.status === 'archived' ? 'Archivada' : 'Activa', true)
  if (d.color !== undefined) set('color', 'Color', d.color)
  if (d.icon !== undefined) set('icon', 'Icono', d.icon)
  if (d.description !== undefined) set('description', 'Descripción', d.description.trim())
  if (d.aliases !== undefined) set('aliases', 'Alias', d.aliases.map((a) => a.trim()).filter(Boolean).join(', '))
  return w
}

export function rebuildIndex(categories: Category[]): CategoryIndex {
  return new CategoryIndex(categories)
}
