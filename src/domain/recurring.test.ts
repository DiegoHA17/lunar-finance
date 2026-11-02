import { describe, expect, it } from 'vitest'
import { cat, index, mov, withCategory } from '../test/factories'
import { addDays } from './dates'
import {
  EMPTY_RECURRING,
  type PlanContext,
  type RecurringDoc,
  type RecurringRule,
  nextOccurrence,
  occurrenceDate,
  occurrenceKey,
  occurrencesBetween,
  parseOccurrenceKey,
  parseRecurringDoc,
  planRecurring,
  scheduleLabel,
} from './recurring'

const rent = cat('Vivienda')
const salary = cat('Nómina', { kind: 'income' })
const idx = index([rent, salary])

function rule(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rp_alquiler',
    description: 'Alquiler',
    amountCents: 75000,
    kind: 'expense',
    categoryId: rent.id,
    categoryName: rent.name,
    paymentMethod: 'Transferencia',
    frequency: 'monthly',
    startDate: '2026-01-31',
    from: '2026-01-31',
    autoFrom: '2026-01-01',
    mode: 'auto',
    active: true,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    ...over,
  }
}

function doc(rules: RecurringRule[], ledger: RecurringDoc['ledger'] = {}): RecurringDoc {
  return { ...structuredClone(EMPTY_RECURRING), dataSourceId: 'ds-mov', rules, ledger }
}

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return { today: '2026-04-15', notionKeys: new Map(), complete: true, propertyReady: true, dataSourceId: 'ds-mov', movements: [], index: idx, ...over }
}

describe('calendario', () => {
  it('mensual el día 31: último día de los meses cortos y vuelve al 31', () => {
    const dates = [0, 1, 2, 3, 4, 12, 13].map((n) => occurrenceDate('2026-01-31', 'monthly', n))
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2027-01-31', '2027-02-28'])
    expect(occurrenceDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29') // bisiesto
  })

  it('días 29 y 30 en febrero', () => {
    expect(occurrenceDate('2026-01-29', 'monthly', 1)).toBe('2026-02-28')
    expect(occurrenceDate('2026-01-30', 'monthly', 1)).toBe('2026-02-28')
    expect(occurrenceDate('2026-01-30', 'monthly', 2)).toBe('2026-03-30')
    expect(occurrenceDate('2027-12-29', 'monthly', 2)).toBe('2028-02-29')
  })

  it('anual el 29 de febrero: 28 en años no bisiestos y 29 en los bisiestos', () => {
    expect([0, 1, 2, 3, 4].map((n) => occurrenceDate('2028-02-29', 'yearly', n))).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })

  it('semanal: cada 7 días, también al cruzar meses y años', () => {
    expect([0, 1, 2].map((n) => occurrenceDate('2026-12-24', 'weekly', n))).toEqual(['2026-12-24', '2026-12-31', '2027-01-07'])
  })

  it('occurrencesBetween coincide con recorrer el calendario desde el inicio', () => {
    for (const frequency of ['weekly', 'monthly', 'yearly'] as const) {
      for (const startDate of ['2024-02-29', '2025-01-31', '2026-03-15', '2026-12-31']) {
        for (const from of ['2024-01-01', '2025-03-01', '2026-02-28', '2026-07-31']) {
          const to = '2029-12-31'
          const brute: string[] = []
          for (let n = 0; ; n++) {
            const d = occurrenceDate(startDate, frequency, n)
            if (d > to) break
            if (d >= from) brute.push(d)
          }
          expect(occurrencesBetween({ startDate, frequency }, from, to)).toEqual(brute)
        }
      }
    }
  })

  it('describe el calendario en español', () => {
    expect(scheduleLabel({ frequency: 'monthly', startDate: '2026-01-31' })).toBe('Mensual, el día 31 (o el último del mes)')
    expect(scheduleLabel({ frequency: 'weekly', startDate: '2026-11-02' })).toBe('Semanal, los lunes')
    expect(scheduleLabel({ frequency: 'yearly', startDate: '2026-03-05' })).toBe('Anual, el 5 de marzo')
  })
})

describe('claves de ocurrencia', () => {
  it('son estables y se reconocen', () => {
    const key = occurrenceKey('rp_123', '2026-02-28')
    expect(key).toBe('lunar-rp:rp_123:2026-02-28')
    expect(parseOccurrenceKey(` ${key} `)).toEqual({ ruleId: 'rp_123', date: '2026-02-28' })
    expect(parseOccurrenceKey('Alquiler')).toBeNull()
    expect(parseOccurrenceKey('lunar-rp:rp_123:2026-02-30')).toBeNull()
    expect(parseOccurrenceKey(null)).toBeNull()
  })
})

describe('plan de registro', () => {
  it('genera todos los periodos vencidos, en orden, con el importe y la categoría de la regla', () => {
    const plan = planRecurring(doc([rule()]), ctx())
    expect(plan.blocked).toBeNull()
    expect(plan.items.map((i) => i.draft.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(plan.items.every((i) => i.action === 'auto' && i.draft.amountCents === 75000 && i.draft.categoryId === rent.id)).toBe(true)
  })

  it('lo anterior al alta de la regla nunca se registra solo; el modo con confirmación nunca es automático', () => {
    expect(planRecurring(doc([rule({ autoFrom: '2026-03-01' })]), ctx()).items.map((i) => i.action)).toEqual(['manual', 'manual', 'auto'])
    expect(planRecurring(doc([rule({ mode: 'confirm' })]), ctx()).items.every((i) => i.action === 'manual')).toBe(true)
  })

  it('una regla en pausa no genera nada', () => {
    expect(planRecurring(doc([rule({ active: false })]), ctx()).items).toEqual([])
  })

  it('lo que ya está en Notion se reconoce por su clave, aunque se haya editado el importe o la descripción', () => {
    const key = occurrenceKey('rp_alquiler', '2026-02-28')
    const plan = planRecurring(doc([rule()]), ctx({ notionKeys: new Map([[key, ['page-1']]]) }))
    expect(plan.found[key]).toEqual({ ruleId: 'rp_alquiler', date: '2026-02-28', pageId: 'page-1' })
    expect(plan.items.map((i) => i.draft.date)).toEqual(['2026-01-31', '2026-03-31'])
  })

  it('lo registrado u omitido no se repite aunque se haya borrado de Notion', () => {
    const d = doc([rule()], {
      [occurrenceKey('rp_alquiler', '2026-01-31')]: { state: 'registered', ruleId: 'rp_alquiler', date: '2026-01-31', at: 'x', pageId: 'borrada' },
      [occurrenceKey('rp_alquiler', '2026-02-28')]: { state: 'skipped', ruleId: 'rp_alquiler', date: '2026-02-28', at: 'x' },
    })
    expect(planRecurring(d, ctx()).items.map((i) => i.draft.date)).toEqual(['2026-03-31'])
  })

  it('un envío sin respuesta: registrado si Notion tiene la clave; si no, revisión manual y nunca automático', () => {
    const key = occurrenceKey('rp_alquiler', '2026-03-31')
    const sending = { state: 'sending' as const, ruleId: 'rp_alquiler', date: '2026-03-31', at: 'x', draft: { date: '2026-03-31', description: 'Alquiler', amountCents: 70000, kind: 'expense' as const, categoryId: null, categoryName: null, paymentMethod: null } }
    const found = planRecurring(doc([rule()], { [key]: sending }), ctx({ notionKeys: new Map([[key, ['p']]]) }))
    expect(found.found[key]?.pageId).toBe('p')
    expect(found.items.some((i) => i.key === key)).toBe(false)
    const missing = planRecurring(doc([rule()], { [key]: sending }), ctx())
    const item = missing.items.find((i) => i.key === key)!
    expect(item).toMatchObject({ action: 'manual', uncertain: true })
    expect(item.draft.amountCents).toBe(70000) // se conserva lo que se envió, no el importe actual de la regla
    expect(missing.items.filter((i) => i.key === key)).toHaveLength(1)
  })

  it('con datos incompletos, sin propiedad o con otra base de datos no se registra nada', () => {
    for (const c of [ctx({ complete: false }), ctx({ propertyReady: false }), ctx({ dataSourceId: 'otra' })]) {
      const plan = planRecurring(doc([rule()]), c)
      expect(plan.blocked).not.toBeNull()
      expect(plan.items.every((i) => i.action === 'manual')).toBe(true)
    }
  })

  it('un movimiento igual sin clave (p. ej. introducido a mano) pide revisión en vez de duplicarlo', () => {
    const manual = withCategory(mov({ description: 'Alquiler', euros: 750, date: '2026-03-31' }), rent)
    const item = planRecurring(doc([rule()]), ctx({ movements: [manual] })).items.find((i) => i.draft.date === '2026-03-31')!
    expect(item.action).toBe('manual')
    expect(item.warning).toMatch(/movimiento igual/)
  })

  it('si la categoría ya no existe pide revisión', () => {
    const item = planRecurring(doc([rule({ categoryId: 'cat-borrada', categoryName: 'Borrada' })]), ctx()).items[0]
    expect(item.action).toBe('manual')
    expect(item.warning).toMatch(/ya no existe/)
  })

  it('detecta claves repetidas en Notion', () => {
    const key = occurrenceKey('rp_alquiler', '2026-01-31')
    expect(planRecurring(doc([rule()]), ctx({ notionKeys: new Map([[key, ['a', 'b']]]) })).repeatedKeys).toEqual([key])
  })

  it('reanudar desde hoy no recupera los pagos de la pausa', () => {
    expect(planRecurring(doc([rule({ from: '2026-04-15' })]), ctx({ today: '2026-05-31' })).items.map((i) => i.draft.date)).toEqual(['2026-04-30', '2026-05-31'])
  })

  it('muchos periodos pendientes tras meses sin abrir la aplicación', () => {
    const weekly = rule({ id: 'rp_w', frequency: 'weekly', startDate: '2026-01-05', from: '2026-01-05' })
    expect(planRecurring(doc([weekly]), ctx({ today: addDays('2026-01-05', 7 * 30) })).items).toHaveLength(31)
  })

  it('próxima ejecución: la primera sin registrar ni omitir', () => {
    const r = rule()
    expect(nextOccurrence(r, {})).toBe('2026-01-31')
    expect(nextOccurrence(r, { [occurrenceKey(r.id, '2026-01-31')]: { state: 'registered', ruleId: r.id, date: '2026-01-31', at: 'x', pageId: 'p' } })).toBe('2026-02-28')
    expect(nextOccurrence({ ...r, active: false }, {})).toBeNull()
  })
})

describe('documento local', () => {
  it('vacío si no existe; error si está dañado (nunca se ignora en silencio)', () => {
    expect(parseRecurringDoc(null)).toEqual(EMPTY_RECURRING)
    expect(() => parseRecurringDoc({ version: 1, rules: [{ id: 'x' }], ledger: {} })).toThrow()
    expect(() => parseRecurringDoc({ version: 1, rules: [], ledger: { k: { state: 'raro' } } })).toThrow()
    expect(() => parseRecurringDoc({ version: 2 })).toThrow()
    const d = doc([rule()])
    expect(parseRecurringDoc(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
})
