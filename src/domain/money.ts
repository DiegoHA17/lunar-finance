/**
 * Importes monetarios en céntimos enteros. Toda la aritmética financiera de Lunar se hace con enteros; la única
 * conversión desde coma flotante (el `number` de Notion) ocurre en {@link toCents}.
 */

export type Cents = number

export interface CentsConversion {
  cents: Cents
  /** `false` si el valor tenía más de dos decimales y se ha redondeado. */
  exact: boolean
}

/** Convierte un importe en euros (coma flotante) a céntimos. Devuelve `null` si no es un número válido. */
export function toCents(value: number | null | undefined): CentsConversion | null {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) return null
  if (Math.abs(value) >= 1e13) return null
  // Se trabaja sobre la representación decimal con 15 cifras significativas: elimina el ruido binario
  // (0,1 + 0,2 → «0.3»; 1,005 → «1.005», no 1,00499…) y permite redondear al céntimo en decimal exacto.
  const text = Number(value.toPrecision(15)).toString()
  if (/e/i.test(text)) {
    // Solo ocurre con magnitudes diminutas (< 1e-6): no llegan a medio céntimo.
    return { cents: 0, exact: value === 0 }
  }
  const negative = text.startsWith('-')
  const [intPart, fracPart = ''] = text.replace('-', '').split('.')
  let cents = Number(intPart) * 100 + Number(`${fracPart}00`.slice(0, 2))
  const rest = fracPart.slice(2)
  // Redondeo «mitad hacia fuera del cero», el habitual en importes.
  if (rest !== '' && rest[0] >= '5') cents += 1
  if (!Number.isSafeInteger(cents)) return null
  const signed = negative && cents !== 0 ? -cents : cents
  return { cents: signed, exact: rest === '' }
}

/** Euros (para escribir en Notion) a partir de céntimos. */
export function centsToNumber(cents: Cents): number {
  return cents / 100
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const eurGrouped = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
})
const plain = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

/**
 * Formato de moneda español: `1.234,56 €`. Se fuerza la agrupación también en cifras de cuatro dígitos para que
 * las columnas de importes se alineen visualmente.
 */
export function formatEUR(cents: Cents, opts: { signed?: boolean; grouped?: boolean } = {}): string {
  const fmt = opts.grouped === false ? eur : eurGrouped
  const text = fmt.format(cents / 100)
  if (opts.signed && cents > 0) return `+${text}`
  return text.replace('-', '−')
}

/** Número con coma decimal sin separador de miles (para CSV): `-1234,50`. */
export function formatDecimal(cents: Cents): string {
  return plain.format(cents / 100).replace('−', '-')
}

/**
 * Interpreta un importe escrito por el usuario: «12,5», «1.234,56», «1234.56», «12 €». Devuelve céntimos
 * positivos o `null` si el texto no es un importe inequívoco.
 */
export function parseAmountInput(input: string): Cents | null {
  let s = input.trim().replace(/€/g, '').replace(/\s+/g, '')
  if (s === '' || /[^\d.,]/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal; el otro, de miles.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) ?? []).length > 1) return null
    s = s.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    // «1.234» con exactamente 3 dígitos tras el único punto es ambiguo en España: se interpreta como miles.
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return null
      s = parts.join('')
    } else if (parts[1].length === 3) {
      s = parts.join('')
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const conv = toCents(Number(s))
  return conv && conv.exact ? conv.cents : null
}

/** Porcentaje en puntos básicos (1 % = 100) con redondeo entero; `null` si la base no es positiva. */
export function shareBasisPoints(part: Cents, total: Cents): number | null {
  if (total <= 0 || part < 0) return null
  return Math.round((part * 10000) / total)
}

const pct = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatBasisPoints(bp: number): string {
  return `${pct.format(bp / 100)} %`
}

/** Variación relativa en puntos básicos; `null` si no hay base para compararla. */
export function changeBasisPoints(current: Cents, previous: Cents): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) * 10000) / previous)
}
