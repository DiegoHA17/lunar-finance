import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderReportPdf } from '../infra/pdfRender'
import { blocking, cat, index, mov, withCategory } from '../test/factories'
import { addDays } from './dates'
import { formatEUR } from './money'
import { type LaidOutPage, type Measure, PAGE, layoutReport } from './pdf/layout'
import { toWinAnsi } from './pdf/text'
import { customPeriod, monthPeriod, quarterPeriod, yearPeriod } from './periods'
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
      expect(texts(p)).toContain('Lunar Finance')
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
    expect(pages.flatMap(texts)).toContain('Sin movimientos en este periodo.')
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

describe('gráfica y estructura del PDF', () => {
  const oct = monthPeriod(2026, 10)
  const known = [
    withCategory(mov({ euros: 400, date: '2026-10-01' }), cats[0]),
    withCategory(mov({ euros: 100, date: '2026-10-02' }), cats[1]),
    withCategory(mov({ euros: 10, date: '2026-10-03' }), cats[1]),
    withCategory(mov({ euros: 30, kind: 'refund', date: '2026-10-03' }), cats[1]), // neto del día 3: −20 €
    withCategory(mov({ euros: 1500, kind: 'income', date: '2026-10-28' }), cats[4]),
  ]

  function chartOps(pages: LaidOutPage[]) {
    const page = pages.find((p) => texts(p).some((t) => t.startsWith('Evolución')))!
    const rects = page.ops.filter((o): o is Extract<typeof o, { t: 'rect' }> => o.t === 'rect' && o.w <= 22 && o.h < 140 && o.h > 0 && o.h !== 6)
    const labels = page.ops.filter((o): o is Extract<typeof o, { t: 'text' }> => o.t === 'text' && o.size === 6.5 && o.text.endsWith('€')).map((o) => o.text)
    return { rects, labels }
  }

  it('las etiquetas del eje son exactas y las barras proporcionales a los datos conocidos', () => {
    const pages = layoutReport(buildReport(known, idx, oct, 'summary', ctx), idx, measure)
    const { rects, labels } = chartOps(pages)
    expect(labels).toEqual(['-200 €', '0 €', '200 €', '400 €'])
    const h = rects.map((r) => r.h)
    expect(rects).toHaveLength(3)
    // 400 € : 100 € : 20 € (devoluciones > gastos el día 3 → barra por debajo del cero)
    expect(h[0] / h[1]).toBeCloseTo(4, 1)
    expect(h[1] / h[2]).toBeCloseTo(5, 1)
    expect(rects[2].color).not.toEqual(rects[0].color)
  })

  it('la gráfica y las tablas representan el mismo conjunto de datos', () => {
    const s = summarize(known, idx, oct)
    const chartSum = s.timeline.points.reduce((a, p) => a + p.netExpenseCents, 0)
    const tableSum = s.expenseByCategory.reduce((a, r) => a + r.netCents, 0)
    expect(chartSum).toBe(s.totals.netExpenseCents)
    expect(tableSum).toBe(s.totals.netExpenseCents)
    expect(s.totals.netExpenseCents).toBe(48000)
  })

  it('no incluye notas ni explicaciones; orden: totales, gráfica, categorías, movimientos', () => {
    const pages = layoutReport(buildReport(known, idx, oct, 'full', ctx), idx, measure)
    const all = pages.flatMap(texts)
    expect(all).not.toContain('Notas')
    expect(all.some((t) => /no equivale al saldo|transferencias internas|se agrupan como/.test(t))).toBe(false)
    const at = (pred: (t: string) => boolean) => all.findIndex(pred)
    const order = [at((t) => t === 'GASTO NETO'), at((t) => t.startsWith('Evolución')), at((t) => t === 'Gasto por categoría'), at((t) => t.startsWith('Movimientos ('))]
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('las exclusiones se listan con un motivo breve sin recortar', () => {
    const list = [...known, mov({ description: 'Hucha', kind: null, rawKind: 'Ahorro', issues: [{ code: 'unknown_kind', message: 'x', blocking: true }], date: '2026-10-05' })]
    const all = layoutReport(buildReport(list, idx, oct, 'summary', ctx), idx, measure).flatMap(texts)
    expect(all).toContain('Tipo «Ahorro» sin asignar')
  })

  it('cambios de mes, trimestre y año: el informe solo incluye su periodo', () => {
    const list = [mov({ euros: 1, date: '2026-03-31' }), mov({ euros: 2, date: '2026-04-01' }), mov({ euros: 4, date: '2026-12-31' }), mov({ euros: 8, date: '2027-01-01' })]
    expect(buildReport(list, idx, monthPeriod(2026, 3), 'full', ctx).summary.totals.expenseCents).toBe(100)
    expect(buildReport(list, idx, quarterPeriod(2026, 2), 'full', ctx).summary.totals.expenseCents).toBe(200)
    expect(buildReport(list, idx, yearPeriod(2026), 'full', ctx).summary.totals.expenseCents).toBe(700)
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

describe('logotipo en el PDF', () => {
  it('incrusta el logotipo oficial si se proporciona y omite la luna de reserva', async () => {
    const { readFileSync } = await import('node:fs')
    const logo = new Uint8Array(readFileSync(new URL('../assets/brand/lunar-logo-64.png', import.meta.url)))
    const report = buildReport([mov({ euros: 10, date: '2026-10-01' })], idx, monthPeriod(2026, 10), 'summary', ctx)
    const withLogo = await renderReportPdf(report, idx, logo)
    const without = await renderReportPdf(report, idx)
    expect(withLogo.length).toBeGreaterThan(without.length)
    expect(layoutReport(report, idx, measure, { logo: true })[0].ops.filter((o) => o.t === 'circle')).toHaveLength(0)
    expect(layoutReport(report, idx, measure)[0].ops.filter((o) => o.t === 'circle').length).toBeGreaterThan(0)
  })
})
