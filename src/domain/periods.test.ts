import { describe, expect, it } from 'vitest'
import { isValidISODate, isoWeek, notionDateToISO, today } from './dates'
import {
  PeriodError,
  bucketIndex,
  buckets,
  customPeriod,
  granularityFor,
  inPeriod,
  monthPeriod,
  nextPeriod,
  periodContaining,
  periodLabel,
  periodSlug,
  previousPeriod,
  quarterPeriod,
  weekOf,
  yearPeriod,
} from './periods'

describe('fechas', () => {
  it('valida fechas de calendario reales', () => {
    expect(isValidISODate('2024-02-29')).toBe(true)
    expect(isValidISODate('2023-02-29')).toBe(false)
    expect(isValidISODate('2026-13-01')).toBe(false)
    expect(isValidISODate('2026-1-01')).toBe(false)
    expect(isValidISODate(null)).toBe(false)
  })

  it('extrae la fecha de calendario de los valores de Notion sin convertir zonas horarias', () => {
    expect(notionDateToISO('2026-10-01')).toBe('2026-10-01')
    expect(notionDateToISO('2026-12-31T23:30:00.000+01:00')).toBe('2026-12-31')
    expect(notionDateToISO('basura')).toBeNull()
    expect(notionDateToISO(null)).toBeNull()
  })

  it('calcula semanas ISO en los cambios de año', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 })
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 })
  })

  it('usa la fecha local para «hoy»', () => {
    expect(today(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })
})

describe('periodos', () => {
  it('construye meses con su último día correcto', () => {
    expect(monthPeriod(2024, 2)).toEqual({ kind: 'month', start: '2024-02-01', end: '2024-02-29' })
    expect(monthPeriod(2026, 2).end).toBe('2026-02-28')
    expect(monthPeriod(2026, 12)).toEqual({ kind: 'month', start: '2026-12-01', end: '2026-12-31' })
  })

  it('construye trimestres y años', () => {
    expect(quarterPeriod(2026, 1)).toEqual({ kind: 'quarter', start: '2026-01-01', end: '2026-03-31' })
    expect(quarterPeriod(2026, 4)).toEqual({ kind: 'quarter', start: '2026-10-01', end: '2026-12-31' })
    expect(yearPeriod(2026)).toEqual({ kind: 'year', start: '2026-01-01', end: '2026-12-31' })
  })

  it('las semanas van de lunes a domingo y pueden cruzar el año', () => {
    expect(weekOf('2026-10-19')).toEqual({ kind: 'week', start: '2026-10-19', end: '2026-10-25' })
    expect(weekOf('2026-10-25')).toEqual({ kind: 'week', start: '2026-10-19', end: '2026-10-25' })
    expect(weekOf('2027-01-01')).toEqual({ kind: 'week', start: '2026-12-28', end: '2027-01-03' })
  })

  it('el periodo anterior y siguiente cruzan límites de mes, trimestre y año', () => {
    expect(previousPeriod(monthPeriod(2026, 1))).toEqual(monthPeriod(2025, 12))
    expect(nextPeriod(monthPeriod(2025, 12))).toEqual(monthPeriod(2026, 1))
    expect(previousPeriod(monthPeriod(2026, 3))).toEqual(monthPeriod(2026, 2))
    expect(previousPeriod(quarterPeriod(2026, 1))).toEqual(quarterPeriod(2025, 4))
    expect(nextPeriod(quarterPeriod(2026, 4))).toEqual(quarterPeriod(2027, 1))
    expect(previousPeriod(yearPeriod(2026))).toEqual(yearPeriod(2025))
    expect(previousPeriod(weekOf('2027-01-01'))).toEqual(weekOf('2026-12-21'))
  })

  it('el periodo anterior de un intervalo personalizado tiene la misma duración', () => {
    const p = customPeriod('2026-03-10', '2026-03-19')
    expect(previousPeriod(p)).toEqual({ kind: 'custom', start: '2026-02-28', end: '2026-03-09' })
    expect(nextPeriod(p)).toEqual({ kind: 'custom', start: '2026-03-20', end: '2026-03-29' })
  })

  it('valida los intervalos personalizados', () => {
    expect(() => customPeriod('2026-03-10', '2026-03-01')).toThrow(PeriodError)
    expect(() => customPeriod('2026-02-30', '2026-03-01')).toThrow(PeriodError)
    expect(customPeriod('2026-03-01', '2026-03-01').start).toBe('2026-03-01')
  })

  it('incluye el primer y el último día y excluye los adyacentes', () => {
    const oct = monthPeriod(2026, 10)
    expect(inPeriod(oct, '2026-10-01')).toBe(true)
    expect(inPeriod(oct, '2026-10-31')).toBe(true)
    expect(inPeriod(oct, '2026-09-30')).toBe(false)
    expect(inPeriod(oct, '2026-11-01')).toBe(false)
    expect(inPeriod(oct, null)).toBe(false)
  })

  it('encuentra el periodo que contiene una fecha', () => {
    expect(periodContaining('quarter', '2026-05-15')).toEqual(quarterPeriod(2026, 2))
    expect(periodContaining('month', '2026-12-31')).toEqual(monthPeriod(2026, 12))
  })

  it('genera etiquetas y nombres de archivo legibles', () => {
    expect(periodLabel(monthPeriod(2026, 10))).toBe('octubre de 2026')
    expect(periodLabel(quarterPeriod(2026, 4))).toBe('T4 2026 (oct–dic)')
    expect(periodLabel(yearPeriod(2026))).toBe('2026')
    expect(periodLabel(weekOf('2026-10-19'))).toBe('Semana 43 · 19–25 oct 2026')
    expect(periodLabel(weekOf('2027-01-01'))).toBe('Semana 53 · 28 dic 2026 – 3 ene 2027')
    expect(periodSlug(monthPeriod(2026, 3))).toBe('2026-03')
    expect(periodSlug(quarterPeriod(2026, 2))).toBe('2026-T2')
    expect(periodSlug(weekOf('2027-01-01'))).toBe('2026-S53')
  })
})

describe('tramos de evolución', () => {
  it('elige la granularidad según la duración', () => {
    expect(granularityFor(monthPeriod(2026, 10))).toBe('day')
    expect(granularityFor(quarterPeriod(2026, 4))).toBe('week')
    expect(granularityFor(yearPeriod(2026))).toBe('month')
  })

  it('los tramos cubren el periodo exactamente, sin huecos ni solapes', () => {
    for (const p of [monthPeriod(2026, 2), quarterPeriod(2026, 4), yearPeriod(2024), customPeriod('2025-12-20', '2026-02-10')]) {
      const bs = buckets(p)
      expect(bs[0].start).toBe(p.start)
      expect(bs[bs.length - 1].end).toBe(p.end)
      for (let i = 1; i < bs.length; i++) expect(bs[i].start > bs[i - 1].end).toBe(true)
    }
    expect(buckets(yearPeriod(2026))).toHaveLength(12)
    expect(buckets(monthPeriod(2024, 2))).toHaveLength(29)
  })

  it('localiza el tramo de cada fecha', () => {
    const bs = buckets(quarterPeriod(2026, 4))
    expect(bucketIndex(bs, '2026-10-01')).toBe(0)
    expect(bucketIndex(bs, '2026-12-31')).toBe(bs.length - 1)
    expect(bucketIndex(bs, '2027-01-01')).toBe(-1)
  })
})
