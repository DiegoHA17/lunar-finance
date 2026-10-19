/** Exportación de informes (PDF) y movimientos (CSV). */

import type { CategoryIndex } from '../domain/categories'
import { movementsToCsv } from '../domain/csv'
import type { ReportModel } from '../domain/report'
import type { Movement } from '../domain/types'
import type { Host } from '../infra/backend'
import { LunarError } from '../infra/contracts'
import { renderReportPdf } from '../infra/pdfRender'

export async function exportReportPdf(host: Host, model: ReportModel, index: CategoryIndex): Promise<string | null> {
  let bytes: Uint8Array
  try {
    bytes = await renderReportPdf(model, index)
  } catch (e) {
    throw new LunarError({ code: 'internal', message: 'No se pudo generar el PDF.', detail: e instanceof Error ? e.message : String(e) })
  }
  return host.exportFile(model.fileName, 'pdf', bytes)
}

export async function exportCsv(host: Host, list: Movement[], index: CategoryIndex, name: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(movementsToCsv(list, index))
  return host.exportFile(name, 'csv', bytes)
}
