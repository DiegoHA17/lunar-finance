/**
 * Pruebas de integración de los servicios contra el backend de demostración, que emula la semántica de Notion
 * (propiedades por ID, conflictos, tipos). No usan Notion real ni datos reales.
 */
import { describe, expect, it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { emptyRule } from '../domain/classifier/rules'
import { isCounted } from '../domain/types'
import { LunarError } from '../infra/contracts'
import { DemoBackend } from '../infra/demo'
import { pageToMovement } from '../infra/mapping'
import { createCategory, setArchived, updateCategory } from '../services/categories'
import { applyProposals, previewPending } from './classification'
import { applyOriginProperty, originPropertyPlan } from './migration'
import { assignCategory, createMovement, updateMovement } from './movements'
import { loadRules, repairRuleTargets, ruleFromCorrection, ruleImpact, saveRules } from './rules'
import { loadAll, remapMovements } from './sync'

async function setup() {
  const backend = new DemoBackend(0)
  const config = await backend.getConfig()
  const data = await loadAll(backend, config)
  const index = new CategoryIndex(data.categories)
  return { backend, config, data, index, ctx: { backend, config, index, pages: data.pages } }
}

describe('sincronización', () => {
  it('carga movimientos y catálogo, con fecha de lectura', async () => {
    const { data } = await setup()
    expect(data.movements.length).toBeGreaterThan(300)
    expect(data.catalog).toBe('notion')
    expect(data.categories.some((c) => c.status === 'archived')).toBe(true)
    expect(Number.isNaN(Date.parse(data.fetchedAt))).toBe(false)
  })

  it('detecta los casos especiales de los datos', async () => {
    const { data } = await setup()
    const codes = data.movements.flatMap((m) => m.issues.map((i) => i.code))
    for (const c of ['possible_duplicate', 'unknown_category', 'unknown_kind', 'missing_amount', 'negative_amount']) expect(codes).toContain(c)
    expect(data.movements.filter((m) => !isCounted(m)).length).toBe(2)
  })

  it('un error al leer movimientos se propaga (no se convierte en lista vacía)', async () => {
    const backend = new DemoBackend(0)
    const config = await backend.getConfig()
    backend.query = async () => {
      throw new LunarError({ code: 'not_found', message: 'no compartida' })
    }
    await expect(loadAll(backend, config)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('sin configuración de movimientos pide configurarla', async () => {
    const backend = new DemoBackend(0)
    await expect(loadAll(backend, { version: 1, notion: {} })).rejects.toMatchObject({ code: 'config' })
  })

  it('si falla el catálogo, sigue con categorías implícitas y lo avisa', async () => {
    const backend = new DemoBackend(0)
    const config = await backend.getConfig()
    const original = backend.query.bind(backend)
    backend.query = async (role) => {
      if (role === 'categories') throw new LunarError({ code: 'forbidden', message: 'Sin permiso.' })
      return original(role)
    }
    const data = await loadAll(backend, config)
    expect(data.catalog).toBe('implicit')
    expect(data.notices[0]).toMatch(/categorías/)
    expect(data.categories.every((c) => c.source === 'implicit')).toBe(true)
  })
})

describe('movimientos', () => {
  it('asigna una categoría y la vuelve a leer desde Notion', async () => {
    const { ctx, data, index, config } = await setup()
    const pending = data.movements.find((m) => m.categoryLink === null && m.kind === 'expense' && isCounted(m))!
    const food = index.findByName('Alimentación')!
    const page = await assignCategory(ctx, pending, food, 'manual')
    const updated = pageToMovement(page, config.notion.movements!, index)
    expect(updated.categoryId).toBe(food.id)
  })

  it('rechaza categorías archivadas o incompatibles', async () => {
    const { ctx, data, index } = await setup()
    const m = data.movements.find((x) => x.kind === 'expense' && isCounted(x))!
    await expect(assignCategory(ctx, m, index.findByName('Gimnasio')!, 'manual')).rejects.toMatchObject({ code: 'validation' })
    await expect(assignCategory(ctx, m, index.findByName('Nómina')!, 'manual')).rejects.toMatchObject({ code: 'validation' })
  })

  it('no sobrescribe un cambio hecho en Notion después de la carga (conflicto)', async () => {
    const { ctx, data, index, backend } = await setup()
    const m = data.movements.find((x) => x.categoryLink === null && x.kind === 'expense' && isCounted(x))!
    // Otro cliente (el atajo, Notion) cambia la categoría mientras tanto.
    const other = await setup()
    void other
    await backend.updatePage('movements', m.id, {}, { cat: { type: 'select', value: 'Ocio' } })
    await expect(assignCategory(ctx, m, index.findByName('Alimentación')!, 'manual')).rejects.toMatchObject({ code: 'conflict' })
  })

  it('edita varios campos de un movimiento', async () => {
    const { ctx, data, config, index } = await setup()
    const m = data.movements.find((x) => isCounted(x) && x.kind === 'expense')!
    const page = await updateMovement(ctx, m, { description: 'Corregido', amountCents: 1234 }, null)
    const u = pageToMovement(page, config.notion.movements!, index)
    expect(u.description).toBe('Corregido')
    expect(u.amountCents).toBe(1234)
  })

  it('crea movimientos y evita duplicados salvo confirmación', async () => {
    const { ctx, data, index } = await setup()
    const draft = { description: 'Librería', date: '2026-10-10', amountCents: 1599, kind: 'expense' as const, category: index.findByName('Estudios')!, paymentMethod: 'Tarjeta' }
    const page = await createMovement(ctx, draft, data.movements, { allowDuplicate: false, origin: 'manual' })
    ctx.pages.set(page.id, page)
    const all = remapMovements(ctx.pages, ctx.config, index)
    await expect(createMovement(ctx, draft, all, { allowDuplicate: false, origin: 'manual' })).rejects.toMatchObject({ detail: 'duplicate' })
    await expect(createMovement(ctx, draft, all, { allowDuplicate: true, origin: 'manual' })).resolves.toBeDefined()
  })

  it('valida importes y fechas antes de escribir', async () => {
    const { ctx, data } = await setup()
    const base = { description: 'X', date: '2026-10-10', amountCents: 100, kind: 'expense' as const, category: null, paymentMethod: null }
    await expect(createMovement(ctx, { ...base, amountCents: 0 }, data.movements, { allowDuplicate: true, origin: 'manual' })).rejects.toMatchObject({ code: 'validation' })
    await expect(createMovement(ctx, { ...base, date: '2026-02-30' }, data.movements, { allowDuplicate: true, origin: 'manual' })).rejects.toMatchObject({ code: 'validation' })
    await expect(createMovement(ctx, { ...base, description: ' ' }, data.movements, { allowDuplicate: true, origin: 'manual' })).rejects.toMatchObject({ code: 'validation' })
  })
})

describe('categorías', () => {
  it('crea, renombra conservando alias y archiva sin perder el histórico', async () => {
    const { backend, config, data } = await setup()
    const draft = { name: 'Mascotas', kind: 'expense' as const, color: 'ochre', icon: 'paw-print', description: '', aliases: [] }
    const created = await createCategory(backend, config, draft, data.categories)
    expect(created.name).toBe('Mascotas')
    await expect(createCategory(backend, config, { ...draft, name: 'mascotas' }, [...data.categories, created])).rejects.toMatchObject({ code: 'validation' })

    const reloaded = await loadAll(backend, config)
    // El movimiento «Pienso gato» con categoría «Mascotas» ahora se resuelve.
    expect(reloaded.movements.find((m) => m.description === 'Pienso gato')!.categoryId).toBe(created.id)

    const renamed = await updateCategory(backend, config, reloaded.categoryPages, created, { ...draft, name: 'Animales' }, reloaded.categories)
    expect(renamed.aliases).toContain('Mascotas')
    const afterRename = await loadAll(backend, config)
    expect(afterRename.movements.find((m) => m.description === 'Pienso gato')!.categoryId).toBe(created.id)

    const archived = await setArchived(backend, config, afterRename.categoryPages, renamed, true)
    expect(archived.status).toBe('archived')
    const afterArchive = await loadAll(backend, config)
    const m = afterArchive.movements.find((x) => x.description === 'Pienso gato')!
    expect(m.categoryId).toBe(created.id)
    expect(m.issues.some((i) => i.code === 'unknown_category')).toBe(false)
  })
})

describe('clasificación en lote', () => {
  it('propone solo para pendientes y aplica sin tocar los ya clasificados', async () => {
    const { ctx, data, backend, index, config } = await setup()
    const { rules } = await loadRules(backend)
    const repaired = repairRuleTargets(rules, index)
    expect(repaired.changed).toBe(true)
    const preview = previewPending(data.movements, repaired.rules, index)
    expect(preview.length).toBeGreaterThan(0)
    expect(preview.every((p) => p.movement.categoryLink === null)).toBe(true)
    const proposed = preview.filter((p) => p.proposal.status === 'proposed')
    expect(proposed.length).toBeGreaterThan(0)
    const untouched = data.movements.filter((m) => m.categoryLink !== null).map((m) => [m.id, m.categoryLink])

    const progress: number[] = []
    const outcomes = await applyProposals(ctx, proposed, (d) => progress.push(d))
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(progress.at(-1)).toBe(proposed.length)

    const after = await loadAll(backend, config)
    for (const [id, link] of untouched) expect(after.movements.find((m) => m.id === id)!.categoryLink).toEqual(link)
    expect(previewPending(after.movements, repaired.rules, new CategoryIndex(after.categories)).filter((p) => p.proposal.status === 'proposed')).toHaveLength(0)
  })

  it('una regla creada a partir de una corrección informa de su impacto sin aplicarlo', async () => {
    const { data, index } = await setup()
    const m = data.movements.find((x) => x.description.startsWith('Cabify'))!
    const r = ruleFromCorrection(m, index.findByName('Transporte')!)
    expect(r.pattern).toBe('cabify')
    const impact = ruleImpact(r, data.movements, index)
    expect(impact.pending.length + impact.alreadyClassified.length).toBeGreaterThan(0)
  })

  it('las reglas se guardan y se leen', async () => {
    const { backend } = await setup()
    const r = { ...emptyRule('x', 'X'), pattern: 'algo' }
    await saveRules(backend, [r])
    expect((await loadRules(backend)).rules).toEqual([r])
  })
})

describe('migración no destructiva', () => {
  it('añade la propiedad de origen solo tras aplicarla y la mapea', async () => {
    const { backend, config } = await setup()
    const plan = originPropertyPlan(config)!
    expect(plan.changes[0]).toMatch(/Origen clasificación/)
    const next = await applyOriginProperty(backend, config)
    expect(next.notion.movements!.fields.origin.name).toBe('Origen clasificación')
    expect(originPropertyPlan(next)).toBeNull()
    await expect(applyOriginProperty(backend, config)).rejects.toMatchObject({ code: 'validation' })
  })

  it('con la propiedad de origen, las asignaciones registran quién clasificó', async () => {
    const { backend, config } = await setup()
    const next = await applyOriginProperty(backend, config)
    const data = await loadAll(backend, next)
    const index = new CategoryIndex(data.categories)
    const m = data.movements.find((x) => x.categoryLink === null && x.kind === 'expense' && isCounted(x))!
    const page = await assignCategory({ backend, config: next, index, pages: data.pages }, m, index.findByName('Otros')!, 'rule')
    expect(pageToMovement(page, next.notion.movements!, index).origin).toBe('rule')
  })
})
