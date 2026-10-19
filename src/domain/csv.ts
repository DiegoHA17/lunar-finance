/**
 * Exportación CSV para hojas de cálculo en configuración española (Excel, LibreOffice, Numbers):
 *   - UTF-8 con BOM (Excel detecta así la codificación y muestra bien los acentos y el «€»),
 *   - separador «;», coma decimal, fechas dd/mm/aaaa, fin de línea CRLF,
 *   - protección contra inyección de fórmulas en los campos de texto (OWASP «CSV Injection»).
 *
 * La columna «Importe con signo» suma exactamente el balance del dashboard para el mismo conjunto de movimientos.
 */

import type { CategoryIndex } from './categories'
import { formatDateES } from './dates'
import { formatDecimal } from './money'
import { categoryKeyOf, signedCents } from './stats'
import { KIND_LABEL, type Movement, isCounted } from './types'

export const CSV_HEADERS = ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Método de pago', 'Importe', 'Importe con signo', 'Incluido en totales', 'Observaciones']

const FORMULA_TRIGGERS = /^[=+\-@\t\r＝＋－＠]/

/** Neutraliza texto que una hoja de cálculo interpretaría como fórmula anteponiendo un apóstrofo. */
export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGERS.test(value) ? `'${value}` : value
}

/** Entrecomilla si hace falta (separador, comillas, saltos de línea o espacios en los extremos). */
export function quoteField(value: string): string {
  if (/[;"\r\n]/.test(value) || value !== value.trim()) return `"${value.replace(/"/g, '""')}"`
  return value
}

function textCell(value: string | null | undefined): string {
  return quoteField(neutralizeFormula((value ?? '').replace(/\r\n?/g, '\n')))
}

/** Las celdas numéricas se generan aquí (nunca vienen del usuario), así que no necesitan neutralizarse. */
function numberCell(value: string): string {
  return quoteField(value)
}

export function movementsToCsv(list: Movement[], categories: CategoryIndex): string {
  const rows: string[] = [CSV_HEADERS.map(quoteField).join(';')]
  for (const m of list) {
    const signed = signedCents(m)
    const category = categoryKeyOf(m, categories)
    const kind = m.kind ? KIND_LABEL[m.kind] : (m.rawKind ?? '')
    rows.push(
      [
        m.date ? formatDateES(m.date) : '',
        textCell(m.description),
        textCell(category.status === 'none' ? '' : category.name),
        textCell(kind),
        textCell(m.paymentMethod),
        m.amountCents === null ? '' : numberCell(formatDecimal(m.amountCents)),
        signed === null ? '' : numberCell(formatDecimal(signed)),
        isCounted(m) ? 'Sí' : 'No',
        textCell(m.issues.map((i) => i.message).join(' ')),
      ].join(';'),
    )
  }
  return `﻿${rows.join('\r\n')}\r\n`
}

/** Analizador mínimo del formato generado (para pruebas de ida y vuelta). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\r' && src[i + 1] === '\n') {
      row.push(field)
      out.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    out.push(row)
  }
  return out
}

/** «-1234,50» → -123450 céntimos. */
export function parseDecimalCell(cell: string): number | null {
  if (!cell) return null
  const n = Number(cell.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
