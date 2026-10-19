import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderReportPdf } from '../infra/pdfRender'
import { blocking, cat, index, mov, withCategory } from '../test/factories'
import { addDays } from './dates'
import { formatEUR } from './money'
import { type LaidOutPage, type Measure, PAGE, layoutReport } from './pdf/layout'
import { toWinAnsi } from './pdf/text'
import { customPeriod, monthPeriod, yearPeriod } from './periods'
import { buildReport } from './report'
import { summarize } from './stats'
import type { Movement } from './types'

const cats = [cat('Alimentación'), cat('Ocio'), cat('Transporte'), cat('Vivienda'), cat('Nómina', { kind: 'income' })]
const idx = index(cats)
const ctx = { demo: false, dataComplete: true, lastSyncAt: '2026-10-19T08:00:00Z' }

let measure: Measure
beforeAll(async () => {
  const doc = await PDFDocument.create()
  const r = await doc.embedFont(StandardFonts.Helvetica)
  const b = await doc.embedFont(StandardFonts.HelveticaBold)
  measure = { width: (t, s, bold) => (bold ? b : r).widthOfTextAtSize(t, s) }
})

/** Año sintético: ~1,3 movimientos por día con importes con céntimos. */
function syntheticYear(year: number): Movement[] {
  const out: Movement[] = []
  let day = `${year}-01-01`
  let i = 0
  while (day <= `${year}-12-31`) {
    const c = cats[i % 4]
    out.push(withCategory(mov({ description: `Compra ${i} en comercio con un nombre bastante largo para recortar`, euros: ((i * 37) % 9000) / 100 + 0.01, date: day }), c))
    if (day.endsWith('-28')) out.push(withCategory(mov({ description: 'Nómina', euros: 1850.55, kind: 'income', date: day }), cats[4]))
    if (i % 3 === 0) out.push(withCategory(mov({ description: 'Devolución', euros: 1.1, kind: 'refund', date: day }), c))
    day = addDays(day, 1)
    i++
  }
  out.push(mov({ description: 'Sin importe', amountCents: null, issues: [blocking()], date: `${year}-06-01` }))
  return out
}

function texts(page: LaidOutPage): string[] {
  return page.ops.flatMap((o) => (o.t === 'text' ? [o.text] : []))
}

describe('informe y PDF', () => {
  const all = syntheticYear(2026)
  const period = yearPeriod(2026)

  it('el informe usa exactamente las cifras del dashboard', () => {
    const report = buildReport(all, idx, period, 'full', ctx)
    expect(report.summary.totals).toEqual(summarize(all, idx, period).totals)
    expect(report.summary.expenseByCategory).toEqual(summarize(all, idx, period).expenseByCategory)
  })

  it('el PDF muestra los mismos totales que el dashboard', () => {
    const report = buildReport(all, idx, period, 'full', ctx)
    const t = summarize(all, idx, period).totals
    const pages = layoutReport(report, idx, measure)
    const first = texts(pages[0])
    expect(first).toContain(toWinAnsi(formatEUR(t.incomeCents)))
    expect(first).toContain(toWinAnsi(formatEUR(t.netExpenseCents)))
    expect(first).toContain(toWinAnsi(formatEUR(t.balanceCents)))
    const allTexts = pages.flatMap(texts)
    expect(allTexts).toContain(toWinAnsi(formatEUR(t.balanceCents, { signed: true })))
  })

  it('pagina con cabecera, pie y «Página X de N» en todas las páginas', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'full', ctx), idx, measure)
    expect(pages.length).toBeGreaterThan(10)
    pages.forEach((p, i) => {
      expect(texts(p)).toContain(`Página ${i + 1} de ${pages.length}`)
      expect(texts(p)).toContain('Lunar')
    })
  })

  it('ningún elemento de contenido invade el pie ni se sale de la página', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'full', ctx), idx, measure)
    for (const p of pages) {
      for (const o of p.ops) {
        if (o.t === 'text' && /^Página \d+ de \d+$/.test(o.text)) continue
        const bottom = o.t === 'rect' ? o.y + o.h : o.t === 'line' ? Math.max(o.y1, o.y2) : o.t === 'circle' ? o.y + o.r : o.y
        const top = o.t === 'line' ? Math.min(o.y1, o.y2) : o.y
        const isFooter = top >= PAGE.height - 50
        if (!isFooter) expect(bottom).toBeLessThanOrEqual(PAGE.height - PAGE.bottom + 0.01)
        if (o.t === 'text') {
          const w = measure.width(o.text, o.size, o.bold)
          const left = o.align === 'right' ? o.x - w : o.align === 'center' ? o.x - w / 2 : o.x
          expect(left).toBeGreaterThanOrEqual(PAGE.marginX - 0.5)
          expect(left + w).toBeLessThanOrEqual(PAGE.width - PAGE.marginX + 0.5)
        }
      }
    }
  })

  it('las filas de totales nunca quedan solas al principio de una página', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'full', ctx), idx, measure)
    for (const label of ['Balance del periodo', 'Total gasto neto', 'Total ingresos']) {
      const pageIdx = pages.findIndex((p) => texts(p).includes(label))
      expect(pageIdx).toBeGreaterThanOrEqual(0)
      const page = pages[pageIdx]
      const totalOp = page.ops.find((o) => o.t === 'text' && o.text === label) as Extract<(typeof page.ops)[number], { t: 'text' }>
      // Debe haber al menos una fila de datos (zebra o texto) por encima en la misma página, después de la cabecera.
      const rowsAbove = page.ops.filter((o) => o.t === 'text' && o.y < totalOp.y && o.y > PAGE.top + 10 && o.size === 8.5)
      expect(rowsAbove.length).toBeGreaterThan(0)
    }
  })

  it('repite la cabecera de la tabla de movimientos en cada página', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'full', ctx), idx, measure)
    const withRows = pages.filter((p) => texts(p).some((t) => /^\d{2}\/\d{2}\/2026$/.test(t)))
    for (const p of withRows) expect(texts(p)).toContain('DESCRIPCIÓN')
  })

  it('el resumen ejecutivo no incluye el listado de movimientos', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'summary', ctx), idx, measure)
    expect(pages.length).toBeLessThanOrEqual(2)
    expect(pages.flatMap(texts)).not.toContain('Balance del periodo')
  })

  it('un periodo sin movimientos genera un informe válido que lo dice', () => {
    const pages = layoutReport(buildReport(all, idx, monthPeriod(2030, 1), 'full', ctx), idx, measure)
    expect(pages.flatMap(texts)).toContain('No hay movimientos en este periodo.')
  })

  it('un intervalo que cruza el cambio de año suma ambos lados', () => {
    const p = customPeriod('2026-12-15', '2027-01-15')
    const list = [mov({ euros: 10, date: '2026-12-31' }), mov({ euros: 20, date: '2027-01-01' }), mov({ euros: 99, date: '2027-01-16' })]
    expect(buildReport(list, idx, p, 'full', ctx).summary.totals.expenseCents).toBe(3000)
  })

  it('marca los informes de demostración en todas las páginas', () => {
    const pages = layoutReport(buildReport(all, idx, period, 'full', { ...ctx, demo: true }), idx, measure)
    for (const p of pages) expect(texts(p).some((t) => t.includes('DATOS DE DEMOSTRACIÓN'))).toBe(true)
  })

  it('genera un PDF válido con el mismo número de páginas que la maquetación', async () => {
    const report = buildReport(all, idx, period, 'full', ctx)
    const bytes = await renderReportPdf(report, idx)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(layoutReport(report, idx, measure).length)
    expect(loaded.getTitle()).toContain('2026')
  })

  it('soporta descripciones con emojis y caracteres fuera de WinAnsi', async () => {
    const list = [mov({ description: '🍕 Pizza ñandú «€» — ✓ 日本', euros: 12, date: '2026-10-01' })]
    const report = buildReport(list, idx, monthPeriod(2026, 10), 'full', ctx)
    await expect(renderReportPdf(report, idx)).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('texto WinAnsi', () => {
  it('conserva el español y sustituye lo irrepresentable', () => {
    expect(toWinAnsi('Ñoño «café» 12,50 € ¿sí?')).toBe('Ñoño «café» 12,50 € ¿sí?')
    expect(toWinAnsi('🍕 Pizza')).toBe('Pizza')
    expect(toWinAnsi('−10 €')).toBe('-10 €')
    expect(toWinAnsi('日本')).toBe('??')
    expect(toWinAnsi('a\nb')).toBe('a b')
  })
})
