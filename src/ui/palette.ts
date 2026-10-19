/**
 * Colores de categoría. Son muestras de identidad secundaria: siempre aparecen junto al nombre de la categoría,
 * nunca como único indicador (los gráficos usan una sola serie en el color de acento).
 */

export interface Swatch {
  key: string
  label: string
  light: string
  dark: string
}

export const SWATCHES: Swatch[] = [
  { key: 'moon', label: 'Azul lunar', light: '#3f6a94', dark: '#8fb2d6' },
  { key: 'sky', label: 'Cielo', light: '#2f86c4', dark: '#6eb0e0' },
  { key: 'indigo', label: 'Índigo', light: '#4a57b8', dark: '#8c97e0' },
  { key: 'violet', label: 'Violeta', light: '#7a5cc8', dark: '#a995e6' },
  { key: 'rose', label: 'Rosa', light: '#c4527a', dark: '#e48ea9' },
  { key: 'amber', label: 'Ámbar', light: '#c27f12', dark: '#e0aa4f' },
  { key: 'ochre', label: 'Ocre', light: '#94692a', dark: '#c7a06a' },
  { key: 'sage', label: 'Salvia', light: '#3e8a5c', dark: '#7cc096' },
  { key: 'teal', label: 'Verde azulado', light: '#16857f', dark: '#5cbcb5' },
  { key: 'cyan', label: 'Turquesa', light: '#1f8fae', dark: '#62bdd6' },
  { key: 'slate', label: 'Pizarra', light: '#5b677a', dark: '#97a3b6' },
  { key: 'stone', label: 'Piedra', light: '#857f74', dark: '#ada79b' },
]

const byKey = new Map(SWATCHES.map((s) => [s.key, s]))

/** Color CSS que se adapta al tema (`light-dark()` sigue a `color-scheme`). */
export function swatchColor(key: string): string {
  if (key === 'none') return 'transparent'
  const s = byKey.get(key) ?? (key.startsWith('#') ? { light: key, dark: key } : byKey.get('stone')!)
  return `light-dark(${s.light}, ${s.dark})`
}
