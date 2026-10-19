import { describe, expect, it } from 'vitest'
import { changeBasisPoints, formatDecimal, formatEUR, parseAmountInput, shareBasisPoints, toCents } from './money'

describe('toCents', () => {
  it('convierte importes decimales sin errores de coma flotante', () => {
    expect(toCents(0.1 + 0.2)).toEqual({ cents: 30, exact: true })
    expect(toCents(19.99)).toEqual({ cents: 1999, exact: true })
    expect(toCents(1.005)).toEqual({ cents: 101, exact: false })
    expect(toCents(-4.2)).toEqual({ cents: -420, exact: true })
    expect(toCents(0)).toEqual({ cents: 0, exact: true })
    expect(toCents(-0)).toEqual({ cents: 0, exact: true })
  })

  it('marca los importes con más de dos decimales', () => {
    expect(toCents(12.345)?.exact).toBe(false)
  })

  it('rechaza valores que no son importes', () => {
    expect(toCents(null)).toBeNull()
    expect(toCents(undefined)).toBeNull()
    expect(toCents(Number.NaN)).toBeNull()
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull()
    expect(toCents(1e20)).toBeNull()
  })

  it('sumar céntimos es exacto donde los flotantes no lo son', () => {
    const values = Array.from({ length: 1000 }, () => 0.1)
    const floatSum = values.reduce((a, b) => a + b, 0)
    const centSum = values.reduce((a, b) => a + toCents(b)!.cents, 0)
    expect(floatSum).not.toBe(100)
    expect(centSum).toBe(10000)
  })
})

describe('formato español', () => {
  it('formatea moneda con coma decimal, punto de miles y euro detrás', () => {
    expect(formatEUR(123456).replace(/\s/g, ' ')).toBe('1.234,56 €')
    expect(formatEUR(5).replace(/\s/g, ' ')).toBe('0,05 €')
    expect(formatEUR(-1050).replace(/\s/g, ' ')).toBe('−10,50 €')
    expect(formatEUR(1050, { signed: true }).replace(/\s/g, ' ')).toBe('+10,50 €')
    expect(formatEUR(123456789).replace(/\s/g, ' ')).toBe('1.234.567,89 €')
  })

  it('formatea decimales para CSV sin separador de miles', () => {
    expect(formatDecimal(123456)).toBe('1234,56')
    expect(formatDecimal(-5)).toBe('-0,05')
    expect(formatDecimal(0)).toBe('0,00')
  })
})

describe('parseAmountInput', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50 €', 1250],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['0,99', 99],
  ])('«%s» → %i céntimos', (input, cents) => {
    expect(parseAmountInput(input)).toBe(cents)
  })

  it.each(['', 'abc', '12,345', '1,2,3', '-5', '12.3.4'])('rechaza «%s»', (input) => {
    expect(parseAmountInput(input)).toBeNull()
  })
})

describe('porcentajes', () => {
  it('calcula la parte en puntos básicos solo con base positiva', () => {
    expect(shareBasisPoints(2500, 10000)).toBe(2500)
    expect(shareBasisPoints(1, 3)).toBe(3333)
    expect(shareBasisPoints(100, 0)).toBeNull()
    expect(shareBasisPoints(-100, 1000)).toBeNull()
  })

  it('no calcula variaciones sin periodo anterior con datos', () => {
    expect(changeBasisPoints(1500, 1000)).toBe(5000)
    expect(changeBasisPoints(500, 1000)).toBe(-5000)
    expect(changeBasisPoints(500, 0)).toBeNull()
  })
})
