/**
 * Maquetación del informe PDF como lista de operaciones de dibujo por página. Es una función pura (la medición de
 * texto se inyecta), de modo que las pruebas pueden verificar paginación, saltos y cifras sin generar el PDF.
 *
 * El aspecto (papel, colores, familias, reglas y alto de filas) lo decide un {@link PdfTheme}; los textos, las cifras
 * y el orden de las secciones son los mismos con cualquier tema.
 *
 * Reglas de paginación:
 *   - ninguna fila de tabla se corta (altura fija; si no cabe, pasa entera a la página siguiente);
 *   - la cabecera de una tabla se repite en cada página que ocupa;
 *   - un título de sección nunca queda solo al final de una página (va con la cabecera y al menos 2 filas);
 *   - la fila de totales nunca queda sola al principio de una página (va con la última fila de datos);
 *   - cabecera y pie con «Página X de N» en todas las páginas.
 */

import { APP_NAME } from '../../app-info'
import { formatDateLong, formatDateES, formatInstant } from '../dates'
import { formatBasisPoints, formatEUR } from '../money'
import type { ReportModel } from '../report'
import { type CategoryRow, categoryKeyOf, signedCents } from '../stats'
import type { CategoryIndex } from '../categories'
import { issueShort } from '../movements'
import { KIND_LABEL, type Movement, isCounted } from '../types'
import { formatTick, niceScale } from '../scale'
import { toWinAnsi } from './text'
import { CLASSIC, type FontFace, type PdfTheme, type RGB } from './theme'

export type { RGB } from './theme'

export type Op =
  | { t: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; face?: FontFace; color: RGB; align?: 'left' | 'right' | 'center' }
  | { t: 'rect'; x: number; y: number; w: number; h: number; color: RGB }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: RGB; width: number }
  | { t: 'circle'; x: number; y: number; r: number; color: RGB }

export interface Measure {
  width(text: string, size: number, bold?: boolean, face?: FontFace): number
}

export interface LaidOutPage {
  ops: Op[]
}

export const PAGE = { width: 595.28, height: 841.89, marginX: 48, top: 76, bottom: 64 }
const CONTENT_W = PAGE.width - PAGE.marginX * 2
const LIMIT = PAGE.height - PAGE.bottom

/** Posición del logotipo en la cabecera (coordenadas desde arriba). */
export const LOGO_BOX = { x: PAGE.marginX - 1, y: 27, size: 17 }

interface Column {
  label: string
  width: number
  align?: 'left' | 'right'
}

interface Cell {
  text: string
  bold?: boolean
  color?: RGB
  /** Barra de proporción (0–1) dibujada en la celda. */
  bar?: number
  /** Número de columnas que ocupa la celda (por defecto 1). */
  span?: number
}

interface TextOpts {
  bold?: boolean
  color?: RGB
  align?: 'left' | 'right' | 'center'
  /** Familia del tema: `body` (por defecto) o `display`. */
  role?: 'body' | 'display'
}

class Flow {
  pages: Op[][] = []
  ops: Op[] = []
  y = PAGE.top

  readonly m: Measure
  readonly th: PdfTheme

  constructor(m: Measure, th: PdfTheme) {
    this.m = m
    this.th = th
    this.newPage()
  }

  newPage() {
    this.ops = []
    this.pages.push(this.ops)
    this.y = PAGE.top
  }

  fits(h: number) {
    return this.y + h <= LIMIT
  }

  ensure(h: number) {
    if (!this.fits(h)) this.newPage()
  }

  face(role: TextOpts['role'] = 'body'): FontFace {
    return this.th.fonts[role]
  }

  text(x: number, y: number, text: string, size: number, opts: TextOpts = {}) {
    const clean = toWinAnsi(text)
    if (!clean) return
    this.ops.push({ t: 'text', x, y, text: clean, size, bold: opts.bold, face: this.face(opts.role), color: opts.color ?? this.th.colors.ink, align: opts.align })
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB, width: number) {
    this.ops.push({ t: 'line', x1, y1, x2, y2, color, width })
  }

  /** Recorta con «…» para que quepa en `maxW`. */
  fit(text: string, size: number, maxW: number, bold = false, role: TextOpts['role'] = 'body'): string {
    const face = this.face(role)
    const clean = toWinAnsi(text)
    if (this.m.width(clean, size, bold, face) <= maxW) return clean
    let lo = 0
    let hi = clean.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.m.width(`${clean.slice(0, mid).trimEnd()}…`, size, bold, face) <= maxW) lo = mid
      else hi = mid - 1
    }
    return `${clean.slice(0, lo).trimEnd()}…`
  }

  wrap(text: string, size: number, maxW: number, bold = false): string[] {
    const face = this.face('body')
    const words = toWinAnsi(text).split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (this.m.width(candidate, size, bold, face) <= maxW || !line) line = candidate
      else {
        lines.push(line)
        line = w
      }
    }
    if (line) lines.push(line)
    return lines.map((l) => this.fit(l, size, maxW, bold))
  }

  /** Título en la familia `display` (en mayúsculas si el tema lo pide). */
  title(text: string) {
    return this.th.upperTitles ? text.toUpperCase() : text
  }
}

/** Alto que debe caber con un título de sección: cabecera de tabla y dos filas. */
function tableLead(f: Flow) {
  return f.th.table.headerH + f.th.table.rowH * 2
}

function sectionTitle(f: Flow, title: string, keepWith: number) {
  f.ensure(f.th.sectionGap + 16 + keepWith)
  f.y += f.th.sectionGap
  f.text(PAGE.marginX, f.y, f.fit(f.title(title), 12, CONTENT_W, true, 'display'), 12, { bold: true, color: f.th.colors.title, role: 'display' })
  f.y += 12
}

function drawTableHeader(f: Flow, cols: Column[]) {
  const t = f.th.table
  if (t.headerFill) f.ops.push({ t: 'rect', x: PAGE.marginX, y: f.y, w: CONTENT_W, h: t.headerH, color: t.headerFill })
  let x = PAGE.marginX
  f.line(PAGE.marginX, f.y + t.headerH, PAGE.marginX + CONTENT_W, f.y + t.headerH, t.headerRule, 0.8)
  for (const c of cols) {
    const label = f.fit(c.label.toUpperCase(), 7.5, c.width - 8, true, 'display')
    f.text(c.align === 'right' ? x + c.width - 4 : x + 4, f.y + t.headerH - 7, label, 7.5, {
      bold: true,
      color: t.headerInk,
      align: c.align === 'right' ? 'right' : 'left',
      role: 'display',
    })
    x += c.width
  }
  f.y += t.headerH
}

function drawRow(f: Flow, cols: Column[], cells: Cell[], opts: { zebra?: boolean; total?: boolean } = {}) {
  const t = f.th.table
  const h = opts.total ? t.totalH : t.rowH
  const size = opts.total ? t.totalSize : t.size
  if (opts.zebra && t.zebra) f.ops.push({ t: 'rect', x: PAGE.marginX, y: f.y, w: CONTENT_W, h, color: t.zebra })
  if (!opts.total && t.rowRule) f.line(PAGE.marginX, f.y + h, PAGE.marginX + CONTENT_W, f.y + h, t.rowRule, 0.35)
  if (opts.total) {
    f.line(PAGE.marginX, f.y, PAGE.marginX + CONTENT_W, f.y, t.totalRule, 0.8)
    if (t.doubleTotal) {
      f.line(PAGE.marginX, f.y + h - 2.6, PAGE.marginX + CONTENT_W, f.y + h - 2.6, t.totalRule, 0.5)
      f.line(PAGE.marginX, f.y + h - 0.4, PAGE.marginX + CONTENT_W, f.y + h - 0.4, t.totalRule, 0.5)
    }
  }
  let x = PAGE.marginX
  const baseline = f.y + h / 2 + size * 0.35
  let col = 0
  for (const cell of cells) {
    if (col >= cols.length) break
    const span = Math.max(1, Math.min(cell.span ?? 1, cols.length - col))
    const spanned = cols.slice(col, col + span)
    const width = spanned.reduce((a, c) => a + c.width, 0)
    // La alineación de una celda combinada es la de su última columna (los importes van a la derecha).
    const align = spanned[spanned.length - 1].align
    if (cell.bar !== undefined) {
      const barMax = width - 54
      const w = Math.max(0, Math.min(1, cell.bar)) * barMax
      f.ops.push({ t: 'rect', x: x + 4, y: f.y + h / 2 - 3, w: barMax, h: 6, color: f.th.chart.track })
      if (w > 0) f.ops.push({ t: 'rect', x: x + 4, y: f.y + h / 2 - 3, w, h: 6, color: f.th.chart.bar })
      f.text(x + width - 4, baseline, cell.text, size, { align: 'right', color: cell.color, bold: cell.bold })
    } else {
      const text = f.fit(cell.text, size, width - 8, cell.bold)
      f.text(align === 'right' ? x + width - 4 : x + 4, baseline, text, size, { bold: cell.bold, color: cell.color, align: align === 'right' ? 'right' : 'left' })
    }
    x += width
    col += span
  }
  f.y += h
}

/**
 * Tabla paginada. `total` se mantiene en la misma página que la última fila de datos.
 */
function table(f: Flow, cols: Column[], rows: Cell[][], total?: Cell[], empty = 'Sin datos en este periodo.') {
  const { headerH, rowH, totalH } = f.th.table
  const minRows = Math.min(2, Math.max(1, rows.length))
  f.ensure(headerH + minRows * rowH + (rows.length <= 2 && total ? totalH : 0))
  drawTableHeader(f, cols)
  if (rows.length === 0) {
    f.text(PAGE.marginX + 4, f.y + rowH - 5, empty, f.th.table.size, { color: f.th.colors.muted })
    f.y += rowH
  }
  rows.forEach((cells, i) => {
    const last = i === rows.length - 1
    const need = rowH + (last && total ? totalH : 0)
    if (!f.fits(need)) {
      f.newPage()
      drawTableHeader(f, cols)
    }
    drawRow(f, cols, cells, { zebra: i % 2 === 1 })
  })
  if (total) {
    if (!f.fits(totalH)) {
      // Solo ocurre si la tabla no tenía filas; aun así el total no queda huérfano de su cabecera.
      f.newPage()
      drawTableHeader(f, cols)
    }
    drawRow(f, cols, total, { total: true })
  }
}

function kpis(f: Flow, model: ReportModel) {
  const { colors, kpi } = f.th
  const t = model.summary.totals
  const gap = 10
  const w = (CONTENT_W - gap * 3) / 4
  const h = 62
  f.ensure(h + 8)
  const items: { label: string; value: string; sub?: string; color?: RGB }[] = [
    { label: 'Ingresos', value: formatEUR(t.incomeCents) },
    { label: 'Gasto neto', value: formatEUR(t.netExpenseCents), sub: t.refundCents > 0 ? `Devoluciones: ${formatEUR(t.refundCents)}` : undefined },
    { label: 'Balance', value: formatEUR(t.balanceCents), color: t.balanceCents < 0 ? colors.negative : colors.positive },
    { label: 'Movimientos', value: String(t.countedCount), sub: t.excludedCount ? `${t.excludedCount} excluido(s)` : undefined },
  ]
  if (kpi.rule) {
    // Casillas de un estadillo impreso: doble raya arriba, raya abajo y separadores verticales.
    f.line(PAGE.marginX, f.y, PAGE.marginX + CONTENT_W, f.y, kpi.rule, 0.8)
    f.line(PAGE.marginX, f.y + 2.2, PAGE.marginX + CONTENT_W, f.y + 2.2, kpi.rule, 0.4)
    f.line(PAGE.marginX, f.y + h, PAGE.marginX + CONTENT_W, f.y + h, kpi.rule, 0.6)
    for (let i = 1; i < 4; i++) {
      const x = PAGE.marginX + i * (w + gap) - gap / 2
      f.line(x, f.y + 10, x, f.y + h - 8, colors.line, 0.5)
    }
  }
  items.forEach((it, i) => {
    const x = PAGE.marginX + i * (w + gap)
    if (kpi.fill) f.ops.push({ t: 'rect', x, y: f.y, w, h, color: kpi.fill })
    f.text(x + 10, f.y + 17, f.fit(it.label.toUpperCase(), 7, w - 20, true, 'display'), 7, { bold: true, color: colors.muted, role: 'display' })
    // Una cifra no se recorta: si no cabe a 14 pt, se reduce el cuerpo.
    let size = 14
    while (size > 8 && f.m.width(toWinAnsi(it.value), size, true, f.face(kpi.valueFace)) > w - 20) size -= 0.5
    f.text(x + 10, f.y + 37, f.fit(it.value, size, w - 20, true, kpi.valueFace), size, { bold: true, color: it.color ?? colors.title, role: kpi.valueFace })
    if (it.sub) f.text(x + 10, f.y + 52, f.fit(it.sub, 7, w - 20), 7, { color: colors.muted })
  })
  f.y += h + 6
}

function comparisonLine(f: Flow, model: ReportModel) {
  const c = model.comparison
  if (!c) return
  const parts: string[] = []
  if (c.netExpenseChangeBp !== null) parts.push(`gasto neto ${c.netExpenseChangeBp > 0 ? '+' : ''}${formatBasisPoints(c.netExpenseChangeBp)}`)
  if (c.incomeChangeBp !== null) parts.push(`ingresos ${c.incomeChangeBp > 0 ? '+' : ''}${formatBasisPoints(c.incomeChangeBp)}`)
  parts.push(`balance ${formatEUR(c.balanceDiffCents, { signed: true })}`)
  const what = c.partial ? `Hasta el ${formatDateES(c.currentRange.end)}, frente a` : 'Frente a'
  const lines = f.wrap(`${what} ${formatDateES(c.previousRange.start)} – ${formatDateES(c.previousRange.end)}: ${parts.join(', ')}.`, 8, CONTENT_W)
  f.ensure(lines.length * 11 + 6)
  for (const l of lines) {
    f.text(PAGE.marginX, f.y + 10, l, 8, { color: f.th.colors.muted })
    f.y += 11
  }
  f.y += 5
}

function categoryTable(f: Flow, rows: CategoryRow[], totalCents: number, totalLabel: string) {
  const cols: Column[] = [
    { label: 'Categoría', width: CONTENT_W - 60 - 96 - 170 },
    { label: 'Movs.', width: 60, align: 'right' },
    { label: 'Importe', width: 96, align: 'right' },
    { label: 'Distribución', width: 170, align: 'right' },
  ]
  const data: Cell[][] = rows.map((r) => [
    { text: r.status === 'archived' ? `${r.name} (archivada)` : r.status === 'unknown' ? `${r.name} (no catalogada)` : r.name, color: r.status === 'none' ? f.th.colors.muted : undefined },
    { text: String(r.count) },
    { text: formatEUR(r.netCents) },
    { text: r.shareBp === null ? '—' : formatBasisPoints(r.shareBp), bar: r.shareBp === null ? 0 : r.shareBp / 10000 },
  ])
  const count = rows.reduce((a, r) => a + r.count, 0)
  table(f, cols, data, [{ text: totalLabel, bold: true }, { text: String(count), bold: true }, { text: formatEUR(totalCents), bold: true }, { text: '' }])
}

function timelineChart(f: Flow, model: ReportModel) {
  const { chart, colors } = f.th
  const tl = model.summary.timeline
  if (!tl.meaningful) return
  const h = 150
  sectionTitle(f, `Evolución del gasto neto por ${tl.granularity === 'day' ? 'día' : tl.granularity === 'week' ? 'semana' : 'mes'}`, h)
  const top = f.y + 8
  const chartH = h - 34
  const left = PAGE.marginX + 52
  const width = CONTENT_W - 52
  const values = tl.points.map((p) => p.netExpenseCents)
  // Misma escala que el panel: cada etiqueta es exactamente el valor de su línea.
  const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values))
  const span = scale.max - scale.min
  const yOf = (v: number) => top + ((scale.max - v) / span) * chartH
  for (const v of scale.ticks) {
    const y = yOf(v)
    f.line(left, y, left + width, y, v === 0 ? chart.zero : chart.grid, v === 0 ? 0.8 : 0.5)
    f.text(left - 6, y + 3, formatTick(v, scale.step), 6.5, { align: 'right', color: colors.muted })
  }
  const n = tl.points.length
  const slot = width / n
  const barW = Math.max(1.5, Math.min(22, slot * 0.62))
  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(width / 34)))
  tl.points.forEach((p, i) => {
    const cx = left + slot * i + slot / 2
    const v = p.netExpenseCents
    if (v !== 0) {
      const y0 = yOf(0)
      const y1 = yOf(v)
      f.ops.push({ t: 'rect', x: cx - barW / 2, y: Math.min(y0, y1), w: barW, h: Math.max(0.6, Math.abs(y1 - y0)), color: v < 0 ? chart.barNegative : chart.bar })
    }
    if (i % labelEvery === 0) {
      // Centrada bajo su barra, pero sin salirse del ancho de la gráfica (última etiqueta de un mes de 31 días).
      const half = f.m.width(toWinAnsi(p.bucket.label), 6.5, false, f.face()) / 2
      const lx = Math.min(Math.max(cx, left + half), left + width - half)
      f.text(lx, top + chartH + 12, p.bucket.label, 6.5, { align: 'center', color: colors.muted })
    }
  })
  f.y = top + h - 10
}

function movementCells(m: Movement, categories: CategoryIndex, th: PdfTheme): Cell[] {
  const signed = signedCents(m)
  const cat = categoryKeyOf(m, categories)
  return [
    { text: m.date ? formatDateES(m.date) : '—' },
    { text: m.description || '(sin descripción)', color: m.description ? undefined : th.colors.muted },
    { text: cat.status === 'none' ? 'Sin categoría' : cat.name, color: cat.status === 'none' ? th.colors.muted : undefined },
    { text: m.kind ? KIND_LABEL[m.kind] : (m.rawKind ?? '—') },
    { text: m.paymentMethod ?? '' },
    {
      text: signed === null ? '—' : m.kind === 'transfer' ? formatEUR(m.amountCents ?? 0) : formatEUR(signed, { signed: true }),
      color: m.kind === 'transfer' ? th.colors.muted : signed !== null && signed < 0 ? th.colors.ink : th.colors.positive,
    },
  ]
}

function crescent(ops: Op[], cx: number, cy: number, r: number, color: RGB, bg: RGB) {
  ops.push({ t: 'circle', x: cx, y: cy, r, color })
  ops.push({ t: 'circle', x: cx + r * 0.42, y: cy - r * 0.28, r: r * 0.86, color: bg })
}

const WHITE: RGB = [1, 1, 1]

export function layoutReport(model: ReportModel, categories: CategoryIndex, measure: Measure, opts: { logo?: boolean; theme?: PdfTheme } = {}): LaidOutPage[] {
  const th = opts.theme ?? CLASSIC
  const { colors } = th
  const f = new Flow(measure, th)
  const { summary } = model

  // Portada / encabezado del informe.
  f.text(PAGE.marginX, f.y + 4, model.title.toUpperCase(), 8, { bold: true, color: colors.accent, role: 'display' })
  f.y += 26
  const heading = model.periodLabel.charAt(0).toUpperCase() + model.periodLabel.slice(1)
  f.text(PAGE.marginX, f.y, f.fit(heading, 22, CONTENT_W, true, 'display'), 22, { bold: true, color: colors.title, role: 'display' })
  f.y += 18
  f.text(PAGE.marginX, f.y, `Del ${formatDateLong(model.period.start)} al ${formatDateLong(model.period.end)} · generado el ${formatInstant(model.generatedAt)}`, 8.5, {
    color: colors.muted,
  })
  f.y += 14
  // Avisos que afectan a la validez de las cifras (no explicaciones): datos ficticios o consulta incompleta.
  for (const w of [...(model.demo ? ['DATOS DE DEMOSTRACIÓN (ficticios)'] : []), ...model.warnings]) {
    f.ops.push({ t: 'rect', x: PAGE.marginX, y: f.y, w: CONTENT_W, h: 20, color: colors.warnBg })
    f.text(PAGE.marginX + 10, f.y + 13, f.fit(w, 8, CONTENT_W - 20, true), 8, { bold: true, color: colors.warnInk })
    f.y += 24
  }
  f.y += 4
  kpis(f, model)
  comparisonLine(f, model)

  if (summary.totals.countedCount === 0 && summary.excluded.length === 0) {
    f.ensure(30)
    f.y += 16
    f.text(PAGE.marginX, f.y, 'Sin movimientos en este periodo.', 10, { color: colors.muted })
    f.y += 10
  }
  timelineChart(f, model)

  if (summary.expenseByCategory.length > 0 || summary.totals.netExpenseCents !== 0) {
    sectionTitle(f, 'Gasto por categoría', tableLead(f))
    categoryTable(f, summary.expenseByCategory, summary.totals.netExpenseCents, 'Total gasto neto')
  }
  if (summary.incomeByCategory.length > 0) {
    sectionTitle(f, 'Ingresos por categoría', tableLead(f))
    categoryTable(f, summary.incomeByCategory, summary.totals.incomeCents, 'Total ingresos')
  }
  if (model.detail === 'full') {
    const counted = summary.movements.filter(isCounted)
    const cols: Column[] = [
      { label: 'Fecha', width: 56 },
      { label: 'Descripción', width: CONTENT_W - 56 - 92 - 62 - 70 - 82 },
      { label: 'Categoría', width: 92 },
      { label: 'Tipo', width: 62 },
      { label: 'Método', width: 70 },
      { label: 'Importe', width: 82, align: 'right' },
    ]
    sectionTitle(f, `Movimientos (${counted.length})`, tableLead(f))
    table(
      f,
      cols,
      counted.map((m) => movementCells(m, categories, th)),
      [{ text: 'Balance del periodo', bold: true, span: 3 }, { text: '', span: 2 }, { text: formatEUR(summary.totals.balanceCents, { signed: true }), bold: true }],
      'No hay movimientos incluidos en los totales.',
    )
  }

  if (summary.excluded.length > 0) {
    const cols: Column[] = [
      { label: 'Fecha', width: 56 },
      { label: 'Descripción', width: 170 },
      { label: 'Motivo', width: CONTENT_W - 56 - 170 },
    ]
    sectionTitle(f, `Excluidos de los totales (${summary.excluded.length})`, tableLead(f))
    table(
      f,
      cols,
      summary.excluded.map((m) => [
        { text: m.date ? formatDateES(m.date) : '—' },
        { text: m.description || '(sin descripción)' },
        { text: m.issues.filter((i) => i.blocking).map((i) => issueShort(i.code, m)).join(', '), color: colors.negative },
      ]),
    )
  }

  // Cabecera y pie (necesitan el número total de páginas).
  const total = f.pages.length
  const display = th.fonts.display
  const rule = th.masthead
  f.pages.forEach((ops, i) => {
    // Con el logotipo oficial (lo dibuja el renderizador en LOGO_BOX) no se dibuja la luna de reserva.
    if (!opts.logo) crescent(ops, PAGE.marginX + 7, 36, 7, colors.accent, th.paper ?? WHITE)
    ops.push({ t: 'text', x: PAGE.marginX + 20, y: 40, text: f.title(APP_NAME), size: 11, bold: true, face: display, color: colors.title })
    ops.push({ t: 'text', x: PAGE.width - PAGE.marginX, y: 40, text: toWinAnsi(model.periodLabel), size: 8, face: display, color: colors.muted, align: 'right' })
    ops.push({ t: 'line', x1: PAGE.marginX, y1: 52, x2: PAGE.width - PAGE.marginX, y2: 52, color: rule.rule, width: rule.double ? 0.8 : 0.6 })
    if (rule.double) ops.push({ t: 'line', x1: PAGE.marginX, y1: 54.4, x2: PAGE.width - PAGE.marginX, y2: 54.4, color: rule.rule, width: 0.35 })
    const footY = PAGE.height - 34
    ops.push({ t: 'line', x1: PAGE.marginX, y1: footY - 12, x2: PAGE.width - PAGE.marginX, y2: footY - 12, color: rule.rule, width: rule.double ? 0.4 : 0.6 })
    ops.push({
      t: 'text',
      x: PAGE.marginX,
      y: footY,
      text: toWinAnsi(`${model.title} · ${model.periodLabel}${model.demo ? ' · DATOS DE DEMOSTRACIÓN' : ''}`),
      size: 7,
      face: display,
      color: model.demo ? colors.warnInk : colors.faint,
    })
    ops.push({ t: 'text', x: PAGE.width - PAGE.marginX, y: footY, text: `Página ${i + 1} de ${total}`, size: 7, face: display, color: colors.faint, align: 'right' })
  })

  return f.pages.map((ops) => ({ ops }))
}
