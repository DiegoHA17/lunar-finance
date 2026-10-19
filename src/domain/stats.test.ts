import { describe, expect, it } from 'vitest'
import { blocking, cat, index, mov, withCategory } from '../test/factories'
import { monthPeriod, quarterPeriod, yearPeriod } from './periods'
import { UNCATEGORIZED_KEY, compareWithPrevious, computeTimeline, computeTotals, signedCents, summarize } from './stats'

const food = cat('Alimentación')
const fun = cat('Ocio')
const salary = cat('Nómina', { kind: 'income' })
const archived = cat('Gimnasio', { status: 'archived' })
const cats = index([food, fun, salary, archived])

describe('computeTotals', () => {
  it('suma gastos e ingresos y calcula el balance neto', () => {
    const t = computeTotals([mov({ euros: 10.5 }), mov({ euros: 20.25 }), mov({ euros: 1500, kind: 'income' })])
    expect(t.expenseCents).toBe(3075)
    expect(t.incomeCents).toBe(150000)
    expect(t.netExpenseCents).toBe(3075)
    expect(t.balanceCents).toBe(146925)
    expect(t.countedCount).toBe(3)
  })

  it('las devoluciones restan gasto y las transferencias no cuentan', () => {
    const t = computeTotals([
      mov({ euros: 100 }),
      mov({ euros: 30, kind: 'refund' }),
      mov({ euros: 500, kind: 'transfer' }),
      mov({ euros: 200, kind: 'income' }),
    ])
    expect(t.expenseCents).toBe(10000)
    expect(t.refundCents).toBe(3000)
    expect(t.netExpenseCents).toBe(7000)
    expect(t.transferCents).toBe(50000)
    expect(t.incomeCents).toBe(20000)
    expect(t.balanceCents).toBe(13000)
  })

  it('suma importes decimales sin errores de redondeo', () => {
    const list = Array.from({ length: 300 }, () => mov({ amountCents: 333 }))
    expect(computeTotals(list).expenseCents).toBe(99900)
  })

  it('excluye los movimientos con incidencias bloqueantes y los cuenta aparte', () => {
    const t = computeTotals([mov({ euros: 10 }), mov({ amountCents: null, issues: [blocking('missing_amount')] }), mov({ kind: null, issues: [blocking('unknown_kind')] })])
    expect(t.expenseCents).toBe(1000)
    expect(t.countedCount).toBe(1)
    expect(t.excludedCount).toBe(2)
  })

  it('una lista vacía da ceros, no errores', () => {
    const t = computeTotals([])
    expect(t.balanceCents).toBe(0)
    expect(t.countedCount).toBe(0)
  })

  it('el importe con signo de cada movimiento suma el balance', () => {
    const list = [mov({ euros: 12.34 }), mov({ euros: 1000, kind: 'income' }), mov({ euros: 2, kind: 'refund' }), mov({ euros: 50, kind: 'transfer' })]
    const sum = list.reduce((a, m) => a + (signedCents(m) ?? 0), 0)
    expect(sum).toBe(computeTotals(list).balanceCents)
  })
})

describe('summarize', () => {
  const oct = monthPeriod(2026, 10)
  const list = [
    withCategory(mov({ euros: 50, date: '2026-10-01' }), food),
    withCategory(mov({ euros: 30, date: '2026-10-31' }), food),
    withCategory(mov({ euros: 20, date: '2026-10-15' }), fun),
    withCategory(mov({ euros: 5, kind: 'refund', date: '2026-10-16' }), fun),
    withCategory(mov({ euros: 40, date: '2026-10-02' }), archived),
    mov({ euros: 10, date: '2026-10-03' }),
    mov({ euros: 7, date: '2026-10-04', categoryLink: { type: 'name', name: 'Mascotas' } }),
    withCategory(mov({ euros: 2000, kind: 'income', date: '2026-10-28' }), salary),
    mov({ euros: 999, date: '2026-09-30' }),
    mov({ euros: 999, date: '2026-11-01' }),
  ]

  it('solo incluye movimientos dentro del periodo (límites inclusivos)', () => {
    const s = summarize(list, cats, oct)
    expect(s.movements).toHaveLength(8)
    expect(s.totals.expenseCents).toBe(15700)
    expect(s.totals.refundCents).toBe(500)
    expect(s.totals.netExpenseCents).toBe(15200)
    expect(s.totals.balanceCents).toBe(200000 - 15200)
  })

  it('agrupa por categoría, incluye archivadas, desconocidas y sin categoría', () => {
    const s = summarize(list, cats, oct)
    const byName = Object.fromEntries(s.expenseByCategory.map((r) => [r.name, r]))
    expect(byName['Alimentación'].netCents).toBe(8000)
    expect(byName['Ocio']).toMatchObject({ grossCents: 2000, refundCents: 500, netCents: 1500, count: 2 })
    expect(byName['Gimnasio'].status).toBe('archived')
    expect(byName['Mascotas'].status).toBe('unknown')
    expect(byName['Sin categoría'].key).toBe(UNCATEGORIZED_KEY)
    expect(s.uncategorizedCount).toBe(1)
    expect(s.unknownCategoryCount).toBe(1)
    expect(s.expenseByCategory[0].name).toBe('Alimentación')
    const sum = s.expenseByCategory.reduce((a, r) => a + r.netCents, 0)
    expect(sum).toBe(s.totals.netExpenseCents)
    expect(s.incomeByCategory).toHaveLength(1)
  })

  it('calcula la distribución porcentual sobre el gasto neto', () => {
    const s = summarize(list, cats, oct)
    const food = s.expenseByCategory.find((r) => r.name === 'Alimentación')!
    expect(food.shareBp).toBe(Math.round((8000 * 10000) / 15200))
  })

  it('no inventa porcentajes cuando no hay gasto', () => {
    const s = summarize([mov({ euros: 100, kind: 'income', date: '2026-10-05' })], cats, oct)
    expect(s.expenseByCategory).toHaveLength(0)
    expect(s.incomeByCategory[0].shareBp).toBe(10000)
  })
})

describe('evolución temporal', () => {
  it('reparte por tramos y solo es significativa con al menos dos tramos con datos', () => {
    const one = computeTimeline([mov({ euros: 10, date: '2026-10-05' })], monthPeriod(2026, 10))
    expect(one.meaningful).toBe(false)
    const two = computeTimeline([mov({ euros: 10, date: '2026-10-05' }), mov({ euros: 5, date: '2026-10-20' })], monthPeriod(2026, 10))
    expect(two.meaningful).toBe(true)
    expect(two.points.find((p) => p.bucket.start === '2026-10-05')!.netExpenseCents).toBe(1000)
  })

  it('el año se agrupa por meses y respeta el cambio de año', () => {
    const t = computeTimeline([mov({ euros: 1, date: '2025-12-31' }), mov({ euros: 2, date: '2026-01-01' }), mov({ euros: 3, date: '2026-12-31' })], yearPeriod(2026))
    expect(t.points).toHaveLength(12)
    expect(t.points[0].expenseCents).toBe(200)
    expect(t.points[11].expenseCents).toBe(300)
  })
})

describe('comparación con el periodo anterior', () => {
  it('no compara si el periodo anterior no tiene datos', () => {
    const list = [mov({ euros: 10, date: '2026-10-05' })]
    expect(compareWithPrevious(list, monthPeriod(2026, 10), '2030-01-01')).toBeNull()
  })

  it('compara enero con diciembre del año anterior', () => {
    const list = [mov({ euros: 100, date: '2025-12-01' }), mov({ euros: 150, date: '2026-01-15' })]
    const c = compareWithPrevious(list, monthPeriod(2026, 1), '2030-01-01')!
    expect(c.previousPeriod).toEqual(monthPeriod(2025, 12))
    expect(c.netExpenseChangeBp).toBe(5000)
    expect(c.incomeChangeBp).toBeNull()
  })

  it('un periodo en curso se compara hasta el mismo punto del anterior', () => {
    const list = [
      mov({ euros: 100, date: '2026-09-01' }),
      mov({ euros: 900, date: '2026-09-25' }),
      mov({ euros: 1500, kind: 'income', date: '2026-09-28' }),
      mov({ euros: 150, date: '2026-10-10' }),
      mov({ euros: 50, date: '2026-10-25' }), // fecha futura respecto a «hoy»: no entra
    ]
    const c = compareWithPrevious(list, monthPeriod(2026, 10), '2026-10-19')!
    expect(c.partial).toBe(true)
    expect(c.currentRange).toMatchObject({ start: '2026-10-01', end: '2026-10-19' })
    expect(c.previousRange).toMatchObject({ start: '2026-09-01', end: '2026-09-19' })
    expect(c.netExpenseChangeBp).toBe(5000)
    expect(c.incomeChangeBp).toBeNull()
  })

  it('no compara si el historial no cubre todo el tramo anterior (datos parciales)', () => {
    // Los datos empiezan en agosto de 2025: comparar 2026 con «2025» sería comparar un año con cinco meses.
    const list = [mov({ euros: 100, date: '2025-08-10' }), mov({ euros: 50, date: '2025-09-15' }), mov({ euros: 100, date: '2026-03-10' })]
    expect(compareWithPrevious(list, yearPeriod(2026), '2027-01-01')).toBeNull()
    expect(compareWithPrevious(list, monthPeriod(2025, 9), '2027-01-01')).toBeNull() // agosto también es parcial
    expect(compareWithPrevious(list, monthPeriod(2025, 10), '2027-01-01')).not.toBeNull()
  })

  it('el tramo anterior no se sale de su periodo (31 de marzo frente a febrero)', () => {
    const c = compareWithPrevious([mov({ euros: 1, date: '2026-02-01' })], monthPeriod(2026, 3), '2026-03-30')!
    expect(c.previousRange.end).toBe('2026-02-28')
  })

  it('compara trimestres a través del año', () => {
    const list = [mov({ euros: 200, date: '2025-10-01' }), mov({ euros: 100, date: '2026-02-01' })]
    const q1 = quarterPeriod(2026, 1)
    const c = compareWithPrevious(list, q1, '2030-01-01')!
    expect(c.netExpenseChangeBp).toBe(-5000)
  })
})
