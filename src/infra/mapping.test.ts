import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { cat } from '../test/factories'
import type { PageDto, SchemaDto, SourceConfig } from './contracts'
import { CATEGORY_FIELDS, MOVEMENT_FIELDS, suggestMapping } from './fieldSpecs'
import { MappingError, buildCategories, categoryWrite, expectedValues, movementWrites, pageToCategory, pageToMovement, resolveKind, variantsOf } from './mapping'

const src: SourceConfig = {
  dataSourceId: 'ds',
  fields: {
    description: { id: 'title', name: 'Descripción', kind: 'title' },
    date: { id: 'f', name: 'Fecha', kind: 'date' },
    amount: { id: 'q', name: 'Cantidad', kind: 'number' },
    kind: { id: 't', name: 'Tipo', kind: 'select' },
    category: { id: 'c', name: 'Categoría', kind: 'select' },
    paymentMethod: { id: 'm', name: 'Método de Pago', kind: 'select' },
  },
  valueMap: { expense: ['Gasto'], income: ['Ingreso'] },
}

function page(over: Partial<Record<string, PageDto['properties'][string]['value']>> = {}): PageDto {
  const props: PageDto['properties'] = {
    title: { name: 'Descripción', value: { type: 'title', value: 'Mercadona' } },
    f: { name: 'Fecha', value: { type: 'date', value: { start: '2026-10-05' } } },
    q: { name: 'Cantidad', value: { type: 'number', value: 23.45 } },
    t: { name: 'Tipo', value: { type: 'select', value: 'Gasto' } },
    c: { name: 'Categoría', value: { type: 'select', value: 'Alimentación' } },
    m: { name: 'Método de Pago', value: { type: 'select', value: 'Tarjeta' } },
  }
  for (const [k, v] of Object.entries(over)) props[k] = { name: k, value: v! }
  return { id: 'p1', url: null, createdTime: '2026-10-05T10:00:00Z', lastEditedTime: '2026-10-05T10:00:00Z', properties: props }
}

const food = cat('Alimentación')
const idx = new CategoryIndex([food])

describe('lectura de movimientos', () => {
  it('normaliza las propiedades del atajo «Gasto»', () => {
    const m = pageToMovement(page(), src, idx)
    expect(m).toMatchObject({ description: 'Mercadona', date: '2026-10-05', amountCents: 2345, kind: 'expense', categoryId: food.id, paymentMethod: 'Tarjeta', issues: [] })
  })

  it('trata la ausencia de datos como ausencia, no como cero', () => {
    const m = pageToMovement(page({ q: { type: 'number', value: null }, c: { type: 'select', value: null }, f: { type: 'date', value: null } }), src, idx)
    expect(m.amountCents).toBeNull()
    expect(m.categoryLink).toBeNull()
    expect(m.date).toBeNull()
    expect(m.issues.map((i) => i.code).sort()).toEqual(['missing_amount', 'missing_date'])
  })

  it('usa el valor absoluto de importes negativos y lo señala', () => {
    const m = pageToMovement(page({ q: { type: 'number', value: -12.5 } }), src, idx)
    expect(m.amountCents).toBe(1250)
    expect(m.issues.map((i) => i.code)).toEqual(['negative_amount'])
  })

  it('lee la categoría desde una relación', () => {
    const rel: SourceConfig = { ...src, fields: { ...src.fields, category: { id: 'c', name: 'Categoría', kind: 'relation' } } }
    const m = pageToMovement(page({ c: { type: 'relation', value: [food.id] } }), rel, idx)
    expect(m.categoryLink).toEqual({ type: 'id', id: food.id })
    expect(m.categoryId).toBe(food.id)
  })

  it('una propiedad mapeada que falta en la página no rompe la lectura', () => {
    const p = page()
    delete p.properties.m
    expect(pageToMovement(p, src, idx).paymentMethod).toBeNull()
  })
})

describe('tipos de movimiento', () => {
  it('respeta las correspondencias configuradas y no adivina valores desconocidos', () => {
    expect(resolveKind('Gasto', src.valueMap)).toBe('expense')
    expect(resolveKind('  INGRESO ', src.valueMap)).toBe('income')
    expect(resolveKind('Devolución', src.valueMap)).toBe('refund')
    expect(resolveKind('Ahorro', src.valueMap)).toBeNull()
    expect(resolveKind(null, src.valueMap)).toBeNull()
  })

  it('si un tipo tiene correspondencias configuradas, no se usan sinónimos para él', () => {
    expect(resolveKind('Gastos', { expense: ['Pago'] })).toBeNull()
    expect(resolveKind('Pago', { expense: ['Pago'] })).toBe('expense')
  })
})

describe('escrituras', () => {
  it('construye la escritura de categoría según el tipo de propiedad', () => {
    expect(categoryWrite(src, food)).toEqual(['c', { type: 'select', value: 'Alimentación' }])
    expect(categoryWrite(src, null)).toEqual(['c', { type: 'select', value: null }])
    const rel: SourceConfig = { ...src, fields: { ...src.fields, category: { id: 'c', name: 'Categoría', kind: 'relation' } } }
    expect(categoryWrite(rel, food)).toEqual(['c', { type: 'relation', value: [food.id] }])
    expect(() => categoryWrite(rel, cat('X', { source: 'implicit' }))).toThrow(MappingError)
  })

  it('construye un movimiento nuevo con importes en euros y el origen si está configurado', () => {
    const withOrigin: SourceConfig = { ...src, fields: { ...src.fields, origin: { id: 'o', name: 'Origen', kind: 'select' } } }
    const w = movementWrites(withOrigin, { description: ' Zara ', date: '2026-10-01', amountCents: 1995, kind: 'expense', category: food, paymentMethod: 'Tarjeta' }, 'manual')
    expect(w).toEqual({
      title: { type: 'title', value: 'Zara' },
      f: { type: 'date', value: '2026-10-01' },
      q: { type: 'number', value: 19.95 },
      t: { type: 'select', value: 'Gasto' },
      c: { type: 'select', value: 'Alimentación' },
      m: { type: 'select', value: 'Tarjeta' },
      o: { type: 'select', value: 'Manual' },
    })
  })

  it('reutiliza la variante exacta que ya usan los movimientos (p. ej. con espacio final del atajo)', () => {
    const pages = [
      page({ t: { type: 'select', value: 'Gasto ' }, c: { type: 'select', value: 'Alimentación ' } }),
      page({ t: { type: 'select', value: 'Gasto ' }, c: { type: 'select', value: 'Alimentación ' } }),
      page({ t: { type: 'select', value: 'Gasto' }, c: { type: 'select', value: 'Ocio' } }),
    ]
    const variants = { kind: variantsOf(pages, src.fields.kind), category: variantsOf(pages, src.fields.category) }
    expect(variants.kind.get('gasto')).toBe('Gasto ')
    const w = movementWrites(src, { kind: 'expense', category: food }, null, variants)
    expect(w.t).toEqual({ type: 'select', value: 'Gasto ' })
    expect(w.c).toEqual({ type: 'select', value: 'Alimentación ' })
    // Sin datos previos, se escribe el nombre del catálogo.
    expect(movementWrites(src, { category: cat('Viajes') }, null, variants).c).toEqual({ type: 'select', value: 'Viajes' })
  })

  it('no escribe en fórmulas ni en fechas de creación', () => {
    const formula: SourceConfig = { ...src, fields: { ...src.fields, amount: { id: 'q', name: 'Cantidad', kind: 'formula' } } }
    expect(() => movementWrites(formula, { amountCents: 100 }, null)).toThrow(MappingError)
  })

  it('los valores esperados son los actuales de las propiedades que se escriben', () => {
    expect(expectedValues(page(), ['c', 'nope'])).toEqual({ c: { type: 'select', value: 'Alimentación' } })
  })
})

describe('categorías', () => {
  const catSrc: SourceConfig = {
    dataSourceId: 'cats',
    fields: {
      name: { id: 'title', name: 'Nombre', kind: 'title' },
      kind: { id: 'k', name: 'Tipo', kind: 'select' },
      status: { id: 's', name: 'Estado', kind: 'select' },
      aliases: { id: 'a', name: 'Alias', kind: 'rich_text' },
    },
    valueMap: {},
  }
  const cpage = (name: string, kind: string, status: string, aliases = ''): PageDto => ({
    id: `id-${name}`,
    url: null,
    createdTime: '',
    lastEditedTime: '',
    properties: {
      title: { name: 'Nombre', value: { type: 'title', value: name } },
      k: { name: 'Tipo', value: { type: 'select', value: kind } },
      s: { name: 'Estado', value: { type: 'select', value: status } },
      a: { name: 'Alias', value: { type: 'rich_text', value: aliases } },
    },
  })

  it('lee nombre, tipo, estado y alias', () => {
    expect(pageToCategory(cpage('Nómina', 'Ingreso', 'Activa', 'Sueldo, salario;Sueldo'), catSrc)).toMatchObject({
      name: 'Nómina',
      kind: 'income',
      status: 'active',
      aliases: ['Sueldo', 'salario'],
      source: 'notion',
    })
    expect(pageToCategory(cpage('Gym', 'Gasto', 'Archivada'), catSrc)?.status).toBe('archived')
    expect(pageToCategory(cpage('', 'Gasto', 'Activa'), catSrc)).toBeNull()
  })

  it('sin catálogo deduce categorías implícitas de los movimientos', () => {
    const cats = buildCategories(null, undefined, [page(), page({ c: { type: 'select', value: 'Nómina' }, t: { type: 'select', value: 'Ingreso' } })], src)
    expect(cats.map((c) => [c.name, c.kind, c.source])).toEqual([
      ['Alimentación', 'expense', 'implicit'],
      ['Nómina', 'income', 'implicit'],
    ])
  })
})

describe('mapeo automático', () => {
  it('propone el mapeo del esquema del atajo', () => {
    const schema: SchemaDto = {
      id: 'ds',
      title: 'Gastos',
      databaseId: null,
      parentPageId: null,
      url: null,
      properties: [
        { id: 'title', name: 'Descripción', type: 'title' },
        { id: 'f', name: 'Fecha', type: 'date' },
        { id: 'c', name: 'Categoría', type: 'select' },
        { id: 't', name: 'Tipo', type: 'select' },
        { id: 'q', name: 'Cantidad', type: 'number' },
        { id: 'm', name: 'Método de Pago', type: 'select' },
        { id: 'x', name: 'Creado', type: 'created_time' },
      ],
    }
    const m = suggestMapping('movements', schema)
    expect(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.id]))).toEqual({ description: 'title', date: 'f', amount: 'q', kind: 't', category: 'c', paymentMethod: 'm' })
  })
})

describe('sincronía con la capa nativa', () => {
  it('la tabla de campos coincide con src-tauri/src/config.rs', () => {
    const rust = readFileSync(new URL('../../src-tauri/src/config.rs', import.meta.url), 'utf8')
    const re = /FieldSpec \{ key: "(\w+)", label: "[^"]+", types: &\[([^\]]*)\], required: (true|false), writable_types: &\[([^\]]*)\]/g
    const parsed = [...rust.matchAll(re)].map((m) => ({
      key: m[1],
      types: [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]),
      required: m[3] === 'true',
      writableTypes: [...m[4].matchAll(/"(\w+)"/g)].map((x) => x[1]),
    }))
    const ts = [...MOVEMENT_FIELDS, ...CATEGORY_FIELDS].map(({ key, types, required, writableTypes }) => ({ key, types, required, writableTypes }))
    expect(parsed).toEqual(ts)
  })
})
