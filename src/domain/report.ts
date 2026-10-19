/**
 * Modelo de informe. Se construye con {@link summarize} (las mismas cifras que el dashboard) y es lo único que
 * consume el generador de PDF.
 */

import type { CategoryIndex } from './categories'
import { today } from './dates'
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
  /** Solo avisos que afectan a la validez de las cifras (p. ej. consulta incompleta). Sin notas explicativas. */
  warnings: string[]
  demo: boolean
  fileName: string
}

export function buildReport(all: Movement[], categories: CategoryIndex, period: Period, detail: ReportDetail, ctx: ReportContext, now = new Date()): ReportModel {
  const summary = summarize(all, categories, period)
  const comparison = compareWithPrevious(all, period, today(now))
  const warnings: string[] = []
  if (!ctx.dataComplete) warnings.push('Notion no devolvió todos los registros: las cifras pueden estar incompletas.')

  return {
    title: detail === 'full' ? 'Informe detallado' : 'Resumen financiero',
    periodLabel: periodLabel(period),
    period,
    detail,
    generatedAt: now.toISOString(),
    summary,
    comparison,
    warnings,
    demo: ctx.demo,
    fileName: `Lunar Finance ${detail === 'full' ? 'informe' : 'resumen'} ${periodSlug(period)}${ctx.demo ? ' (demo)' : ''}`,
  }
}
