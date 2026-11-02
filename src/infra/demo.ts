/**
 * Backend de DEMOSTRACIÓN. Emula en memoria la semántica de la API de Notion (fuentes de datos, páginas,
 * propiedades por ID, control de concurrencia) con datos ficticios generados de forma determinista.
 *
 * Todo lo que muestra está marcado como demostración en la interfaz y en los informes. No escribe en Notion ni en
 * el archivo de reglas real.
 */

import { addDays, makeDate, parts, today } from '../domain/dates'
import type { Backend, StoreName } from './backend'
import {
  type AppConfig,
  type DiagnosticReport,
  LunarError,
  type PageDto,
  type PropValue,
  type PropWrite,
  type PropertySpec,
  type QueryResult,
  type Role,
  type SchemaDto,
  type SchemaProperty,
  type SourceSummary,
} from './contracts'

export const DEMO_MOVEMENTS_DS = 'demo0000000000000000000000000001'
export const DEMO_CATEGORIES_DS = 'demo0000000000000000000000000002'

/** Generador pseudoaleatorio determinista (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MOV_SCHEMA: SchemaProperty[] = [
  { id: 'title', name: 'Descripción', type: 'title' },
  { id: 'fecha', name: 'Fecha', type: 'date' },
  { id: 'cat', name: 'Categoría', type: 'select', options: [] },
  { id: 'tipo', name: 'Tipo', type: 'select', options: ['Gasto', 'Ingreso', 'Devolución', 'Transferencia'] },
  { id: 'cant', name: 'Cantidad', type: 'number' },
  { id: 'metodo', name: 'Método de Pago', type: 'select', options: ['Tarjeta', 'Efectivo', 'Bizum', 'Transferencia'] },
]

const CAT_SCHEMA: SchemaProperty[] = [
  { id: 'title', name: 'Nombre', type: 'title' },
  { id: 'ctipo', name: 'Tipo', type: 'select', options: ['Gasto', 'Ingreso'] },
  { id: 'cestado', name: 'Estado', type: 'select', options: ['Activa', 'Archivada'] },
  { id: 'ccolor', name: 'Color', type: 'rich_text' },
  { id: 'cicono', name: 'Icono', type: 'rich_text' },
  { id: 'cdesc', name: 'Descripción', type: 'rich_text' },
  { id: 'calias', name: 'Alias', type: 'rich_text' },
]

type Cat = [name: string, kind: 'Gasto' | 'Ingreso', color: string, icon: string, status?: 'Archivada', aliases?: string]

const CATS: Cat[] = [
  ['Alimentación', 'Gasto', 'sage', 'shopping-basket', undefined, 'Supermercado'],
  ['Restaurantes', 'Gasto', 'amber', 'utensils'],
  ['Ocio', 'Gasto', 'violet', 'sparkles'],
  ['Ropa', 'Gasto', 'rose', 'shirt'],
  ['Transporte', 'Gasto', 'sky', 'train'],
  ['Vivienda', 'Gasto', 'slate', 'home'],
  ['Suscripciones', 'Gasto', 'indigo', 'repeat'],
  ['Salud', 'Gasto', 'teal', 'heart-pulse'],
  ['Estudios', 'Gasto', 'ochre', 'graduation-cap'],
  ['Viajes', 'Gasto', 'cyan', 'plane'],
  ['Otros', 'Gasto', 'stone', 'circle-dashed'],
  ['Gimnasio', 'Gasto', 'rose', 'dumbbell', 'Archivada'],
  ['Nómina', 'Ingreso', 'moon', 'briefcase'],
  ['Becas', 'Ingreso', 'sage', 'graduation-cap'],
  ['Otros ingresos', 'Ingreso', 'stone', 'plus-circle'],
]

const MERCHANTS: Record<string, [string, number, number][]> = {
  Alimentación: [['Mercadona', 18, 85], ['Lidl', 12, 60], ['Carrefour Express', 6, 30], ['Frutería La Huerta', 5, 18]],
  Restaurantes: [['Bar Manolo', 6, 22], ['Sushi Kyoto', 18, 40], ['Telepizza', 12, 26], ['Cafetería Central', 2.2, 6.5]],
  Ocio: [['Cine Yelmo', 7.9, 18], ['Discoteca Fabrik', 15, 35], ['Entradas concierto', 25, 60], ['Steam', 5, 40]],
  Ropa: [['Zara', 19.95, 69.95], ['Pull&Bear', 15.99, 39.99], ['Decathlon', 9.99, 49.99]],
  Transporte: [['Renfe Cercanías', 2.6, 12], ['Metro recarga abono', 20, 20], ['Cabify', 7, 19], ['Gasolinera Repsol', 30, 55]],
  Salud: [['Farmacia', 4.5, 22], ['Óptica', 35, 120]],
  Estudios: [['Librería Casa del Libro', 12, 45], ['Udemy', 9.99, 14.99]],
  Viajes: [['Ryanair', 29, 120], ['Booking hotel', 60, 180], ['Alsa', 14, 32]],
  Otros: [['Regalo cumpleaños', 15, 45], ['Ferretería', 4, 25]],
}

const METHODS = ['Tarjeta', 'Tarjeta', 'Tarjeta', 'Efectivo', 'Bizum']

function rt(v: string): PropValue {
  return { type: 'rich_text', value: v }
}

interface StoredPage {
  page: PageDto
  ds: string
  inTrash: boolean
}

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const
  private pages = new Map<string, StoredPage>()
  private schemas = new Map<string, SchemaDto>()
  private config: AppConfig
  private stores = new Map<StoreName, unknown>()
  private seq = 0
  /** Latencia simulada (ms) para que se vean los estados de carga. 0 en pruebas. */
  private latency: number

  constructor(latency = 250) {
    this.latency = latency
    this.config = this.seed()
  }

  private async wait<T>(v: T): Promise<T> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency * (0.6 + Math.random() * 0.8)))
    return structuredClone(v)
  }

  private newId(): string {
    this.seq++
    return `demo${String(this.seq).padStart(28, '0')}`
  }

  private addPage(ds: string, props: Record<string, PropValue>, created: string): PageDto {
    const id = this.newId()
    const schema = this.schemas.get(ds)!
    const properties: PageDto['properties'] = {}
    for (const p of schema.properties) {
      properties[p.id] = { name: p.name, value: props[p.id] ?? emptyValue(p.type) }
    }
    const page: PageDto = { id, url: null, createdTime: created, lastEditedTime: created, properties }
    this.pages.set(id, { page, ds, inTrash: false })
    return page
  }

  private seed(): AppConfig {
    this.schemas.set(DEMO_MOVEMENTS_DS, { id: DEMO_MOVEMENTS_DS, title: 'Gastos (demo)', databaseId: null, parentPageId: 'demo-parent', url: null, properties: structuredClone(MOV_SCHEMA) })
    this.schemas.set(DEMO_CATEGORIES_DS, { id: DEMO_CATEGORIES_DS, title: 'Categorías (demo)', databaseId: null, parentPageId: 'demo-parent', url: null, properties: structuredClone(CAT_SCHEMA) })

    for (const [name, kind, color, icon, status, aliases] of CATS) {
      this.addPage(
        DEMO_CATEGORIES_DS,
        {
          title: { type: 'title', value: name },
          ctipo: { type: 'select', value: kind },
          cestado: { type: 'select', value: status ?? 'Activa' },
          ccolor: rt(color),
          cicono: rt(icon),
          cdesc: rt(''),
          calias: rt(aliases ?? ''),
        },
        '2025-01-01T09:00:00.000Z',
      )
    }

    const rand = rng(20261019)
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
    const euros = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100
    const end = today()
    const { year, month } = parts(end)
    // Desde el día 1 de hace 14 meses: hay año anterior para comparar y un cambio de año en los datos.
    let startMonth = month - 14
    let startYear = year
    while (startMonth <= 0) {
      startMonth += 12
      startYear--
    }
    const start = makeDate(startYear, startMonth, 1)
    const recentFrom = addDays(end, -45)

    const mov = (date: string, desc: string, amount: number | null, kind: string | null, category: string | null, method: string | null) => {
      const catOptions = this.schemas.get(DEMO_MOVEMENTS_DS)!.properties.find((p) => p.id === 'cat')!.options!
      if (category && !catOptions.includes(category)) catOptions.push(category)
      this.addPage(
        DEMO_MOVEMENTS_DS,
        {
          title: { type: 'title', value: desc },
          fecha: { type: 'date', value: { start: date } },
          cat: { type: 'select', value: category },
          tipo: { type: 'select', value: kind },
          cant: { type: 'number', value: amount },
          metodo: { type: 'select', value: method },
        },
        `${date}T${String(8 + Math.floor(rand() * 12)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`,
      )
    }

    for (let d = start; d <= end; d = addDays(d, 1)) {
      const p = parts(d)
      const recent = d >= recentFrom
      // Gastos diarios: 0–3 por día.
      const n = Math.floor(rand() * 3.2)
      for (let i = 0; i < n; i++) {
        const category = pick(['Alimentación', 'Alimentación', 'Restaurantes', 'Restaurantes', 'Transporte', 'Ocio', 'Ropa', 'Salud', 'Estudios', 'Otros'])
        const [desc, min, max] = pick(MERCHANTS[category])
        // En las últimas semanas, parte de los gastos llega sin categoría desde el atajo (para clasificar).
        const uncategorized = recent && rand() < 0.3
        mov(d, desc, euros(min, max), 'Gasto', uncategorized ? null : category, pick(METHODS))
      }
      if (p.day === 1) {
        mov(d, 'Alquiler piso', 650, 'Gasto', 'Vivienda', 'Transferencia')
        mov(d, 'Spotify', 10.99, 'Gasto', recent ? null : 'Suscripciones', 'Tarjeta')
      }
      if (p.day === 3) mov(d, 'Netflix', 13.99, 'Gasto', 'Suscripciones', 'Tarjeta')
      if (p.day === 5) mov(d, 'Factura luz Iberdrola', euros(38, 72), 'Gasto', 'Vivienda', 'Transferencia')
      if (p.day === 8) mov(d, 'Internet Digi', 30, 'Gasto', 'Vivienda', 'Transferencia')
      if (p.day === 2 && d < addDays(end, -200)) mov(d, 'Basic-Fit cuota', 24.99, 'Gasto', 'Gimnasio', 'Tarjeta')
      if (p.day === 28) {
        mov(d, 'Nómina Estudio Creativo SL', euros(1680, 1720), 'Ingreso', 'Nómina', 'Transferencia')
        mov(d, 'Traspaso a cuenta ahorro', 200, 'Transferencia', null, 'Transferencia')
      }
      if (p.day === 15 && (p.month === 11 || p.month === 3)) mov(d, 'Beca MEC', 900, 'Ingreso', 'Becas', 'Transferencia')
      if (p.day === 20 && rand() < 0.5) mov(d, 'Bizum de Laura (cena)', euros(10, 25), 'Ingreso', 'Otros ingresos', 'Bizum')
      if (p.day === 12 && rand() < 0.35) mov(d, 'Devolución Zara', euros(19.95, 39.95), 'Devolución', 'Ropa', 'Tarjeta')
      if (p.day === 18 && rand() < 0.3) mov(d, pick(MERCHANTS.Viajes)[0], euros(29, 160), 'Gasto', 'Viajes', 'Tarjeta')
    }

    // Casos que la aplicación debe tratar con cuidado.
    const r1 = addDays(end, -3)
    mov(r1, 'Café', 1.6, 'Gasto', 'Restaurantes', 'Efectivo')
    mov(r1, 'Café', 1.6, 'Gasto', 'Restaurantes', 'Efectivo')
    mov(addDays(end, -6), 'Pienso gato', 23.4, 'Gasto', 'Mascotas', 'Tarjeta')
    mov(addDays(end, -9), 'Ingreso hucha', 50, 'Ahorro', null, 'Efectivo')
    mov(addDays(end, -11), 'Mercadona', null, 'Gasto', null, 'Tarjeta')
    mov(addDays(end, -2), 'Discoteca Fabrik', -22, 'Gasto', null, 'Tarjeta')
    mov(addDays(end, -1), 'Renfe Cercanías', 2.6, 'Gasto', null, 'Tarjeta')
    // Categorías escritas a mano con erratas o fuera del catálogo (revisión de categorías).
    mov(addDays(end, -4), 'Cine Yelmo', 8.5, 'Gasto', 'Ocios', 'Tarjeta')
    mov(addDays(end, -13), 'Bolera', 12, 'Gasto', 'Ocios', 'Tarjeta')
    mov(addDays(end, -5), 'Bar Manolo', 9.8, 'Gasto', 'Restaurante', 'Efectivo')
    mov(addDays(end, -7), 'Taxi aeropuerto', 31, 'Gasto', 'Transprte', 'Tarjeta')
    mov(addDays(end, -8), 'Kebab', 7.5, 'Gasto', 'Comida fuera', 'Efectivo')
    mov(addDays(end, -10), 'Concierto', 25, 'Gasto', 'ocio ', 'Tarjeta')

    this.stores.set('rules', {
      version: 1,
      rules: [
        ['mercadona', 'Alimentación'],
        ['lidl', 'Alimentación'],
        ['renfe', 'Transporte'],
        ['spotify', 'Suscripciones'],
        ['netflix', 'Suscripciones'],
        ['zara', 'Ropa'],
        ['discoteca', 'Ocio'],
      ].map(([pattern, cat], i) => ({
        id: `demo-rule-${i}`,
        pattern,
        field: 'description',
        match: pattern === 'zara' ? 'word' : 'contains',
        accentSensitive: false,
        categoryId: '',
        categoryName: cat,
        priority: 50,
        active: true,
        conditions: {},
        exceptions: [],
        createdAt: `2026-01-0${(i % 9) + 1}T10:00:00.000Z`,
        source: 'manual',
      })),
    })

    const f = (id: string, name: string, kind: string) => ({ id, name, kind })
    return {
      version: 1,
      notion: {
        movements: {
          dataSourceId: DEMO_MOVEMENTS_DS,
          title: 'Gastos (demo)',
          fields: {
            description: f('title', 'Descripción', 'title'),
            date: f('fecha', 'Fecha', 'date'),
            category: f('cat', 'Categoría', 'select'),
            kind: f('tipo', 'Tipo', 'select'),
            amount: f('cant', 'Cantidad', 'number'),
            paymentMethod: f('metodo', 'Método de Pago', 'select'),
          },
          valueMap: { expense: ['Gasto'], income: ['Ingreso'], refund: ['Devolución'], transfer: ['Transferencia'] },
        },
        categories: {
          dataSourceId: DEMO_CATEGORIES_DS,
          title: 'Categorías (demo)',
          fields: {
            name: f('title', 'Nombre', 'title'),
            kind: f('ctipo', 'Tipo', 'select'),
            status: f('cestado', 'Estado', 'select'),
            color: f('ccolor', 'Color', 'rich_text'),
            icon: f('cicono', 'Icono', 'rich_text'),
            description: f('cdesc', 'Descripción', 'rich_text'),
            aliases: f('calias', 'Alias', 'rich_text'),
          },
          valueMap: {},
        },
      },
    }
  }

  private dsFor(role: Role): string {
    const src = role === 'movements' ? this.config.notion.movements : this.config.notion.categories
    if (!src) throw new LunarError({ code: 'config', message: `No hay ninguna base de datos de ${role === 'movements' ? 'Movimientos' : 'Categorías'} configurada.` })
    return src.dataSourceId
  }

  async credentialsStatus() {
    return { configured: true }
  }
  async setToken() {
    return { configured: true }
  }
  async clearToken() {
    return { configured: true }
  }
  async getConfig() {
    return structuredClone(this.config)
  }
  async setConfig(config: AppConfig) {
    this.config = structuredClone(config)
    return structuredClone(config)
  }

  async diagnose(): Promise<DiagnosticReport> {
    return this.wait({
      steps: [
        { id: 'demo', title: 'Modo demostración', status: 'warning', detail: 'Los datos son ficticios y se generan en memoria. No hay conexión con Notion.' },
        { id: 'movements.access', title: 'Acceso a Movimientos', status: 'ok', detail: 'Fuente «Gastos (demo)» disponible.' },
        { id: 'movements.schema', title: 'Esquema de Movimientos', status: 'ok', detail: 'Todas las propiedades asignadas existen.' },
        { id: 'categories.access', title: 'Acceso a Categorías', status: 'ok', detail: 'Fuente «Categorías (demo)» disponible.' },
      ],
      movementsReady: true,
      categoriesReady: Boolean(this.config.notion.categories),
      integrationName: 'Demostración',
      workspaceName: null,
    })
  }

  async listSources(): Promise<SourceSummary[]> {
    return this.wait([...this.schemas.values()].map((s) => ({ id: s.id, title: s.title, databaseId: null, url: null })))
  }
  async resolveSource(input: string) {
    const s = this.schemas.get(input.trim())
    if (!s) throw new LunarError({ code: 'not_found', message: 'En modo demostración solo existen las fuentes de ejemplo.' })
    return this.wait([{ id: s.id, title: s.title, databaseId: null, url: null }])
  }
  async getSchema(dataSourceId: string) {
    const s = this.schemas.get(dataSourceId)
    if (!s) throw new LunarError({ code: 'not_found', message: 'Fuente de datos de demostración no encontrada.' })
    return this.wait(s)
  }

  async query(role: Role): Promise<QueryResult> {
    const ds = this.dsFor(role)
    const pages = [...this.pages.values()].filter((p) => p.ds === ds && !p.inTrash).map((p) => p.page)
    return this.wait({ pages, fetchedAt: new Date().toISOString(), complete: true, incompleteReason: null, skippedInTrash: 0, duplicatesRemoved: 0 })
  }

  private applyWrites(schema: SchemaDto, page: PageDto, writes: Record<string, PropWrite>) {
    for (const [pid, w] of Object.entries(writes)) {
      const p = schema.properties.find((x) => x.id === pid)
      if (!p) throw new LunarError({ code: 'schema', message: `La propiedad «${pid}» no existe.` })
      if (p.type !== w.type) throw new LunarError({ code: 'schema', message: `La propiedad «${p.name}» es de tipo «${p.type}», no «${w.type}».` })
      if ((w.type === 'select' || w.type === 'status') && w.value) {
        if (w.value.includes(',')) throw new LunarError({ code: 'validation', message: 'Notion no admite comas en las opciones de selección.' })
        if (!p.options!.includes(w.value)) p.options!.push(w.value)
      }
      page.properties[pid] = { name: p.name, value: writeToValue(w) }
    }
    page.lastEditedTime = new Date().toISOString()
  }

  async createPage(role: Role, properties: Record<string, PropWrite>) {
    const ds = this.dsFor(role)
    const schema = this.schemas.get(ds)!
    const page = this.addPage(ds, {}, new Date().toISOString())
    try {
      this.applyWrites(schema, page, properties)
    } catch (e) {
      this.pages.delete(page.id)
      throw e
    }
    return this.wait(page)
  }

  async updatePage(role: Role, pageId: string, expected: Record<string, PropValue>, properties: Record<string, PropWrite>) {
    const ds = this.dsFor(role)
    const stored = this.pages.get(pageId)
    if (!stored || stored.ds !== ds) throw new LunarError({ code: 'validation', message: 'La página no pertenece a la fuente de datos configurada; no se ha modificado.' })
    if (stored.inTrash) throw new LunarError({ code: 'conflict', message: 'La página está en la papelera.' })
    for (const [pid, v] of Object.entries(expected)) {
      if (JSON.stringify(stored.page.properties[pid]?.value) !== JSON.stringify(v)) {
        throw new LunarError({
          code: 'conflict',
          message: 'El movimiento ha cambiado en Notion desde la última actualización; no se ha sobrescrito.',
          hint: 'Actualiza los datos, revisa el cambio y vuelve a intentarlo.',
        })
      }
    }
    const copy = structuredClone(stored.page)
    this.applyWrites(this.schemas.get(ds)!, copy, properties)
    stored.page = copy
    return this.wait(copy)
  }

  async addProperties(role: Role, specs: Record<string, PropertySpec>) {
    const ds = this.dsFor(role)
    const schema = this.schemas.get(ds)!
    for (const [name, spec] of Object.entries(specs)) {
      if (schema.properties.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        throw new LunarError({ code: 'validation', message: `Ya existe una propiedad llamada «${name}»; no se ha modificado nada.` })
      }
      const id = `p${schema.properties.length}`
      schema.properties.push({ id, name, type: spec.type, options: spec.type === 'select' ? [...spec.options] : undefined })
      for (const s of this.pages.values()) if (s.ds === ds) s.page.properties[id] = { name, value: emptyValue(spec.type) }
    }
    return this.wait(schema)
  }

  async createCategoriesDatabase(): Promise<SchemaDto> {
    throw new LunarError({ code: 'validation', message: 'El modo demostración ya incluye una base de datos de categorías.' })
  }

  async readStore(name: StoreName) {
    return structuredClone(this.stores.get(name) ?? null)
  }
  async writeStore(name: StoreName, value: unknown) {
    this.stores.set(name, structuredClone(value))
  }
  /** Una sola instancia en memoria: el cerrojo en proceso de `services/recurring.ts` basta. */
  async acquireRunLock() {
    return true
  }
  async releaseRunLock() {}
}

function emptyValue(type: string): PropValue {
  switch (type) {
    case 'title':
      return { type: 'title', value: '' }
    case 'rich_text':
      return { type: 'rich_text', value: '' }
    case 'number':
      return { type: 'number', value: null }
    case 'select':
      return { type: 'select', value: null }
    case 'date':
      return { type: 'date', value: null }
    case 'relation':
      return { type: 'relation', value: [] }
    default:
      return { type: 'unsupported', value: type }
  }
}

function writeToValue(w: PropWrite): PropValue {
  switch (w.type) {
    case 'date':
      return { type: 'date', value: w.value ? { start: w.value } : null }
    default:
      return w as PropValue
  }
}
