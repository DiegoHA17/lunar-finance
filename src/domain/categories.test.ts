import { describe, expect, it } from 'vitest'
import { cat, index, mov } from '../test/factories'
import { CategoryIndex, aliasesAfterRename, canAssign, implicitCategories, validateCategoryDraft } from './categories'
import { findDuplicatesOf, flagPossibleDuplicates, needsClassification, validateMovement } from './movements'

const food = cat('Alimentación', { aliases: ['Super', 'Comida'] })
const gym = cat('Gimnasio', { status: 'archived' })
const salary = cat('Nómina', { kind: 'income' })

describe('índice de categorías', () => {
  const idx = new CategoryIndex([food, gym, salary])

  it('resuelve por nombre normalizado y por alias', () => {
    expect(idx.findByName('alimentacion')).toBe(food)
    expect(idx.findByName('  ALIMENTACIÓN ')).toBe(food)
    expect(idx.findByName('súper')).toBe(food)
    expect(idx.findByName('Desconocida')).toBeUndefined()
  })

  it('resuelve por ID ignorando guiones', () => {
    const c = cat('X', { id: '01234567-89ab-cdef-0123-456789abcdef' })
    expect(new CategoryIndex([c]).get('0123456789abcdef0123456789abcdef')).toBe(c)
    expect(new CategoryIndex([c]).resolve({ type: 'id', id: '0123456789ABCDEF0123456789abcdef' })).toBe(c)
  })

  it('las categorías archivadas siguen resolviéndose para el histórico', () => {
    expect(idx.findByName('Gimnasio')).toBe(gym)
  })

  it('no resuelve nombres ambiguos de forma arbitraria', () => {
    const a = cat('Casa', { id: 'a' })
    const b = cat('Hogar', { id: 'b', aliases: ['Casa'] })
    expect(new CategoryIndex([a, b]).findByName('casa')).toBe(a)
    const c = cat('Otra', { id: 'c', aliases: ['Varios'] })
    const d = cat('Más', { id: 'd', aliases: ['Varios'] })
    expect(new CategoryIndex([c, d]).findByName('varios')).toBeUndefined()
  })
})

describe('asignación', () => {
  it('impide asignar categorías archivadas a operaciones nuevas', () => {
    expect(canAssign(gym, { kind: 'expense' })).toMatchObject({ ok: false })
  })

  it('exige el tipo compatible', () => {
    expect(canAssign(salary, { kind: 'expense' }).ok).toBe(false)
    expect(canAssign(salary, { kind: 'income' }).ok).toBe(true)
    expect(canAssign(food, { kind: 'refund' }).ok).toBe(true)
    expect(canAssign(food, { kind: 'transfer' }).ok).toBe(false)
    expect(canAssign(undefined, { kind: 'expense' }).ok).toBe(false)
  })
})

describe('validación de nombres', () => {
  const all = [food, gym, salary]
  const draft = { name: '', kind: 'expense' as const, color: 'slate', icon: 'tag', description: '', aliases: [] as string[] }

  it('evita nombres duplicados según la normalización', () => {
    expect(validateCategoryDraft({ ...draft, name: 'alimentacion' }, all).name).toMatch(/Ya existe/)
    expect(validateCategoryDraft({ ...draft, name: 'GIMNASIO' }, all).name).toMatch(/archivada/)
    expect(validateCategoryDraft({ ...draft, name: 'Comida' }, all).name).toMatch(/alias/)
    expect(validateCategoryDraft({ ...draft, name: 'Mascotas' }, all)).toEqual({})
  })

  it('permite conservar el propio nombre al editar', () => {
    expect(validateCategoryDraft({ ...draft, id: food.id, name: 'Alimentación', aliases: ['Super'] }, all)).toEqual({})
  })

  it('rechaza nombres vacíos, largos o con comas', () => {
    expect(validateCategoryDraft({ ...draft, name: '  ' }, all).name).toBeDefined()
    expect(validateCategoryDraft({ ...draft, name: 'a'.repeat(61) }, all).name).toBeDefined()
    expect(validateCategoryDraft({ ...draft, name: 'Ocio, fiestas' }, all).name).toMatch(/comas/)
  })

  it('valida los alias', () => {
    expect(validateCategoryDraft({ ...draft, name: 'Mascotas', aliases: ['Super'] }, all).aliases).toMatch(/Alimentación/)
    expect(validateCategoryDraft({ ...draft, name: 'Mascotas', aliases: ['Perro', 'perro'] }, all).aliases).toMatch(/repetido/)
  })

  it('al renombrar conserva el nombre anterior como alias', () => {
    expect(aliasesAfterRename(food, 'Supermercado', food.aliases)).toEqual(['Super', 'Comida', 'Alimentación'])
    expect(aliasesAfterRename(food, 'ALIMENTACION', food.aliases)).toEqual(['Super', 'Comida'])
    expect(aliasesAfterRename(food, 'Super', food.aliases)).toEqual(['Comida', 'Alimentación'])
  })
})

describe('categorías implícitas', () => {
  it('deduce un catálogo de solo lectura sin duplicados', () => {
    const list = implicitCategories([
      { name: 'Ocio', kind: 'expense' },
      { name: 'ocio ', kind: 'expense' },
      { name: 'Nómina', kind: 'expense' },
    ])
    expect(list.map((c) => c.name)).toEqual(['Nómina', 'Ocio'])
    expect(list.find((c) => c.name === 'Nómina')!.kind).toBe('income')
    expect(list.every((c) => c.source === 'implicit')).toBe(true)
  })
})

describe('validación de movimientos', () => {
  const idx = index([food, gym, salary])
  const base = {
    description: 'Mercadona',
    date: '2026-10-01',
    amount: { cents: 1234, exact: true },
    negative: false,
    kind: 'expense' as const,
    rawKind: 'Gasto',
    categoryLink: { type: 'name' as const, name: 'Alimentación' },
  }

  it('un movimiento completo no tiene incidencias', () => {
    expect(validateMovement(base, idx)).toEqual({ issues: [], categoryId: food.id })
  })

  it('fechas e importes inválidos bloquean los totales', () => {
    const r = validateMovement({ ...base, date: null, amount: null }, idx)
    expect(r.issues.filter((i) => i.blocking).map((i) => i.code).sort()).toEqual(['missing_amount', 'missing_date'])
  })

  it('un tipo desconocido bloquea y explica cómo arreglarlo', () => {
    const r = validateMovement({ ...base, kind: null, rawKind: 'Ahorro' }, idx)
    expect(r.issues[0]).toMatchObject({ code: 'unknown_kind', blocking: true })
    expect(r.issues[0].message).toMatch(/Ahorro/)
  })

  it('una categoría desconocida no bloquea pero se señala', () => {
    const r = validateMovement({ ...base, categoryLink: { type: 'name', name: 'Mascotas' } }, idx)
    expect(r.categoryId).toBeNull()
    expect(r.issues[0]).toMatchObject({ code: 'unknown_category', blocking: false })
  })

  it('señala incompatibilidades de tipo, importes negativos y decimales de más', () => {
    const r = validateMovement({ ...base, amount: { cents: 100, exact: false }, negative: true, categoryLink: { type: 'name', name: 'Nómina' } }, idx)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['excess_decimals', 'kind_mismatch', 'negative_amount'])
    expect(r.issues.every((i) => !i.blocking)).toBe(true)
  })

  it('las categorías archivadas se resuelven en movimientos antiguos', () => {
    expect(validateMovement({ ...base, categoryLink: { type: 'name', name: 'Gimnasio' } }, idx).categoryId).toBe(gym.id)
  })
})

describe('duplicados', () => {
  it('marca posibles duplicados sin eliminarlos', () => {
    const a = mov({ description: 'Café', euros: 1.5, date: '2026-10-01' })
    const b = mov({ description: 'CAFÉ ', euros: 1.5, date: '2026-10-01' })
    const c = mov({ description: 'Café', euros: 1.5, date: '2026-10-02' })
    const out = flagPossibleDuplicates([a, b, c])
    expect(out).toHaveLength(3)
    expect(out.filter((m) => m.issues.some((i) => i.code === 'possible_duplicate')).map((m) => m.id)).toEqual([a.id, b.id])
    expect(flagPossibleDuplicates(out)[0].issues).toHaveLength(1)
  })

  it('detecta duplicados antes de crear un movimiento', () => {
    const existing = [mov({ description: 'Zara', euros: 30, date: '2026-10-01' })]
    expect(findDuplicatesOf({ date: '2026-10-01', amountCents: 3000, kind: 'expense', description: 'zara' }, existing)).toHaveLength(1)
    expect(findDuplicatesOf({ date: '2026-10-01', amountCents: 3001, kind: 'expense', description: 'zara' }, existing)).toHaveLength(0)
  })

  it('identifica los movimientos pendientes de clasificar', () => {
    expect(needsClassification(mov({ categoryLink: null }))).toBe(true)
    expect(needsClassification(mov({ categoryLink: { type: 'name', name: 'X' } }))).toBe(false)
    expect(needsClassification(mov({ kind: 'transfer' }))).toBe(false)
  })
})
