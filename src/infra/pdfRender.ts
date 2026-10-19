/** Convierte la maquetación del informe en un PDF real con pdf-lib (local, sin servidor). */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { APP_AUTHOR, APP_NAME, APP_VERSION } from '../app-info'
import type { CategoryIndex } from '../domain/categories'
import { LOGO_BOX, PAGE, layoutReport } from '../domain/pdf/layout'
import type { ReportModel } from '../domain/report'

/** `logoPng`: logotipo oficial (PNG). Si falta, la cabecera usa una luna dibujada. */
export async function renderReportPdf(model: ReportModel, categories: CategoryIndex, logoPng?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const created = new Date(model.generatedAt)
  doc.setTitle(`${model.title} · ${model.periodLabel}`)
  doc.setAuthor(APP_AUTHOR)
  doc.setCreator(`${APP_NAME} ${APP_VERSION}`)
  doc.setProducer(`${APP_NAME} (pdf-lib)`)
  doc.setLanguage('es-ES')
  doc.setCreationDate(created)
  doc.setModificationDate(created)

  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const measure = { width: (text: string, size: number, isBold?: boolean) => (isBold ? bold : regular).widthOfTextAtSize(text, size) }

  const logo = logoPng ? await doc.embedPng(logoPng) : null
  for (const laid of layoutReport(model, categories, measure, { logo: Boolean(logo) })) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    const H = PAGE.height
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
          const font = op.bold ? bold : regular
          const w = font.widthOfTextAtSize(op.text, op.size)
          const x = op.align === 'right' ? op.x - w : op.align === 'center' ? op.x - w / 2 : op.x
          page.drawText(op.text, { x, y: H - op.y, size: op.size, font, color: rgb(...op.color) })
          break
        }
      }
    }
  }
  return doc.save()
}
