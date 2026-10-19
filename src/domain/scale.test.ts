import { describe, expect, it } from 'vitest'
import { formatTick, niceScale } from './scale'

describe('escala de los ejes', () => {
  it('cada etiqueta corresponde exactamente al valor de su línea', () => {
    const s = niceScale(0, 250000) // máximo 2.500 €
    for (const t of s.ticks) expect(formatTick(t, s.step)).toBe(`${new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(t / 100)} €`)
    expect(s.ticks.map((t) => formatTick(t, s.step))).not.toContain('1,3 mil €')
  })

  it('usa pasos de 1, 2 o 5 × 10ⁿ y cubre los datos', () => {
    expect(niceScale(0, 125000)).toEqual({ min: 0, max: 150000, step: 50000, ticks: [0, 50000, 100000, 150000] })
    expect(niceScale(0, 72100)).toMatchObject({ min: 0, max: 80000, step: 20000 })
    for (const [lo, hi] of [
      [0, 1],
      [0, 49],
      [0, 999999],
      [-1599, 72100],
      [-5000, 0],
    ]) {
      const s = niceScale(lo, hi)
      expect(s.min).toBeLessThanOrEqual(Math.min(0, lo))
      expect(s.max).toBeGreaterThanOrEqual(hi)
      expect(s.ticks).toContain(0)
      expect([1, 2, 5].includes(Number(String(s.step).replace(/0+$/, '') || '1'))).toBe(true)
      expect(s.ticks.length).toBeLessThanOrEqual(7)
    }
  })

  it('con importes negativos las marcas quedan equidistantes (sin etiquetas pegadas al cero)', () => {
    const s = niceScale(-1599, 72100)
    expect(s.ticks).toEqual([-20000, 0, 20000, 40000, 60000, 80000])
  })

  it('importes pequeños muestran decimales exactos', () => {
    const s = niceScale(0, 49) // 0,49 €
    expect(s.ticks.map((t) => formatTick(t, s.step))).toEqual(['0,0 €', '0,2 €', '0,4 €', '0,6 €'])
    const c = niceScale(0, 7)
    expect(formatTick(c.ticks[1], c.step)).toBe('0,02 €')
  })

  it('sin datos devuelve una escala válida', () => {
    expect(niceScale(0, 0).ticks).toEqual([0, 50, 100])
  })

  it('formatea negativos con signo menos y miles con punto', () => {
    expect(formatTick(-20000, 20000)).toBe('−200 €')
    expect(formatTick(1000000, 500000)).toBe('10.000 €')
  })
})
