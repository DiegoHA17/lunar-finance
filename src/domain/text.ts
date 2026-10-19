/** Normalización de texto para comparar nombres y aplicar reglas. */

/** Minúsculas, sin acentos ni diacríticos, espacios colapsados. «  Café  CON   Leche » → «cafe con leche». */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Como {@link normalizeText} pero conserva los acentos (para reglas que distinguen «año» de «ano»). */
export function normalizeKeepAccents(input: string | null | undefined): string {
  if (!input) return ''
  return input.normalize('NFC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim()
}

/** Palabras (letras y números) de un texto ya normalizado. */
export function words(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Clave para detectar nombres duplicados: sin acentos, sin signos, sin espacios repetidos. */
export function nameKey(input: string | null | undefined): string {
  return words(normalizeText(input)).join(' ')
}
