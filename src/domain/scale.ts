/** Tope «redondo» para el eje: 1, 2, 2,5 o 5 × 10ⁿ euros. */
export function niceCeil(cents: number): number {
  if (cents <= 0) return 0
  const euros = cents / 100
  const mag = 10 ** Math.floor(Math.log10(euros))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= euros)!
  return Math.round(step * mag * 100)
}
