/** Convierte la maquetación del informe en un PDF real con pdf-lib (local, sin servidor). */

import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib'
import { APP_AUTHOR, APP_NAME, APP_VERSION } from '../app-info'
import type { CategoryIndex } from '../domain/categories'
import { LOGO_BOX, type Measure, PAGE, layoutReport } from '../domain/pdf/layout'
import { CLASSIC, type FontFace, type PdfTheme } from '../domain/pdf/theme'
import type { ReportModel } from '../domain/report'

const STANDARD: Record<FontFace, [StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
}

/** Fuentes estándar de PDF (no se incrustan): se registran en el documento solo las que se usan. */
export function standardFonts(doc: PDFDocument): { font(face: FontFace | undefined, bold: boolean | undefined): PDFFont; measure: Measure } {
  const cache = new Map<string, PDFFont>()
  const font = (face: FontFace = 'sans', bold = false) => {
    const key = `${face}${bold ? '-b' : ''}`
    let f = cache.get(key)
    if (!f) {
      f = doc.embedStandardFont(STANDARD[face][bold ? 1 : 0])
      cache.set(key, f)
    }
    return f
  }
  return { font, measure: { width: (text, size, bold, face) => font(face, bold).widthOfTextAtSize(text, size) } }
}

/** `logoPng`: logotipo oficial (PNG). Si falta, la cabecera usa una luna dibujada. */
export async function renderReportPdf(model: ReportModel, categories: CategoryIndex, logoPng?: Uint8Array, theme: PdfTheme = CLASSIC): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const created = new Date(model.generatedAt)
  doc.setTitle(`${model.title} · ${model.periodLabel}`)
  doc.setAuthor(APP_AUTHOR)
  doc.setCreator(`${APP_NAME} ${APP_VERSION}`)
  doc.setProducer(`${APP_NAME} (pdf-lib)`)
  doc.setLanguage('es-ES')
  doc.setCreationDate(created)
  doc.setModificationDate(created)

  const { font, measure } = standardFonts(doc)
  const logo = logoPng ? await doc.embedPng(logoPng) : null
  for (const laid of layoutReport(model, categories, measure, { logo: Boolean(logo), theme })) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    const H = PAGE.height
    if (theme.paper) page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: H, color: rgb(...theme.paper) })
    if (logo) page.drawImage(logo, { x: LOGO_BOX.x, y: H - LOGO_BOX.y - LOGO_BOX.size, width: LOGO_BOX.size, height: LOGO_BOX.size })
    for (const op of laid.ops) {
      switch (op.t) {
        case 'rect':
          page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, color: rgb(...op.color) })
          break
        case 'line':
          page.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.width, color: rgb(...op.color) })
          break
        case 'circle':
          page.drawCircle({ x: op.x, y: H - op.y, size: op.r, color: rgb(...op.color) })
          break
        case 'text': {
          const f = font(op.face, op.bold)
          const w = f.widthOfTextAtSize(op.text, op.size)
          const x = op.align === 'right' ? op.x - w : op.align === 'center' ? op.x - w / 2 : op.x
          page.drawText(op.text, { x, y: H - op.y, size: op.size, font: f, color: rgb(...op.color) })
          break
        }
      }
    }
  }
  return doc.save()
}
