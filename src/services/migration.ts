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
    description: 'Añade a tu base de datos de movimientos una propiedad de selección para saber si la categoría la asignó una regla, la IA o tú.',
    changes: [`Nueva propiedad «${ORIGIN_PROPERTY_NAME}» (selección) con las opciones: ${Object.values(ORIGIN_VALUES).join(', ')}.`],
    consequences: [
      'No se modifica ni se elimina ninguna propiedad existente.',
      'Los movimientos actuales quedan con el origen vacío («desconocido»), que Lunar trata como manual: nunca los reclasifica.',
      'El atajo del iPhone sigue funcionando igual: puede ignorar la nueva propiedad.',
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
