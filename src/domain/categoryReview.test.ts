import { describe, expect, it } from 'vitest'
import { blocking, cat, index, mov } from '../test/factories'
import { CategoryIndex } from './categories'
import { editDistance, reviewCategories, samePlural } from './categoryReview'
import type { Category, Movement } from './types'

const ocio = cat('Ocio')
const food = cat('Alimentación')
const restaurants = cat('Restaurantes')
const transport = cat('Transporte')
const clothes = cat('Ropa')
const health = cat('Salud')
const salary = cat('Nómina', { kind: 'income' })
const archived = cat('Gimnasio', { status: 'archived' })
const catalog = [ocio, food, restaurants, transport, clothes, health, salary, archived]
const idx = index(catalog)

/** Movimiento con la categoría escrita tal cual, resuelta como lo hace la sincronización. */
function written(name: string, over: Partial<Movement> = {}, ix: CategoryIndex = idx): Movement {
  const link = { type: 'name' as const, name }
  return mov({ categoryLink: link, categoryId: ix.resolve(link)?.id ?? null, ...over })
}

const groupOf = (movs: Movement[], name: string, ix = idx) => reviewCategories(movs, ix, 'notion').groups.find((g) => g.name === name)

describe('revisión de categorías: errores claros', () => {
  it('plural de una categoría existente → propuesta segura', () => {
    const g = groupOf([written('Ocios'), written('Ocios'), written('Ocio')], 'Ocios')!
    expect(g.level).toBe('safe')
    expect(g.proposal).toMatchObject({ categoryId: ocio.id, source: 'plural' })
    expect(g.movements).toHaveLength(2)
  })

  it('singular de una categoría en plural y plural en -es', () => {
    expect(groupOf([written('Restaurante')], 'Restaurante')!.proposal?.categoryId).toBe(restaurants.id)
    const devol = cat('Devoluciones', { kind: 'income' })
    const ix = index([devol])
    expect(groupOf([written('Devolución', { kind: 'income' }, ix)], 'Devolución', ix)!.proposal?.categoryId).toBe(devol.id)
  })

  it('errata de una letra en un nombre largo → segura; transposición también', () => {
    for (const typo of ['Transprte', 'Alimentacoin', 'Trasnporte']) {
      const g = groupOf([written(typo)], typo)!
      expect(g.level, typo).toBe('safe')
      expect(g.proposal?.source).toBe('spelling')
    }
    expect(editDistance('transporte', 'trasnporte')).toBe(1)
  })

  it('agrupa variantes que solo difieren en mayúsculas, tildes o espacios y cuenta los movimientos', () => {
    const review = reviewCategories([written('Ocios'), written('ocios '), written('OCIOS')], idx, 'notion')
    expect(review.groups).toHaveLength(1)
    expect(review.groups[0].movements).toHaveLength(3)
    expect(review.groups[0].variants.sort()).toEqual(['OCIOS', 'Ocios', 'ocios '].sort())
    expect(review.groups[0].proposal?.categoryId).toBe(ocio.id)
  })
})

describe('revisión de categorías: variantes ya reconocidas', () => {
  it('mayúsculas, tildes y espacios no son errores: se informan sin proponer cambios', () => {
    const review = reviewCategories([written('alimentacion'), written('Ocio '), written('Ocio '), written('Ocio')], idx, 'notion')
    expect(review.groups).toHaveLength(0)
    const byName = Object.fromEntries(review.recognized.map((r) => [r.written, r]))
    expect(byName['alimentacion']).toMatchObject({ count: 1, difference: 'tildes, mayúsculas' })
    expect(byName['Ocio ']).toMatchObject({ count: 2, difference: 'espacios' })
    expect(byName['Ocio']).toBeUndefined()
  })
})

describe('revisión de categorías: falsos positivos y casos dudosos', () => {
  it('categoría inexistente sin parecido: sin propuesta', () => {
    const g = groupOf([written('Mascotas')], 'Mascotas')!
    expect(g.level).toBe('none')
    expect(g.proposal).toBeNull()
  })

  it('nombres cortos parecidos pero distintos no se dan por equivalentes', () => {
    // «Roma» está a una letra de «Ropa», pero con 4 letras no es segura.
    const roma = groupOf([written('Roma')], 'Roma')!
    expect(roma.level).toBe('doubtful')
    // «Saldo» está a dos letras de «Salud»: con 5 letras no se propone.
    expect(groupOf([written('Saldo')], 'Saldo')!.proposal).toBeNull()
    // Nombres de 3 letras: nunca por similitud.
    expect(groupOf([written('Bar')], 'Bar')!.proposal).toBeNull()
  })

  it('una errata en la primera letra no es segura', () => {
    expect(groupOf([written('Pransporte')], 'Pransporte')!.level).toBe('doubtful')
  })

  it('nombres que solo difieren en números no son erratas', () => {
    const ix = index([cat('Gastos 2024')])
    expect(groupOf([written('Gastos 2025', {}, ix)], 'Gastos 2025', ix)!.proposal).toBeNull()
  })

  it('si se parece a varias categorías por igual, es ambigua: no hay propuesta y se listan los candidatos', () => {
    const a = cat('Cafetería')
    const b = cat('Cafeterías bar')
    const c1 = cat('Libros')
    const c2 = cat('Libres')
    const ix = index([a, b, c1, c2])
    const g = groupOf([written('Libras', {}, ix)], 'Libras', ix)!
    expect(g.proposal).toBeNull()
    expect(g.level).toBe('doubtful')
    expect(g.candidates.sort()).toEqual([c1.id, c2.id].sort())
  })

  it('un alias compartido por dos categorías (sin resolver) queda como ambiguo', () => {
    const a = cat('Supermercado', { aliases: ['Súper'] })
    const b = cat('Superdescuentos', { aliases: ['Super'] })
    const ix = index([a, b])
    const g = groupOf([written('super', {}, ix)], 'super', ix)!
    expect(g.proposal).toBeNull()
    expect(g.candidates).toHaveLength(2)
  })

  it('no propone una categoría de otro tipo ni una archivada', () => {
    // «Nóminas» es un ingreso: en un gasto no se propone «Nómina».
    expect(groupOf([written('Nóminas')], 'Nóminas')!.proposal).toBeNull()
    expect(groupOf([written('Nóminas', { kind: 'income' })], 'Nóminas')!.proposal?.categoryId).toBe(salary.id)
    // «Gimnasios» se parecería a «Gimnasio», pero está archivada.
    expect(groupOf([written('Gimnasios')], 'Gimnasios')!.proposal).toBeNull()
  })

  it('separa por tipo el mismo nombre usado en gastos e ingresos', () => {
    const review = reviewCategories([written('Varios'), written('Varios', { kind: 'income' })], idx, 'notion')
    expect(review.groups.map((g) => g.kind).sort()).toEqual(['expense', 'income'])
  })

  it('las transferencias y los movimientos excluidos se dejan como están', () => {
    const review = reviewCategories([written('Ocios', { kind: 'transfer' }), written('Ocios', { issues: [blocking()] })], idx, 'notion')
    expect(review.groups).toHaveLength(0)
    expect(review.skipped).toBe(1)
  })

  it('las seguras van primero, después las dudosas y las que no tienen propuesta', () => {
    const levels = reviewCategories([written('Mascotas'), written('Roma'), written('Ocios')], idx, 'notion').groups.map((g) => g.level)
    expect(levels).toEqual(['safe', 'doubtful', 'none'])
  })
})

describe('revisión de categorías sin catálogo (categorías implícitas)', () => {
  function implicitSetup(names: string[]) {
    const keys = [...new Set(names.map((n) => n.toLowerCase()))]
    const cats: Category[] = keys.map((k) => cat(k[0].toUpperCase() + k.slice(1), { id: `implicit:${k}`, source: 'implicit' }))
    const ix = new CategoryIndex(cats)
    return { ix, movs: names.map((n) => written(n, {}, ix)) }
  }

  it('propone la variante más usada para la minoritaria, nunca al revés', () => {
    const { ix, movs } = implicitSetup(['Ocio', 'Ocio', 'Ocio', 'Ocios'])
    const review = reviewCategories(movs, ix, 'implicit')
    expect(review.groups).toHaveLength(1)
    expect(review.groups[0]).toMatchObject({ name: 'Ocios', level: 'safe' })
    expect(review.groups[0].proposal?.categoryId).toBe('implicit:ocio')
  })

  it('no lista categorías implícitas que no se parecen a otra', () => {
    const { ix, movs } = implicitSetup(['Ocio', 'Transporte'])
    expect(reviewCategories(movs, ix, 'implicit').groups).toHaveLength(0)
  })
})

describe('utilidades', () => {
  it('singular/plural palabra a palabra', () => {
    expect(samePlural('otros ingresos', 'otro ingreso')).toBe(true)
    expect(samePlural('ocio', 'ocios')).toBe(true)
    expect(samePlural('ropa', 'roma')).toBe(false)
    expect(samePlural('mes', 'me')).toBe(false)
  })
})
