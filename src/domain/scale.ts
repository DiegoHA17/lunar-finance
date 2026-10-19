/**
 * Escala de los ejes de importes, compartida por el panel y el PDF. Las marcas son múltiplos de 1, 2 o 5 × 10ⁿ
 * céntimos, de modo que cada etiqueta representa exactamente el valor de su línea (nada de «1,3 mil €» para 1.250 €).
 */

export interface Scale {
  min: number
  max: number
  step: number
  ticks: number[]
}

/** Escala «bonita» que incluye el cero y los valores dados, con unas `target` divisiones. */
export function niceScale(minValue: number, maxValue: number, target = 4): Scale {
  const lo = Math.min(0, minValue)
  const hi = Math.max(0, maxValue)
  if (lo === hi) return { min: 0, max: 100, step: 50, ticks: [0, 50, 100] }
  const raw = (hi - lo) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const unit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = Math.max(1, Math.round(unit * mag))
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = min; v <= max; v += step) ticks.push(v === 0 ? 0 : v)
  return { min, max, step, ticks }
}

/** Etiqueta exacta de una marca: sin decimales si el paso es de euros enteros. */
export function formatTick(cents: number, step: number): string {
  const decimals = step % 100 === 0 ? 0 : step % 10 === 0 ? 1 : 2
  const text = new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: 'always' }).format(cents / 100)
  return `${text.replace('-', '−')} €`
}
