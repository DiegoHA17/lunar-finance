/**
 * Maquetación del informe PDF como lista de operaciones de dibujo por página. Es una función pura (la medición de
 * texto se inyecta), de modo que las pruebas pueden verificar paginación, saltos y cifras sin generar el PDF.
 *
 * Reglas de paginación:
 *   - ninguna fila de tabla se corta (altura fija; si no cabe, pasa entera a la página siguiente);
 *   - la cabecera de una tabla se repite en cada página que ocupa;
 *   - un título de sección nunca queda solo al final de una página (va con la cabecera y al menos 2 filas);
 *   - la fila de totales nunca queda sola al principio de una página (va con la última fila de datos);
 *   - cabecera y pie con «Página X de N» en todas las páginas.
 */

import { formatDateLong, formatDateES, formatInstant } from '../dates'
import { formatBasisPoints, formatEUR } from '../money'
import type { ReportModel } from '../report'
import { type CategoryRow, categoryKeyOf, signedCents } from '../stats'
import type { CategoryIndex } from '../categories'
import { KIND_LABEL, type Movement, isCounted } from '../types'
import { niceCeil } from '../scale'
import { toWinAnsi } from './text'

export type RGB = readonly [number, number, number]

export type Op =
  | { t: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; color: RGB; align?: 'left' | 'right' | 'center' }
  | { t: 'rect'; x: number; y: number; w: number; h: number; color: RGB }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: RGB; width: number }
  | { t: 'circle'; x: number; y: number; r: number; color: RGB }

export interface Measure {
  width(text: string, size: number, bold?: boolean): number
}

export interface LaidOutPage {
  ops: Op[]
}

export const PAGE = { width: 595.28, height: 841.89, marginX: 48, top: 76, bottom: 64 }
const CONTENT_W = PAGE.width - PAGE.marginX * 2
const LIMIT = PAGE.height - PAGE.bottom

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

export const COLORS = {
  ink: hex('#1e2633'),
  night: hex('#1c2b45'),
  muted: hex('#687183'),
  faint: hex('#9aa2b1'),
  line: hex('#dfe3ea'),
  zebra: hex('#f5f7fa'),
  panel: hex('#f1f4f8'),
  moon: hex('#4a6b82'),
  moonSoft: hex('#dbe5ee'),
  positive: hex('#2f6b4f'),
  negative: hex('#9a3b34'),
  warnBg: hex('#fbf3e4'),
  warnInk: hex('#6f4c12'),
  white: hex('#ffffff'),
}

export const ROW_H = 18
const HEADER_H = 20
const TOTAL_H = 22

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

class Flow {
  pages: Op[][] = []
  ops: Op[] = []
  y = PAGE.top

  readonly m: Measure

  constructor(m: Measure) {
    this.m = m
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

  text(x: number, y: number, text: string, size: number, opts: { bold?: boolean; color?: RGB; align?: 'left' | 'right' | 'center' } = {}) {
    const clean = toWinAnsi(text)
    if (!clean) return
    this.ops.push({ t: 'text', x, y, text: clean, size, bold: opts.bold, color: opts.color ?? COLORS.ink, align: opts.align })
  }

  /** Recorta con «…» para que quepa en `maxW`. */
  fit(text: string, size: number, maxW: number, bold = false): string {
    const clean = toWinAnsi(text)
    if (this.m.width(clean, size, bold) <= maxW) return clean
    let lo = 0
    let hi = clean.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.m.width(`${clean.slice(0, mid).trimEnd()}…`, size, bold) <= maxW) lo = mid
      else hi = mid - 1
    }
    return `${clean.slice(0, lo).trimEnd()}…`
  }

  wrap(text: string, size: number, maxW: number, bold = false): string[] {
    const words = toWinAnsi(text).split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (this.m.width(candidate, size, bold) <= maxW || !line) line = candidate
      else {
        lines.push(line)
        line = w
      }
    }
    if (line) lines.push(line)
    return lines.map((l) => this.fit(l, size, maxW, bold))
  }
}

function sectionTitle(f: Flow, title: string, keepWith: number) {
  f.ensure(30 + keepWith)
  f.y += 14
  f.text(PAGE.marginX, f.y, title, 12, { bold: true, color: COLORS.night })
  f.y += 12
}

function drawTableHeader(f: Flow, cols: Column[]) {
  let x = PAGE.marginX
  f.ops.push({ t: 'line', x1: PAGE.marginX, y1: f.y + HEADER_H, x2: PAGE.marginX + CONTENT_W, y2: f.y + HEADER_H, color: COLORS.line, width: 0.8 })
  for (const c of cols) {
    const label = f.fit(c.label.toUpperCase(), 7.5, c.width - 8, true)
    f.text(c.align === 'right' ? x + c.width - 4 : x + 4, f.y + 13, label, 7.5, { bold: true, color: COLORS.muted, align: c.align === 'right' ? 'right' : 'left' })
    x += c.width
  }
  f.y += HEADER_H
}

function drawRow(f: Flow, cols: Column[], cells: Cell[], opts: { zebra?: boolean; height?: number; size?: number; topRule?: boolean } = {}) {
  const h = opts.height ?? ROW_H
  const size = opts.size ?? 8.5
  if (opts.zebra) f.ops.push({ t: 'rect', x: PAGE.marginX, y: f.y, w: CONTENT_W, h, color: COLORS.zebra })
  if (opts.topRule) f.ops.push({ t: 'line', x1: PAGE.marginX, y1: f.y, x2: PAGE.marginX + CONTENT_W, y2: f.y, color: COLORS.night, width: 0.8 })
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
      f.ops.push({ t: 'rect', x: x + 4, y: f.y + h / 2 - 3, w: barMax, h: 6, color: COLORS.moonSoft })
      if (w > 0) f.ops.push({ t: 'rect', x: x + 4, y: f.y + h / 2 - 3, w, h: 6, color: COLORS.moon })
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
  const minRows = Math.min(2, Math.max(1, rows.length))
  f.ensure(HEADER_H + minRows * ROW_H + (rows.length <= 2 && total ? TOTAL_H : 0))
  drawTableHeader(f, cols)
  if (rows.length === 0) {
    f.text(PAGE.marginX + 4, f.y + 13, empty, 8.5, { color: COLORS.muted })
    f.y += ROW_H
  }
  rows.forEach((cells, i) => {
    const last = i === rows.length - 1
    const need = ROW_H + (last && total ? TOTAL_H : 0)
    if (!f.fits(need)) {
      f.newPage()
      drawTableHeader(f, cols)
    }
    drawRow(f, cols, cells, { zebra: i % 2 === 1 })
  })
  if (total) {
    if (!f.fits(TOTAL_H)) {
      // Solo ocurre si la tabla no tenía filas; aun así el total no queda huérfano de su cabecera.
      f.newPage()
      drawTableHeader(f, cols)
    }
    drawRow(f, cols, total, { height: TOTAL_H, size: 9, topRule: true })
  }
}

function kpis(f: Flow, model: ReportModel) {
  const t = model.summary.totals
  const gap = 10
  const w = (CONTENT_W - gap * 3) / 4
  const h = 62
  f.ensure(h + 8)
  const items: { label: string; value: string; sub?: string; color?: RGB }[] = [
    { label: 'Ingresos', value: formatEUR(t.incomeCents), sub: `${t.incomeCount} movimiento(s)` },
    {
      label: 'Gasto neto',
      value: formatEUR(t.netExpenseCents),
      sub: t.refundCents > 0 ? `${formatEUR(t.expenseCents)} − ${formatEUR(t.refundCents)} dev.` : `${t.expenseCount} movimiento(s)`,
    },
    { label: 'Balance', value: formatEUR(t.balanceCents), sub: 'Ingresos − gasto neto', color: t.balanceCents < 0 ? COLORS.negative : COLORS.positive },
    { label: 'Movimientos', value: String(t.countedCount), sub: t.excludedCount ? `${t.excludedCount} excluido(s)` : 'incluidos en totales' },
  ]
  items.forEach((it, i) => {
    const x = PAGE.marginX + i * (w + gap)
    f.ops.push({ t: 'rect', x, y: f.y, w, h, color: COLORS.panel })
    f.text(x + 10, f.y + 17, it.label.toUpperCase(), 7, { bold: true, color: COLORS.muted })
    f.text(x + 10, f.y + 37, f.fit(it.value, 14, w - 20, true), 14, { bold: true, color: it.color ?? COLORS.night })
    if (it.sub) f.text(x + 10, f.y + 52, f.fit(it.sub, 7, w - 20), 7, { color: COLORS.muted })
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
  f.ensure(16)
  const what = c.partial ? 'Hasta hoy, respecto al mismo tramo del periodo anterior' : 'Respecto al periodo anterior'
  f.text(PAGE.marginX, f.y + 10, f.fit(`${what} (${formatDateES(c.previousRange.start)} – ${formatDateES(c.previousRange.end)}): ${parts.join(', ')}.`, 8, CONTENT_W), 8, {
    color: COLORS.muted,
  })
  f.y += 16
}

function categoryTable(f: Flow, rows: CategoryRow[], totalCents: number, totalLabel: string) {
  const cols: Column[] = [
    { label: 'Categoría', width: CONTENT_W - 60 - 96 - 170 },
    { label: 'Movs.', width: 60, align: 'right' },
    { label: 'Importe', width: 96, align: 'right' },
    { label: 'Distribución', width: 170, align: 'right' },
  ]
  const data: Cell[][] = rows.map((r) => [
    { text: r.status === 'archived' ? `${r.name} (archivada)` : r.status === 'unknown' ? `${r.name} (no catalogada)` : r.name, color: r.status === 'none' ? COLORS.muted : undefined },
    { text: String(r.count) },
    { text: formatEUR(r.netCents) },
    { text: r.shareBp === null ? '—' : formatBasisPoints(r.shareBp), bar: r.shareBp === null ? 0 : r.shareBp / 10000 },
  ])
  const count = rows.reduce((a, r) => a + r.count, 0)
  table(f, cols, data, [{ text: totalLabel, bold: true }, { text: String(count), bold: true }, { text: formatEUR(totalCents), bold: true }, { text: '' }])
}

function timelineChart(f: Flow, model: ReportModel) {
  const tl = model.summary.timeline
  if (!tl.meaningful) return
  const h = 150
  sectionTitle(f, `Evolución del gasto neto por ${tl.granularity === 'day' ? 'día' : tl.granularity === 'week' ? 'semana' : 'mes'}`, h)
  const top = f.y + 8
  const chartH = h - 34
  const left = PAGE.marginX + 52
  const width = CONTENT_W - 52
  const values = tl.points.map((p) => p.netExpenseCents)
  const max = niceCeil(Math.max(0, ...values))
  const rawMin = Math.min(0, ...values)
  const min = rawMin < 0 ? -niceCeil(-rawMin) : 0
  const span = max - min || 1
  const yOf = (v: number) => top + ((max - v) / span) * chartH
  // Rejilla: máximo y cero.
  for (const v of [max, min < 0 ? min : max / 2, 0]) {
    const y = yOf(v)
    f.ops.push({ t: 'line', x1: left, y1: y, x2: left + width, y2: y, color: v === 0 ? COLORS.faint : COLORS.line, width: v === 0 ? 0.8 : 0.5 })
    f.text(left - 6, y + 3, formatEUR(Math.round(v)), 6.5, { align: 'right', color: COLORS.muted })
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
      f.ops.push({ t: 'rect', x: cx - barW / 2, y: Math.min(y0, y1), w: barW, h: Math.max(0.6, Math.abs(y1 - y0)), color: v < 0 ? COLORS.positive : COLORS.moon })
    }
    if (i % labelEvery === 0) f.text(cx, top + chartH + 12, p.bucket.label, 6.5, { align: 'center', color: COLORS.muted })
  })
  f.y = top + h - 10
}

function movementCells(m: Movement, categories: CategoryIndex): Cell[] {
  const signed = signedCents(m)
  const cat = categoryKeyOf(m, categories)
  return [
    { text: m.date ? formatDateES(m.date) : '—' },
    { text: m.description || '(sin descripción)', color: m.description ? undefined : COLORS.muted },
    { text: cat.status === 'none' ? 'Sin categoría' : cat.name, color: cat.status === 'none' ? COLORS.muted : undefined },
    { text: m.kind ? KIND_LABEL[m.kind] : (m.rawKind ?? '—') },
    { text: m.paymentMethod ?? '' },
    {
      text: signed === null ? '—' : m.kind === 'transfer' ? formatEUR(m.amountCents ?? 0) : formatEUR(signed, { signed: true }),
      color: m.kind === 'transfer' ? COLORS.muted : signed !== null && signed < 0 ? COLORS.ink : COLORS.positive,
    },
  ]
}

function notesBlock(f: Flow, notes: string[]) {
  if (notes.length === 0) return
  const lines = notes.flatMap((n) => f.wrap(`• ${n}`, 8, CONTENT_W - 8))
  sectionTitle(f, 'Notas', Math.min(lines.length, 3) * 12)
  for (const l of lines) {
    f.ensure(12)
    f.text(PAGE.marginX + 4, f.y + 9, l, 8, { color: COLORS.muted })
    f.y += 12
  }
}

function crescent(ops: Op[], cx: number, cy: number, r: number, bg: RGB) {
  ops.push({ t: 'circle', x: cx, y: cy, r, color: COLORS.moon })
  ops.push({ t: 'circle', x: cx + r * 0.42, y: cy - r * 0.28, r: r * 0.86, color: bg })
}

export function layoutReport(model: ReportModel, categories: CategoryIndex, measure: Measure): LaidOutPage[] {
  const f = new Flow(measure)
  const { summary } = model

  // Portada / encabezado del informe.
  f.text(PAGE.marginX, f.y + 4, model.title.toUpperCase(), 8, { bold: true, color: COLORS.moon })
  f.y += 26
  f.text(PAGE.marginX, f.y, model.periodLabel.charAt(0).toUpperCase() + model.periodLabel.slice(1), 22, { bold: true, color: COLORS.night })
  f.y += 18
  f.text(PAGE.marginX, f.y, `Del ${formatDateLong(model.period.start)} al ${formatDateLong(model.period.end)} · generado el ${formatInstant(model.generatedAt)}`, 8.5, {
    color: COLORS.muted,
  })
  f.y += 14
  if (model.demo) {
    f.ops.push({ t: 'rect', x: PAGE.marginX, y: f.y, w: CONTENT_W, h: 22, color: COLORS.warnBg })
    f.text(PAGE.marginX + 10, f.y + 14, 'DATOS DE DEMOSTRACIÓN — cifras ficticias, no corresponden a movimientos reales.', 8, { bold: true, color: COLORS.warnInk })
    f.y += 28
  }
  f.y += 4
  kpis(f, model)
  comparisonLine(f, model)

  if (summary.expenseByCategory.length > 0 || summary.totals.netExpenseCents !== 0) {
    sectionTitle(f, 'Gasto por categoría', HEADER_H + ROW_H * 2)
    categoryTable(f, summary.expenseByCategory, summary.totals.netExpenseCents, 'Total gasto neto')
  }
  if (summary.incomeByCategory.length > 0) {
    sectionTitle(f, 'Ingresos por categoría', HEADER_H + ROW_H * 2)
    categoryTable(f, summary.incomeByCategory, summary.totals.incomeCents, 'Total ingresos')
  }
  if (summary.totals.countedCount === 0 && summary.excluded.length === 0) {
    f.ensure(30)
    f.y += 16
    f.text(PAGE.marginX, f.y, 'No hay movimientos en este periodo.', 10, { color: COLORS.muted })
    f.y += 10
  }
  timelineChart(f, model)

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
    sectionTitle(f, `Movimientos (${counted.length})`, HEADER_H + ROW_H * 2)
    table(
      f,
      cols,
      counted.map((m) => movementCells(m, categories)),
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
    sectionTitle(f, `Excluidos de los totales (${summary.excluded.length})`, HEADER_H + ROW_H * 2)
    table(
      f,
      cols,
      summary.excluded.map((m) => [
        { text: m.date ? formatDateES(m.date) : '—' },
        { text: m.description || '(sin descripción)' },
        { text: m.issues.filter((i) => i.blocking).map((i) => i.message).join(' '), color: COLORS.negative },
      ]),
    )
  }

  notesBlock(f, model.notes)

  // Cabecera y pie (necesitan el número total de páginas).
  const total = f.pages.length
  f.pages.forEach((ops, i) => {
    crescent(ops, PAGE.marginX + 7, 36, 7, COLORS.white)
    ops.push({ t: 'text', x: PAGE.marginX + 20, y: 40, text: 'Lunar', size: 11, bold: true, color: COLORS.night })
    ops.push({ t: 'text', x: PAGE.width - PAGE.marginX, y: 40, text: toWinAnsi(model.periodLabel), size: 8, color: COLORS.muted, align: 'right' })
    ops.push({ t: 'line', x1: PAGE.marginX, y1: 52, x2: PAGE.width - PAGE.marginX, y2: 52, color: COLORS.line, width: 0.6 })
    const footY = PAGE.height - 34
    ops.push({ t: 'line', x1: PAGE.marginX, y1: footY - 12, x2: PAGE.width - PAGE.marginX, y2: footY - 12, color: COLORS.line, width: 0.6 })
    ops.push({
      t: 'text',
      x: PAGE.marginX,
      y: footY,
      text: toWinAnsi(`${model.title} · ${model.periodLabel}${model.demo ? ' · DATOS DE DEMOSTRACIÓN' : ''}`),
      size: 7,
      color: model.demo ? COLORS.warnInk : COLORS.faint,
    })
    ops.push({ t: 'text', x: PAGE.width - PAGE.marginX, y: footY, text: `Página ${i + 1} de ${total}`, size: 7, color: COLORS.faint, align: 'right' })
  })

  return f.pages.map((ops) => ({ ops }))
}
