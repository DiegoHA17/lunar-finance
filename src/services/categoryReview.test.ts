/**
 * Revisión global de categorías contra el backend de demostración (emula Notion: propiedades por ID, conflictos).
 * Datos sintéticos; no se usa Notion real.
 */
import { describe, expect, it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { type CategoryReview, type ReviewGroup, reviewCategories } from '../domain/categoryReview'
import type { AiHost } from '../infra/backend'
import { type AiMatchCategoryInput, LunarError, type PropWrite } from '../infra/contracts'
import { DemoBackend } from '../infra/demo'
import { cat, mov } from '../test/factories'
import { applyCorrections, reviewWithAi } from './categoryReview'
import { applyOriginProperty } from './migration'
import { loadAll } from './sync'

/** Demo con tres gastos cuya categoría escrita es «Vaijes» (no existe en el catálogo) y la propiedad de origen. */
async function setup() {
  const backend = new DemoBackend(0)
  const config = await applyOriginProperty(backend, await backend.getConfig())
  let data = await loadAll(backend, config)
  const targets = data.movements.filter((m) => m.kind === 'expense' && m.categoryId && m.issues.length === 0).slice(0, 3)
  const catProp = config.notion.movements!.fields.category!.id
  for (const m of targets) await backend.updatePage('movements', m.id, {}, { [catProp]: { type: 'select', value: 'Vaijes' } })
  data = await loadAll(backend, config)
  const index = new CategoryIndex(data.categories)
  const review = reviewCategories(data.movements, index, data.catalog)
  const group = review.groups.find((g) => g.name === 'Vaijes')!
  const viajes = data.categories.find((c) => c.name === 'Viajes')!
  const writes: Record<string, PropWrite>[] = []
  const original = backend.updatePage.bind(backend)
  backend.updatePage = async (role, id, expected, props) => {
    writes.push(props)
    return original(role, id, expected, props)
  }
  return { backend, config, data, index, review, group, viajes, catProp, writes, ctx: { backend, config, index, pages: new Map(data.pages) }, ids: targets.map((m) => m.id) }
}

const noop = () => {}

describe('aplicar correcciones de categoría', () => {
  it('detecta «Vaijes» con sus movimientos y propone «Viajes» como corrección segura', async () => {
    const { group, viajes } = await setup()
    expect(group.movements).toHaveLength(3)
    expect(group.level).toBe('safe')
    expect(group.proposal?.categoryId).toBe(viajes.id)
  })

  it('solo escribe la propiedad de categoría y no toca importe, fecha, descripción, método ni origen', async () => {
    const { backend, config, group, viajes, catProp, writes, ctx, ids } = await setup()
    const before = await loadAll(backend, config)
    const out = await applyCorrections(ctx, [{ group, categoryId: viajes.id }], noop)
    expect(out.map((o) => o.status)).toEqual(['applied', 'applied', 'applied'])
    expect(writes).toHaveLength(3)
    for (const w of writes) expect(Object.keys(w)).toEqual([catProp])
    const after = await loadAll(backend, config)
    for (const id of ids) {
      const a = after.movements.find((m) => m.id === id)!
      const b = before.movements.find((m) => m.id === id)!
      expect(a.categoryId).toBe(viajes.id)
      expect({ ...a, categoryId: null, categoryLink: null, issues: [], lastEditedTime: '' }).toEqual({ ...b, categoryId: null, categoryLink: null, issues: [], lastEditedTime: '' })
    }
  })

  it('si la categoría de destino ya no existe o está archivada, no escribe nada', async () => {
    const { group, viajes, writes, ctx, data } = await setup()
    const gone = { ...ctx, index: new CategoryIndex(data.categories.filter((c) => c.id !== viajes.id)) }
    const out = await applyCorrections(gone, [{ group, categoryId: viajes.id }], noop)
    expect(out.every((o) => o.status === 'failed' && o.error?.message.includes('ya no existe'))).toBe(true)
    const archived = { ...ctx, index: new CategoryIndex(data.categories.map((c) => (c.id === viajes.id ? { ...c, status: 'archived' as const } : c))) }
    const out2 = await applyCorrections(archived, [{ group, categoryId: viajes.id }], noop)
    expect(out2.every((o) => o.status === 'failed' && o.error?.message.includes('archivada'))).toBe(true)
    expect(writes).toHaveLength(0)
  })

  it('un error de escritura en un movimiento no impide aplicar el resto y se informa', async () => {
    const { backend, group, viajes, ctx, ids } = await setup()
    const original = backend.updatePage
    backend.updatePage = async (role, id, expected, props) => {
      if (id === ids[1]) throw new LunarError({ code: 'conflict', message: 'El movimiento ha cambiado en Notion.' })
      return original(role, id, expected, props)
    }
    const out = await applyCorrections(ctx, [{ group, categoryId: viajes.id }], noop)
    expect(out.map((o) => o.status)).toEqual(['applied', 'failed', 'applied'])
    expect(out[1].error?.code).toBe('conflict')
  })

  it('sin conexión se detiene: lo pendiente queda como no intentado', async () => {
    const { backend, group, viajes, ctx, ids } = await setup()
    const original = backend.updatePage
    backend.updatePage = async (role, id, expected, props) => {
      if (id === ids[1]) throw new LunarError({ code: 'offline', message: 'Sin conexión.' })
      return original(role, id, expected, props)
    }
    const out = await applyCorrections(ctx, [{ group, categoryId: viajes.id }], noop)
    expect(out.map((o) => o.status)).toEqual(['applied', 'failed', 'not_attempted'])
  })

  it('no escribe dos veces el mismo movimiento aunque se repita la corrección', async () => {
    const { group, viajes, writes, ctx } = await setup()
    await applyCorrections(ctx, [{ group, categoryId: viajes.id }, { group, categoryId: viajes.id }], noop)
    expect(writes).toHaveLength(3)
  })

  it('no toca un movimiento que entretanto ya tiene una categoría del catálogo', async () => {
    const { group, viajes, writes, ctx, data } = await setup()
    const food = data.categories.find((c) => c.name === 'Alimentación')!
    const stale: ReviewGroup = { ...group, movements: [{ ...group.movements[0], categoryId: food.id }] }
    const out = await applyCorrections(ctx, [{ group: stale, categoryId: viajes.id }], noop)
    expect(out[0]).toMatchObject({ status: 'failed' })
    expect(out[0].error?.code).toBe('conflict')
    expect(writes).toHaveLength(0)
  })
})

// ── IA ────────────────────────────────────────────────────────────────────────────────────────────────────────

const fun = cat('Ocio')
const food = cat('Alimentación')
const salary = cat('Nómina', { kind: 'income' })
const old = cat('Viejo', { status: 'archived' })
const idx = new CategoryIndex([fun, food, salary, old])

function written(name: string, kind: 'expense' | 'income' = 'expense') {
  const link = { type: 'name' as const, name }
  return mov({ kind, categoryLink: link, categoryId: idx.resolve(link)?.id ?? null })
}

function fakeAi(reply: (input: AiMatchCategoryInput) => Promise<{ categoryId: string | null; confidence: number; reason: string }>) {
  const calls: AiMatchCategoryInput[] = []
  const host = {
    matchCategory: async (_m: string, input: AiMatchCategoryInput) => {
      calls.push(input)
      return reply(input)
    },
  } as unknown as AiHost
  return { host, calls }
}

const run = (review: CategoryReview, host: AiHost) => reviewWithAi(review, host, 'gemma3:4b', idx, noop)

describe('revisión de categorías con IA', () => {
  it('solo envía el nombre escrito, el tipo y las categorías activas del mismo tipo; las seguras no se consultan', async () => {
    const review = reviewCategories([written('Ocios'), written('Comida fuera'), written('Extra', 'income')], idx, 'notion')
    const { host, calls } = fakeAi(async () => ({ categoryId: null, confidence: 0.2, reason: '' }))
    await run(review, host)
    expect(calls.map((c) => c.name).sort()).toEqual(['Comida fuera', 'Extra'])
    const expense = calls.find((c) => c.name === 'Comida fuera')!
    expect(Object.keys(expense).sort()).toEqual(['categories', 'kind', 'name'])
    expect(expense.categories.map((c) => c.name).sort()).toEqual(['Alimentación', 'Ocio'])
    expect(calls.find((c) => c.name === 'Extra')!.categories.map((c) => c.name)).toEqual(['Nómina'])
  })

  it('una propuesta válida de la IA queda como dudosa (nunca segura) con su confianza', async () => {
    const review = reviewCategories([written('Comida fuera')], idx, 'notion')
    const { host } = fakeAi(async () => ({ categoryId: food.id, confidence: 0.97, reason: 'Sinónimo' }))
    const res = await run(review, host)
    expect(res.review.groups[0]).toMatchObject({ level: 'doubtful', proposal: { categoryId: food.id, source: 'ai', confidence: 0.97 } })
  })

  it('con poca seguridad no propone destino: solo lo anota y el movimiento queda sin cambios', async () => {
    const review = reviewCategories([written('Varios')], idx, 'notion')
    const { host } = fakeAi(async () => ({ categoryId: food.id, confidence: 0.8, reason: 'Gastos en comida' }))
    const res = await run(review, host)
    expect(res.review.groups[0]).toMatchObject({ proposal: null, level: 'none' })
    expect(res.review.groups[0].note).toContain('poca seguridad (80 %)')
  })

  it('rechaza categorías inventadas, archivadas, de otro tipo o con confianza imposible', async () => {
    for (const bad of [{ categoryId: 'cat-inventada', confidence: 0.9 }, { categoryId: old.id, confidence: 0.9 }, { categoryId: salary.id, confidence: 0.9 }, { categoryId: food.id, confidence: 3 }]) {
      const review = reviewCategories([written('Comida fuera')], idx, 'notion')
      const { host } = fakeAi(async () => ({ ...bad, reason: 'x' }))
      const res = await run(review, host)
      expect(res.failures).toBe(1)
      expect(res.review.groups[0].proposal).toBeNull()
    }
  })

  it('«NINGUNA» deja el grupo sin propuesta, con la explicación', async () => {
    const review = reviewCategories([written('Varios')], idx, 'notion')
    const { host } = fakeAi(async () => ({ categoryId: null, confidence: 0.3, reason: 'ambiguo' }))
    const res = await run(review, host)
    expect(res.review.groups[0]).toMatchObject({ proposal: null, level: 'none' })
    expect(res.review.groups[0].note).toContain('IA no ve')
  })

  it('si contradice una propuesta por nombre, se mantiene la del nombre y se anota', async () => {
    const roma = cat('Ropa')
    const ix = new CategoryIndex([roma, food])
    const link = { type: 'name' as const, name: 'Roma' }
    const review = reviewCategories([mov({ categoryLink: link, categoryId: null })], ix, 'notion')
    expect(review.groups[0].level).toBe('doubtful')
    const { host } = fakeAi(async () => ({ categoryId: food.id, confidence: 0.9, reason: '' }))
    const res = await reviewWithAi(review, host, 'm', ix, noop)
    expect(res.review.groups[0].proposal?.categoryId).toBe(roma.id)
    expect(res.review.groups[0].note).toContain('La IA propone «Alimentación»')
  })

  it('si Ollama deja de responder se detiene y conserva las comprobaciones por nombre', async () => {
    const review = reviewCategories([written('Ocios'), written('Comida fuera'), written('Varios')], idx, 'notion')
    const { host, calls } = fakeAi(async () => {
      throw new LunarError({ code: 'offline', message: 'Ollama no responde.' })
    })
    const res = await run(review, host)
    expect(res.stopped).toBe(true)
    expect(calls).toHaveLength(1)
    expect(res.review.groups.find((g) => g.name === 'Ocios')?.level).toBe('safe')
  })

  it('se puede cancelar', async () => {
    const review = reviewCategories([written('Comida fuera'), written('Varios')], idx, 'notion')
    const ctrl = new AbortController()
    const { host, calls } = fakeAi(async () => {
      ctrl.abort()
      return { categoryId: null, confidence: 0.1, reason: '' }
    })
    const res = await reviewWithAi(review, host, 'm', idx, noop, ctrl.signal)
    expect(res.stopped).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
