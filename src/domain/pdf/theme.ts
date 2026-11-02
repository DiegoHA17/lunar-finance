/**
 * Estilos visuales del informe PDF. Un tema solo decide el aspecto (papel, colores, familias tipográficas, reglas y
 * alto de las filas): las cifras, los textos y el orden de las secciones son los mismos con cualquier estilo.
 *
 * Las familias son las fuentes estándar de PDF (Helvetica, Times y Courier): no se incrustan, todo lector de PDF las
 * incluye en Windows, Linux y macOS, y el texto sigue siendo seleccionable. No dependen de archivos ni de Internet.
 */

export type RGB = readonly [number, number, number]

export type FontFace = 'sans' | 'serif' | 'mono'

export type ReportStyle = 'classic' | 'vintage'

export const REPORT_STYLES: { id: ReportStyle; label: string }[] = [
  { id: 'classic', label: 'Clásico' },
  { id: 'vintage', label: 'Vintage' },
]

export interface PdfTheme {
  style: ReportStyle
  /** Color del papel; `null` deja la página en blanco (no se dibuja fondo). */
  paper: RGB | null
  fonts: {
    /** Tablas, importes y texto corrido. */
    body: FontFace
    /** Títulos, etiquetas, cabeceras de tabla, encabezado y pie. */
    display: FontFace
  }
  /** Títulos de sección y nombre de la aplicación en mayúsculas. */
  upperTitles: boolean
  /** Espacio sobre cada título de sección. */
  sectionGap: number
  colors: {
    ink: RGB
    title: RGB
    accent: RGB
    muted: RGB
    faint: RGB
    line: RGB
    positive: RGB
    negative: RGB
    warnBg: RGB
    warnInk: RGB
  }
  table: {
    rowH: number
    headerH: number
    totalH: number
    size: number
    totalSize: number
    headerFill: RGB | null
    headerInk: RGB
    headerRule: RGB
    zebra: RGB | null
    /** Raya fina bajo cada fila (registro contable). */
    rowRule: RGB | null
    totalRule: RGB
    /** Doble raya bajo la fila de totales. */
    doubleTotal: boolean
  }
  /** Bloque de cifras principales: paneles rellenos o casillas rayadas. */
  kpi: { fill: RGB | null; rule: RGB | null; valueFace: 'body' | 'display' }
  chart: { bar: RGB; barNegative: RGB; track: RGB; grid: RGB; zero: RGB }
  /** Reglas del encabezado y del pie. */
  masthead: { rule: RGB; double: boolean }
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

/** Diseño original del informe (predeterminado). */
export const CLASSIC: PdfTheme = {
  style: 'classic',
  paper: null,
  fonts: { body: 'sans', display: 'sans' },
  upperTitles: false,
  sectionGap: 14,
  colors: {
    ink: hex('#1e2633'),
    title: hex('#1c2b45'),
    accent: hex('#4a6b82'),
    muted: hex('#687183'),
    faint: hex('#9aa2b1'),
    line: hex('#dfe3ea'),
    positive: hex('#2f6b4f'),
    negative: hex('#9a3b34'),
    warnBg: hex('#fbf3e4'),
    warnInk: hex('#6f4c12'),
  },
  table: {
    rowH: 18,
    headerH: 20,
    totalH: 22,
    size: 8.5,
    totalSize: 9,
    headerFill: null,
    headerInk: hex('#687183'),
    headerRule: hex('#dfe3ea'),
    zebra: hex('#f5f7fa'),
    rowRule: null,
    totalRule: hex('#1c2b45'),
    doubleTotal: false,
  },
  kpi: { fill: hex('#f1f4f8'), rule: null, valueFace: 'body' },
  chart: { bar: hex('#4a6b82'), barNegative: hex('#2f6b4f'), track: hex('#dbe5ee'), grid: hex('#dfe3ea'), zero: hex('#9aa2b1') },
  masthead: { rule: hex('#dfe3ea'), double: false },
}

/** Registro contable impreso: papel marfil, tinta carbón y sepia, acentos oliva, máquina de escribir en los títulos. */
export const VINTAGE: PdfTheme = {
  style: 'vintage',
  paper: hex('#f7f1e3'),
  fonts: { body: 'serif', display: 'mono' },
  upperTitles: true,
  sectionGap: 22,
  colors: {
    ink: hex('#2b2722'),
    title: hex('#3d2f22'),
    accent: hex('#5f6838'),
    muted: hex('#6b6052'),
    faint: hex('#857866'),
    line: hex('#d6c9ad'),
    positive: hex('#4b5a26'),
    negative: hex('#8c3324'),
    warnBg: hex('#efe1bf'),
    warnInk: hex('#634512'),
  },
  table: {
    rowH: 19,
    headerH: 21,
    totalH: 24,
    size: 9.5,
    totalSize: 10,
    headerFill: hex('#ece2cb'),
    headerInk: hex('#4a3a2a'),
    headerRule: hex('#8b6b47'),
    zebra: null,
    rowRule: hex('#e3d8c0'),
    totalRule: hex('#3d2f22'),
    doubleTotal: true,
  },
  kpi: { fill: null, rule: hex('#8b6b47'), valueFace: 'body' },
  chart: { bar: hex('#8b6b47'), barNegative: hex('#5f6838'), track: hex('#e6dbc3'), grid: hex('#e0d4ba'), zero: hex('#8b6b47') },
  masthead: { rule: hex('#8b6b47'), double: true },
}

export const PDF_THEMES: Record<ReportStyle, PdfTheme> = { classic: CLASSIC, vintage: VINTAGE }

export function isReportStyle(v: unknown): v is ReportStyle {
  return v === 'classic' || v === 'vintage'
}
