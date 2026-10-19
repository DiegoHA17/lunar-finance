/**
 * Campos lógicos y tipos de propiedad aceptados. Espejo de `MOVEMENT_FIELDS` / `CATEGORY_FIELDS` en
 * `src-tauri/src/config.rs` (una prueba comprueba que coinciden).
 */

import { nameKey } from '../domain/text'
import type { FieldRef, Role, SchemaDto, SchemaProperty } from './contracts'

export interface FieldSpec {
  key: string
  label: string
  types: string[]
  required: boolean
  writableTypes: string[]
  help: string
  /** Nombres habituales (normalizados) para proponer el mapeo automáticamente. */
  synonyms: string[]
}

export const MOVEMENT_FIELDS: FieldSpec[] = [
  { key: 'description', label: 'Descripción', types: ['title', 'rich_text'], required: true, writableTypes: ['title', 'rich_text'], help: 'Concepto o comercio.', synonyms: ['descripcion', 'concepto', 'nombre', 'name', 'titulo', 'comercio'] },
  { key: 'date', label: 'Fecha', types: ['date', 'created_time'], required: true, writableTypes: ['date'], help: 'Fecha del movimiento.', synonyms: ['fecha', 'date', 'dia'] },
  { key: 'amount', label: 'Cantidad', types: ['number', 'formula'], required: true, writableTypes: ['number'], help: 'Importe en euros.', synonyms: ['cantidad', 'importe', 'monto', 'amount', 'precio', 'total', 'valor'] },
  { key: 'kind', label: 'Tipo', types: ['select', 'status', 'rich_text'], required: true, writableTypes: ['select', 'status', 'rich_text'], help: 'Gasto, ingreso, devolución o transferencia.', synonyms: ['tipo', 'type', 'clase', 'naturaleza'] },
  { key: 'category', label: 'Categoría', types: ['select', 'rich_text', 'relation'], required: true, writableTypes: ['select', 'rich_text', 'relation'], help: 'Selección, texto o relación con «Categorías».', synonyms: ['categoria', 'category', 'categorias'] },
  { key: 'paymentMethod', label: 'Método de pago', types: ['select', 'rich_text', 'multi_select'], required: false, writableTypes: ['select', 'rich_text'], help: 'Tarjeta, efectivo, Bizum…', synonyms: ['metodo de pago', 'metodo', 'forma de pago', 'pago', 'payment method', 'cuenta'] },
  { key: 'origin', label: 'Origen de la clasificación', types: ['select', 'rich_text'], required: false, writableTypes: ['select', 'rich_text'], help: 'Opcional: registra si la categoría la puso una regla, la IA o tú.', synonyms: ['origen clasificacion', 'origen de la clasificacion', 'origen', 'clasificacion'] },
]

export const CATEGORY_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Nombre', types: ['title'], required: true, writableTypes: ['title'], help: '', synonyms: ['nombre', 'name', 'categoria'] },
  { key: 'kind', label: 'Tipo', types: ['select'], required: true, writableTypes: ['select'], help: 'Gasto o Ingreso.', synonyms: ['tipo', 'type'] },
  { key: 'status', label: 'Estado', types: ['select', 'status'], required: true, writableTypes: ['select', 'status'], help: 'Activa o Archivada.', synonyms: ['estado', 'status'] },
  { key: 'color', label: 'Color', types: ['rich_text', 'select'], required: false, writableTypes: ['rich_text', 'select'], help: '', synonyms: ['color'] },
  { key: 'icon', label: 'Icono', types: ['rich_text'], required: false, writableTypes: ['rich_text'], help: '', synonyms: ['icono', 'icon'] },
  { key: 'description', label: 'Descripción', types: ['rich_text'], required: false, writableTypes: ['rich_text'], help: '', synonyms: ['descripcion', 'description', 'notas'] },
  { key: 'aliases', label: 'Alias', types: ['rich_text'], required: false, writableTypes: ['rich_text'], help: 'Nombres alternativos separados por comas.', synonyms: ['alias', 'aliases', 'sinonimos'] },
]

export function fieldSpecs(role: Role): FieldSpec[] {
  return role === 'movements' ? MOVEMENT_FIELDS : CATEGORY_FIELDS
}

export function toFieldRef(p: SchemaProperty): FieldRef {
  return { id: p.id, name: p.name, kind: p.type }
}

/**
 * Propone un mapeo por nombre (sin acentos ni mayúsculas) y tipo compatible. Para la descripción, si no hay
 * coincidencia de nombre, se usa la propiedad de título.
 */
export function suggestMapping(role: Role, schema: SchemaDto): Record<string, FieldRef> {
  const out: Record<string, FieldRef> = {}
  const used = new Set<string>()
  for (const spec of fieldSpecs(role)) {
    const candidates = schema.properties.filter((p) => spec.types.includes(p.type) && !used.has(p.id))
    let match = candidates.find((p) => spec.synonyms.includes(nameKey(p.name)))
    if (!match && ((role === 'movements' && spec.key === 'description') || (role === 'categories' && spec.key === 'name'))) {
      match = candidates.find((p) => p.type === 'title')
    }
    if (match) {
      out[spec.key] = toFieldRef(match)
      used.add(match.id)
    }
  }
  return out
}

export const DEFAULT_KIND_VALUES: Record<string, string[]> = {
  expense: ['Gasto'],
  income: ['Ingreso'],
  refund: ['Devolución'],
  transfer: ['Transferencia'],
}
