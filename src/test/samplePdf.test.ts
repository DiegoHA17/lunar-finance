/**
 * Utilidad de desarrollo: genera informes PDF de muestra con los datos de DEMOSTRACIÓN, en cada estilo, para
 * revisarlos a ojo. Solo se ejecuta con la variable LUNAR_SAMPLE_PDF (carpeta de salida).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { CategoryIndex } from '../domain/categories'
import { today } from '../domain/dates'
import { PDF_THEMES } from '../domain/pdf/theme'
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
  const logo = new Uint8Array(readFileSync(new URL('../assets/brand/lunar-logo-64.png', import.meta.url)))
  for (const theme of Object.values(PDF_THEMES)) {
    for (const [name, period, detail] of [
      ['resumen-mes', month, 'summary'],
      ['detalle-mes', month, 'full'],
      ['resumen-anio', periodContaining('year', today()), 'summary'],
    ] as const) {
      const bytes = await renderReportPdf(buildReport(data.movements, index, period, detail, ctx), index, logo, theme)
      writeFileSync(join(out!, `${theme.style}-${name}.pdf`), bytes)
    }
  }
})
