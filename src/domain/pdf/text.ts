/**
 * Las fuentes estándar de PDF (Helvetica) usan la codificación WinAnsi: cubren el español completo (á, ñ, ü, ¿, ¡,
 * €, «») pero no emojis ni algunos símbolos tipográficos. Este módulo adapta el texto antes de medirlo y dibujarlo.
 */

const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

const REPLACEMENTS: Record<string, string> = {
  '−': '-', // signo menos
  ' ': ' ', // espacio fino de no separación
  ' ': ' ',
  ' ': ' ',
  '​': '',
  '⁠': '',
  '←': '<-',
  '→': '->',
  '≤': '<=',
  '≥': '>=',
}

function encodable(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(ch)
}

/** Devuelve un texto dibujable con Helvetica: sustituye equivalentes, elimina emojis y marca lo irrepresentable con «?». */
export function toWinAnsi(input: string): string {
  let out = ''
  const normalized = input.normalize('NFC').replace(/[\r\n\t]+/g, ' ')
  for (const ch of normalized) {
    if (ch in REPLACEMENTS) out += REPLACEMENTS[ch]
    else if (encodable(ch)) out += ch
    else if (/\p{Extended_Pictographic}|\p{M}|[︀-️‍]/u.test(ch)) continue
    else out += '?'
  }
  return out.replace(/ {2,}/g, ' ').trim()
}
