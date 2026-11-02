/** Pagos periódicos contra el backend de demostración (en memoria). Nunca se usa Notion real. */

import { beforeEach, describe, expect, it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { type ISODate, addDays } from '../domain/dates'
import { type RecurringDoc, occurrenceKey } from '../domain/recurring'
import type { PropWrite, Role } from '../infra/contracts'
import { type AppConfig, LunarError } from '../infra/contracts'
import { DemoBackend } from '../infra/demo'
import { applyRecurrenceProperty } from './migration'
import {
  type RecurringInput,
  applyFound,
  buildPlan,
  deleteRule,
  loadRecurring,
  registerOccurrences,
  saveRecurring,
  selectApproved,
  setRuleActive,
  upsertRule,
  validateRecurringInput,
  withRecurringLock,
} from './recurring'
import { type LoadedData, loadAll } from './sync'

const TODAY: ISODate = '2026-04-15'

let backend: DemoBackend
let config: AppConfig

beforeEach(async () => {
  backend = new DemoBackend(0)
  config = await applyRecurrenceProperty(backend, await backend.getConfig())
})

async function load(): Promise<LoadedData & { index: CategoryIndex }> {
  const data = await loadAll(backend, config)
  return { ...data, index: new CategoryIndex(data.categories) }
}

function input(over: Partial<RecurringInput> = {}): RecurringInput {
  return {
    description: 'Gimnasio (prueba)',
    amountCents: 3990,
    kind: 'transfer',
    categoryId: null,
    categoryName: null,
    paymentMethod: 'Tarjeta',
    frequency: 'monthly',
    startDate: '2026-01-31',
    mode: 'auto',
    ...over,
  }
}

/** Una pasada completa como al abrir la aplicación: carga, concilia y registra lo automático. */
async function runOnce(day: ISODate = TODAY) {
  return withRecurringLock(backend, async () => {
    const data = await load()
    const doc = await loadRecurring(backend)
    let plan = buildPlan(doc, data, config, day)
    if (applyFound(doc, plan, 'now')) await saveRecurring(backend, doc)
    plan = buildPlan(doc, data, config, day)
    const auto = plan.blocked ? [] : plan.items.filter((i) => i.action === 'auto')
    const outcomes = await registerOccurrences({ backend, config, index: data.index, pages: data.pages }, doc, auto, (d) => saveRecurring(backend, d))
    return { outcomes, plan }
  })
}

async function createRule(over: Partial<RecurringInput> = {}, autoFrom: ISODate = '2026-01-01') {
  const doc = await loadRecurring(backend)
  const rule = upsertRule(doc, input(over), null, 'now', autoFrom)
  await saveRecurring(backend, doc)
  return rule
}

async function keysInNotion(): Promise<string[]> {
  const res = await backend.query('movements')
  const ref = config.notion.movements!.fields.recurrence!
  return res.pages.map((p) => p.properties[ref.id]?.value).flatMap((v) => (v?.type === 'rich_text' && v.value ? [v.value] : []))
}

describe('registro de pagos periódicos', () => {
  it('registra cada periodo vencido una sola vez, con su clave, aunque se ejecute varias veces', async () => {
    const r = await createRule()
    const first = await runOnce()
    expect(first.outcomes.map((o) => Boolean(o.page))).toEqual([true, true, true])
    await runOnce()
    await runOnce()
    expect((await keysInNotion()).sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'].map((d) => occurrenceKey(r.id, d)))
    const doc = await loadRecurring(backend)
    expect(Object.values(doc.ledger).every((e) => e.state === 'registered')).toBe(true)
  })

  it('dos ejecuciones simultáneas no duplican (cerrojo)', async () => {
    await createRule()
    await Promise.all([runOnce(), runOnce(), runOnce()])
    expect(await keysInNotion()).toHaveLength(3)
  })

  it('el cerrojo ocupado por otra instancia impide registrar', async () => {
    backend.acquireRunLock = async () => false
    await expect(runOnce()).rejects.toMatchObject({ code: 'conflict' })
  })

  it('Notion lo creó pero la respuesta se perdió: no se repite y se concilia como registrado', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    const create = backend.createPage.bind(backend)
    backend.createPage = async (role: Role, props: Record<string, PropWrite>) => {
      await create(role, props)
      throw new LunarError({ code: 'offline', message: 'Notion no respondió a tiempo.' })
    }
    const first = await runOnce()
    expect(first.outcomes[0]).toMatchObject({ uncertain: true })
    expect((await loadRecurring(backend)).ledger[occurrenceKey(r.id, '2026-03-31')].state).toBe('sending')
    backend.createPage = create
    const second = await runOnce()
    expect(second.outcomes).toEqual([])
    expect(await keysInNotion()).toEqual([occurrenceKey(r.id, '2026-03-31')])
    expect((await loadRecurring(backend)).ledger[occurrenceKey(r.id, '2026-03-31')].state).toBe('registered')
  })

  it('fallo de red sin rastro en Notion: pasa a revisión manual, nunca se reintenta solo', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    const create = backend.createPage.bind(backend)
    backend.createPage = async () => {
      throw new LunarError({ code: 'offline', message: 'No se pudo conectar con Notion.' })
    }
    await runOnce()
    backend.createPage = create
    const again = await runOnce()
    expect(again.outcomes).toEqual([])
    expect(await keysInNotion()).toEqual([])
    const item = again.plan.items.find((i) => i.key === occurrenceKey(r.id, '2026-03-31'))!
    expect(item).toMatchObject({ action: 'manual', uncertain: true })
  })

  it('un rechazo seguro de Notion (validación) libera la ocurrencia y detiene el lote', async () => {
    await createRule()
    const create = backend.createPage.bind(backend)
    let calls = 0
    backend.createPage = async () => {
      calls++
      throw new LunarError({ code: 'validation', message: 'Notion rechazó los datos enviados.' })
    }
    const res = await runOnce()
    expect(calls).toBe(1)
    expect(res.outcomes).toHaveLength(1)
    expect(Object.keys((await loadRecurring(backend)).ledger)).toEqual([])
    backend.createPage = create
    expect((await runOnce()).outcomes.filter((o) => o.page)).toHaveLength(3)
  })

  it('si no se puede guardar el registro local antes de enviar, no se envía nada', async () => {
    await createRule()
    const data = await load()
    const doc = await loadRecurring(backend)
    const items = buildPlan(doc, data, config, TODAY).items
    let created = 0
    const create = backend.createPage.bind(backend)
    backend.createPage = async (role, props) => (created++, create(role, props))
    const outcomes = await registerOccurrences({ backend, config, index: data.index, pages: data.pages }, doc, items, async () => {
      throw new LunarError({ code: 'io', message: 'Disco lleno' })
    })
    expect(created).toBe(0)
    expect(outcomes[0].error?.code).toBe('io')
  })

  it('sin la propiedad «Pago periódico» no se registra nada', async () => {
    backend = new DemoBackend(0)
    config = await backend.getConfig() // configuración sin la propiedad
    const doc = await loadRecurring(backend)
    upsertRule(doc, input(), null, 'now', '2026-01-01')
    const data = await load()
    const plan = buildPlan(doc, data, config, TODAY)
    expect(plan.blocked).toMatch(/Pago periódico/)
    await expect(registerOccurrences({ backend, config, index: data.index, pages: data.pages }, doc, plan.items, async () => undefined)).rejects.toMatchObject({ code: 'config' })
  })
})

describe('aprobación por el usuario', () => {
  it('solo registra lo aprobado si sigue igual tras volver a leer Notion', async () => {
    const r = await createRule({ startDate: '2026-03-31', mode: 'confirm' })
    const seen = buildPlan(await loadRecurring(backend), await load(), config, TODAY).items
    expect(selectApproved(buildPlan(await loadRecurring(backend), await load(), config, TODAY), seen).todo).toHaveLength(1)
    // Entre tanto, un intento con respuesta perdida la deja «enviándose»: ya no es lo que el usuario aprobó.
    const doc = await loadRecurring(backend)
    doc.ledger[occurrenceKey(r.id, '2026-03-31')] = { state: 'sending', ruleId: r.id, date: '2026-03-31', at: 'x', draft: seen[0].draft }
    const fresh = buildPlan(doc, await load(), config, TODAY)
    expect(selectApproved(fresh, seen)).toEqual({ todo: [], changed: 1 })
  })

  it('«Registrar de nuevo» desde dos ventanas: el segundo intento ve otro intento y no duplica', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    const key = occurrenceKey(r.id, '2026-03-31')
    const doc = await loadRecurring(backend)
    const draft = buildPlan(doc, await load(), config, TODAY).items[0].draft
    doc.ledger[key] = { state: 'sending', ruleId: r.id, date: '2026-03-31', at: 'intento-1', draft }
    await saveRecurring(backend, doc)
    const seenByBoth = buildPlan(doc, await load(), config, TODAY).items // ambas ventanas ven el intento 1
    expect(seenByBoth[0]).toMatchObject({ uncertain: true, attempt: 'intento-1' })
    // La ventana A reintenta: nuevo «enviándose» con otra marca y la respuesta se pierde.
    const create = backend.createPage.bind(backend)
    backend.createPage = async (role: Role, props: Record<string, PropWrite>) => {
      await create(role, props)
      throw new LunarError({ code: 'offline', message: 'x' })
    }
    const dataA = await load()
    const docA = await loadRecurring(backend)
    const a = selectApproved(buildPlan(docA, dataA, config, TODAY), seenByBoth)
    expect(a.todo).toHaveLength(1)
    await registerOccurrences({ backend, config, index: dataA.index, pages: dataA.pages }, docA, a.todo, (d) => saveRecurring(backend, d), () => 'intento-2')
    // La ventana B, con datos de Notion anteriores, relee el documento dentro del cerrojo: ya no coincide.
    const docB = await loadRecurring(backend)
    expect(selectApproved(buildPlan(docB, dataA, config, TODAY), seenByBoth)).toEqual({ todo: [], changed: 1 })
    expect(await keysInNotion()).toEqual([key])
  })

  it('un aviso nuevo (movimiento igual introducido a mano) anula la aprobación', async () => {
    await createRule({ startDate: '2026-03-31', mode: 'confirm', kind: 'expense', categoryId: null, categoryName: null })
    const seen = buildPlan(await loadRecurring(backend), await load(), config, TODAY).items
    const data = await load()
    const manual = { ...data.movements[0], description: 'Gimnasio (prueba)', date: '2026-03-31', amountCents: 3990, kind: 'expense' as const }
    const fresh = buildPlan(await loadRecurring(backend), { ...data, movements: [...data.movements, manual] }, config, TODAY)
    expect(selectApproved(fresh, seen)).toEqual({ todo: [], changed: 1 })
  })

  it('lo ya registrado entre tanto simplemente desaparece de la selección', async () => {
    await createRule({ startDate: '2026-03-31', mode: 'confirm' })
    const seen = buildPlan(await loadRecurring(backend), await load(), config, TODAY).items
    const data = await load()
    const doc = await loadRecurring(backend)
    await registerOccurrences({ backend, config, index: data.index, pages: data.pages }, doc, seen, (d) => saveRecurring(backend, d))
    const fresh = buildPlan(await loadRecurring(backend), await load(), config, TODAY)
    expect(selectApproved(fresh, seen)).toEqual({ todo: [], changed: 0 })
  })

  it('un error de interpretación tras crear (schema) se trata como incierto, no como rechazo', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    const create = backend.createPage.bind(backend)
    backend.createPage = async (role: Role, props: Record<string, PropWrite>) => {
      await create(role, props)
      throw new LunarError({ code: 'schema', message: 'Respuesta sin ID.' })
    }
    const res = await runOnce()
    expect(res.outcomes[0]).toMatchObject({ uncertain: true })
    expect((await loadRecurring(backend)).ledger[occurrenceKey(r.id, '2026-03-31')].state).toBe('sending')
  })
})

describe('cambios en las reglas', () => {
  it('cambiar el importe no modifica lo registrado y se aplica a lo siguiente', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    await runOnce()
    const before = (await backend.query('movements')).pages.find((p) => Object.values(p.properties).some((v) => v.value.type === 'rich_text' && v.value.value === occurrenceKey(r.id, '2026-03-31')))!
    const doc = await loadRecurring(backend)
    upsertRule(doc, input({ startDate: '2026-03-31', amountCents: 4590 }), r.id, 'later', TODAY)
    await saveRecurring(backend, doc)
    const after = await runOnce('2026-04-30')
    expect(after.outcomes).toHaveLength(1)
    expect(after.outcomes[0].page!.properties['cant'].value).toEqual({ type: 'number', value: 45.9 })
    const unchanged = (await backend.query('movements')).pages.find((p) => p.id === before.id)!
    expect(unchanged.properties['cant'].value).toEqual({ type: 'number', value: 39.9 })
  })

  it('el nuevo calendario debe empezar después del último pago registrado', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    await runOnce()
    const doc = await loadRecurring(backend)
    const { index } = await load()
    expect(validateRecurringInput(input({ startDate: '2026-03-15' }), doc.rules[0], doc, index, TODAY)).toMatch(/después del último/)
    expect(validateRecurringInput(input({ startDate: '2026-04-20' }), doc.rules[0], doc, index, TODAY)).toBeNull()
    expect(r.id).toBe(doc.rules[0].id)
  })

  it('no se puede cambiar el calendario con un envío sin comprobar', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    const doc = await loadRecurring(backend)
    doc.ledger[occurrenceKey(r.id, '2026-03-31')] = { state: 'sending', ruleId: r.id, date: '2026-03-31', at: 'x', draft: { date: '2026-03-31', description: 'x', amountCents: 1, kind: 'transfer', categoryId: null, categoryName: null, paymentMethod: null } }
    const { index } = await load()
    expect(validateRecurringInput(input({ startDate: '2026-05-01' }), doc.rules[0], doc, index, TODAY)).toMatch(/pendiente de comprobar/)
  })

  it('la fecha de inicio no puede ser de hace más de un año', async () => {
    const { index } = await load()
    expect(validateRecurringInput(input({ startDate: addDays(TODAY, -400) }), null, await loadRecurring(backend), index, TODAY)).toMatch(/hace un año/)
  })

  it('pausar y reanudar: los pagos del periodo en pausa no se registran', async () => {
    const r = await createRule({ startDate: '2026-01-31' })
    const doc = await loadRecurring(backend)
    setRuleActive(doc, r.id, false, 'x', '2026-01-15')
    await saveRecurring(backend, doc)
    expect((await runOnce()).outcomes).toEqual([])
    setRuleActive(doc, r.id, true, 'y', TODAY)
    await saveRecurring(backend, doc)
    await runOnce('2026-05-31')
    expect((await keysInNotion()).sort()).toEqual([occurrenceKey(r.id, '2026-04-30'), occurrenceKey(r.id, '2026-05-31')])
  })

  it('eliminar una regla no toca los movimientos de Notion y conserva los envíos sin comprobar', async () => {
    const r = await createRule({ startDate: '2026-03-31' })
    await runOnce()
    const doc: RecurringDoc = await loadRecurring(backend)
    doc.ledger['otra'] = { state: 'sending', ruleId: r.id, date: '2026-04-01', at: 'x', draft: { date: '2026-04-01', description: 'x', amountCents: 1, kind: 'transfer', categoryId: null, categoryName: null, paymentMethod: null } }
    deleteRule(doc, r.id)
    expect(doc.rules).toEqual([])
    expect(Object.keys(doc.ledger)).toEqual(['otra'])
    expect(await keysInNotion()).toHaveLength(1)
  })
})
