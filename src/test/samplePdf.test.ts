/**
 * Utilidad de desarrollo: genera informes PDF de muestra con los datos de DEMOSTRACIÓN para revisarlos a ojo.
 * Solo se ejecuta con `npm run sample:pdf` (variable LUNAR_SAMPLE_PDF con la carpeta de salida).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { today } from '../domain/dates'
import { periodContaining, previousPeriod } from '../domain/periods'
import { buildReport } from '../domain/report'
import { DemoBackend } from '../infra/demo'
import { renderReportPdf } from '../infra/pdfRender'
import { loadAll } from '../services/sync'

const out = process.env.LUNAR_SAMPLE_PDF

it.skipIf(!out)('genera PDF de muestra', async () => {
  const backend = new DemoBackend(0)
  const data = await loadAll(backend, await backend.getConfig())
  const index = new CategoryIndex(data.categories)
  const ctx = { demo: true, dataComplete: true, lastSyncAt: data.fetchedAt }
  mkdirSync(out!, { recursive: true })
  const month = previousPeriod(periodContaining('month', today()))
  for (const [name, period, detail] of [
    ['resumen-mes', month, 'summary'],
    ['detalle-mes', month, 'full'],
    ['resumen-anio', periodContaining('year', today()), 'summary'],
  ] as const) {
    const logo = new Uint8Array(readFileSync(new URL('../assets/brand/lunar-logo-64.png', import.meta.url)))
    const bytes = await renderReportPdf(buildReport(data.movements, index, period, detail, ctx), index, logo)
    writeFileSync(join(out!, `${name}.pdf`), bytes)
  }
})
