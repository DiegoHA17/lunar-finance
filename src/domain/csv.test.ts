import { describe, expect, it } from 'vitest'
import { blocking, cat, index, mov, withCategory } from '../test/factories'
import { CSV_HEADERS, movementsToCsv, neutralizeFormula, parseCsv, parseDecimalCell } from './csv'
import { EMPTY_FILTER, applyFilter } from './filters'
import { monthPeriod } from './periods'
import { computeTotals, summarize } from './stats'

const food = cat('Alimentación')
const fun = cat('Ocio')
const cats = index([food, fun])

describe('CSV', () => {
  it('usa BOM UTF-8, punto y coma, CRLF, coma decimal y fechas españolas', () => {
    const csv = movementsToCsv([withCategory(mov({ description: 'Café', euros: 1234.5, date: '2026-10-09' }), food)], cats)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('\r\n')
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual(CSV_HEADERS)
    expect(rows[1]).toEqual(['09/10/2026', 'Café', 'Alimentación', 'Gasto', 'Tarjeta', '1234,50', '-1234,50', 'Sí', ''])
  })

  it('neutraliza fórmulas en los campos de texto', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '＝1']) {
      expect(neutralizeFormula(evil).startsWith("'")).toBe(true)
    }
    const csv = movementsToCsv([mov({ description: '=cmd|"/c calc"!A1', paymentMethod: '@x' })], cats)
    const row = parseCsv(csv)[1]
    expect(row[1]).toBe(`'=cmd|"/c calc"!A1`)
    expect(row[4]).toBe("'@x")
  })

  it('no altera los importes negativos (no son texto del usuario)', () => {
    const row = parseCsv(movementsToCsv([mov({ euros: 5 })], cats))[1]
    expect(row[6]).toBe('-5,00')
  })

  it('entrecomilla separadores, comillas y saltos de línea', () => {
    const csv = movementsToCsv([mov({ description: 'Cena; "postre"\nincluido' })], cats)
    expect(parseCsv(csv)[1][1]).toBe('Cena; "postre"\nincluido')
  })

  it('incluye los movimientos excluidos con el motivo y sin importe con signo', () => {
    const row = parseCsv(movementsToCsv([mov({ amountCents: null, issues: [blocking('missing_amount')] })], cats))[1]
    expect(row[5]).toBe('')
    expect(row[6]).toBe('')
    expect(row[7]).toBe('No')
    expect(row[8]).toBe('missing_amount')
  })
})

describe('consistencia entre filtros, CSV y estadísticas', () => {
  const list = [
    withCategory(mov({ description: 'Mercadona', euros: 45.67, date: '2026-10-02' }), food),
    withCategory(mov({ description: 'Cine', euros: 9.9, date: '2026-10-03' }), fun),
    withCategory(mov({ description: 'Devolución cine', euros: 9.9, kind: 'refund', date: '2026-10-04' }), fun),
    mov({ description: 'Nómina', euros: 1850.01, kind: 'income', date: '2026-10-28' }),
    mov({ description: 'A ahorro', euros: 300, kind: 'transfer', date: '2026-10-29' }),
    mov({ description: 'Roto', amountCents: null, issues: [blocking()], date: '2026-10-05' }),
    mov({ description: 'Fuera', euros: 1, date: '2026-11-01' }),
  ]

  it('la suma de «Importe con signo» del CSV filtrado es el balance del periodo', () => {
    const period = monthPeriod(2026, 10)
    const filtered = applyFilter(list, { ...EMPTY_FILTER, period }, cats)
    const rows = parseCsv(movementsToCsv(filtered, cats)).slice(1)
    expect(rows).toHaveLength(6)
    const sum = rows.reduce((a, r) => a + (parseDecimalCell(r[6]) ?? 0), 0)
    expect(sum).toBe(summarize(list, cats, period).totals.balanceCents)
    expect(sum).toBe(computeTotals(filtered).balanceCents)
  })

  it('el CSV exporta exactamente los movimientos que muestra el filtro', () => {
    const f = { ...EMPTY_FILTER, period: monthPeriod(2026, 10), categoryKeys: [fun.id] }
    const filtered = applyFilter(list, f, cats)
    const rows = parseCsv(movementsToCsv(filtered, cats)).slice(1)
    expect(rows.map((r) => r[1])).toEqual(filtered.map((m) => m.description))
    expect(rows.map((r) => r[1]).sort()).toEqual(['Cine', 'Devolución cine'])
  })

  it('el filtro de búsqueda ignora acentos y mayúsculas', () => {
    expect(applyFilter(list, { ...EMPTY_FILTER, search: 'NOMINA' }, cats).map((m) => m.description)).toEqual(['Nómina'])
    expect(applyFilter(list, { ...EMPTY_FILTER, status: 'excluded' }, cats).map((m) => m.description)).toEqual(['Roto'])
  })
})
