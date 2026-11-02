/**
 * Cambios de esquema opcionales y NO destructivos. Cada uno se presenta antes como plan; nada se ejecuta sin
 * confirmación y nunca se eliminan ni se modifican propiedades existentes.
 */

import type { Backend } from '../infra/backend'
import { type AppConfig, LunarError } from '../infra/contracts'
import { toFieldRef } from '../infra/fieldSpecs'
import { ORIGIN_VALUES } from '../infra/mapping'

export const ORIGIN_PROPERTY_NAME = 'Origen clasificación'

export interface MigrationPlan {
  id: 'origin-property'
  title: string
  description: string
  changes: string[]
  consequences: string[]
}

export function originPropertyPlan(config: AppConfig): MigrationPlan | null {
  if (!config.notion.movements || config.notion.movements.fields.origin) return null
  return {
    id: 'origin-property',
    title: 'Registrar el origen de cada clasificación',
    description: 'Registra si la categoría la asignó una regla, la IA o tú.',
    changes: [`Nueva propiedad «${ORIGIN_PROPERTY_NAME}» (selección) con las opciones: ${Object.values(ORIGIN_VALUES).join(', ')}.`],
    consequences: [
      'No se modifica ni se elimina ninguna propiedad existente.',
      'El atajo del iPhone no se ve afectado.',
    ],
  }
}

export async function applyOriginProperty(backend: Backend, config: AppConfig): Promise<AppConfig> {
  const src = config.notion.movements
  if (!src) throw new LunarError({ code: 'config', message: 'No hay ninguna base de datos de movimientos configurada.' })
  const schema = await backend.addProperties('movements', { [ORIGIN_PROPERTY_NAME]: { type: 'select', options: Object.values(ORIGIN_VALUES) } })
  const prop = schema.properties.find((p) => p.name === ORIGIN_PROPERTY_NAME)
  if (!prop) throw new LunarError({ code: 'schema', message: 'Notion no devolvió la propiedad creada.' })
  return backend.setConfig({ ...config, notion: { ...config.notion, movements: { ...src, fields: { ...src.fields, origin: toFieldRef(prop) } } } })
}

export const RECURRENCE_PROPERTY_NAME = 'Pago periódico'

/** Propiedad de texto donde se guarda la clave de cada ocurrencia de un pago periódico. */
export function recurrencePropertyPlan(config: AppConfig): { changes: string[]; consequences: string[] } | null {
  if (!config.notion.movements || config.notion.movements.fields.recurrence) return null
  return {
    changes: [`Nueva propiedad «${RECURRENCE_PROPERTY_NAME}» (texto) en la base de movimientos.`],
    consequences: [
      'Lunar escribe en ella un identificador en cada movimiento que crea un pago periódico, para no registrarlo dos veces.',
      'No se modifica ni se elimina ninguna propiedad ni ningún movimiento existente. El atajo del iPhone no se ve afectado.',
    ],
  }
}

export async function applyRecurrenceProperty(backend: Backend, config: AppConfig): Promise<AppConfig> {
  const src = config.notion.movements
  if (!src) throw new LunarError({ code: 'config', message: 'No hay ninguna base de datos de movimientos configurada.' })
  const schema = await backend.addProperties('movements', { [RECURRENCE_PROPERTY_NAME]: { type: 'rich_text' } })
  const prop = schema.properties.find((p) => p.name === RECURRENCE_PROPERTY_NAME)
  if (!prop) throw new LunarError({ code: 'schema', message: 'Notion no devolvió la propiedad creada.' })
  return backend.setConfig({ ...config, notion: { ...config.notion, movements: { ...src, fields: { ...src.fields, recurrence: toFieldRef(prop) } } } })
}
