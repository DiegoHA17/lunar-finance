/**
 * Modelo de informe. Se construye con {@link summarize} (las mismas cifras que el dashboard) y es lo único que
 * consume el generador de PDF.
 */

import type { CategoryIndex } from './categories'
import { formatDateShort, formatInstant, today } from './dates'
import { type Period, periodLabel, periodSlug } from './periods'
import { type Comparison, type Summary, compareWithPrevious, summarize } from './stats'
import type { Movement } from './types'

export type ReportDetail = 'summary' | 'full'

export interface ReportContext {
  /** Datos de demostración: el informe lo indica en todas las páginas. */
  demo: boolean
  /** Notion devolvió todos los resultados. */
  dataComplete: boolean
  lastSyncAt: string | null
}

export interface ReportModel {
  title: string
  periodLabel: string
  period: Period
  detail: ReportDetail
  generatedAt: string
  summary: Summary
  comparison: Comparison | null
  notes: string[]
  demo: boolean
  fileName: string
}

export function buildReport(all: Movement[], categories: CategoryIndex, period: Period, detail: ReportDetail, ctx: ReportContext, now = new Date()): ReportModel {
  const summary = summarize(all, categories, period)
  const comparison = compareWithPrevious(all, period, today(now))
  const notes: string[] = []
  if (ctx.demo) notes.push('Informe generado con datos de demostración ficticios. No refleja información financiera real.')
  if (!ctx.dataComplete) notes.push('Notion indicó que la consulta no devolvió todos los registros (límite de 10 000 filas). Las cifras pueden estar incompletas.')
  if (summary.excluded.length > 0) {
    notes.push(
      `${summary.excluded.length} movimiento(s) del periodo no se incluyen en los totales por tener datos incompletos o inválidos (se detallan al final).`,
    )
  }
  if (summary.uncategorizedCount > 0) notes.push(`${summary.uncategorizedCount} movimiento(s) están sin categoría y se agrupan como «Sin categoría».`)
  if (summary.unknownCategoryCount > 0) notes.push(`${summary.unknownCategoryCount} movimiento(s) tienen una categoría que no está en el catálogo.`)
  if (comparison?.partial) {
    notes.push(
      `El periodo está en curso: la comparación usa del ${formatDateShort(comparison.currentRange.start)} al ${formatDateShort(comparison.currentRange.end)} frente al mismo número de días del periodo anterior.`,
    )
  }
  if (summary.totals.transferCount > 0) notes.push('Las transferencias internas no se cuentan como gasto ni como ingreso.')
  notes.push('El balance es ingresos menos gasto neto del periodo; no equivale al saldo de ninguna cuenta bancaria.')
  if (ctx.lastSyncAt) notes.push(ctx.demo ? `Datos de demostración generados el ${formatInstant(ctx.lastSyncAt)}.` : `Datos leídos de Notion el ${formatInstant(ctx.lastSyncAt)}.`)

  return {
    title: detail === 'full' ? 'Informe detallado' : 'Resumen financiero',
    periodLabel: periodLabel(period),
    period,
    detail,
    generatedAt: now.toISOString(),
    summary,
    comparison,
    notes,
    demo: ctx.demo,
    fileName: `Lunar ${detail === 'full' ? 'informe' : 'resumen'} ${periodSlug(period)}${ctx.demo ? ' (demo)' : ''}`,
  }
}
