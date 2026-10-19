import { Download, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { formatDateLong } from '../domain/dates'
import { formatBasisPoints, formatEUR } from '../domain/money'
import { type Period, periodLabel } from '../domain/periods'
import { type ReportDetail, buildReport } from '../domain/report'
import type { CategoryRow } from '../domain/stats'
import { exportCsv, exportReportPdf } from '../services/reports'
import { exportWithHost } from '../state/actions'
import { useApp } from '../state/store'
import { PeriodPicker } from '../ui/PeriodPicker'
import { CategoryLabel, Money, PageHeader, Spinner } from '../ui/primitives'
import { useYears } from '../state/hooks'
import { DataGate } from './DataGate'

function RowsTable({ rows, total, totalLabel }: { rows: CategoryRow[]; total: number; totalLabel: string }) {
  return (
    <table className="data-table text-[13.5px]">
      <thead>
        <tr>
          <th>Categoría</th>
          <th className="w-24 text-right">Movimientos</th>
          <th className="w-32 text-right">Importe</th>
          <th className="w-24 text-right">Parte</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>
              <CategoryLabel name={r.name} color={r.color} icon={r.icon} status={r.status} showIcon={false} />
            </td>
            <td className="num text-right text-ink-2">{r.count}</td>
            <td className="text-right">
              <Money cents={r.netCents} />
            </td>
            <td className="num text-right text-mist">{r.shareBp === null ? '—' : formatBasisPoints(r.shareBp)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td>{totalLabel}</td>
          <td className="num text-right">{rows.reduce((a, r) => a + r.count, 0)}</td>
          <td className="text-right">
            <Money cents={total} />
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}

export function Reports() {
  const globalPeriod = useApp((s) => s.period)
  const movements = useApp((s) => s.data.movements)
  const categories = useApp((s) => s.data.categories)
  const fetchedAt = useApp((s) => s.data.fetchedAt)
  const complete = useApp((s) => s.data.complete)
  const mode = useApp((s) => s.mode)
  const years = useYears()
  const [period, setPeriod] = useState<Period>(globalPeriod)
  const [detail, setDetail] = useState<ReportDetail>('summary')
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null)

  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const report = useMemo(
    () => buildReport(movements, index, period, detail, { demo: mode === 'demo', dataComplete: complete, lastSyncAt: fetchedAt }),
    [movements, index, period, detail, mode, complete, fetchedAt],
  )
  const t = report.summary.totals

  async function run(kind: 'pdf' | 'csv') {
    setExporting(kind)
    if (kind === 'pdf') await exportWithHost((h) => exportReportPdf(h, { ...report, generatedAt: new Date().toISOString() }, index), 'PDF')
    else await exportWithHost((h) => exportCsv(h, report.summary.movements, index, report.fileName.replace('resumen', 'movimientos').replace('informe', 'movimientos')), 'CSV')
    setExporting(null)
  }

  return (
    <>
      <PageHeader title="Informes" subtitle="Las cifras son exactamente las del panel de inicio para el mismo periodo." />
      <DataGate>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PeriodPicker value={period} onChange={setPeriod} years={years} />
            <div className="seg" role="group" aria-label="Nivel de detalle">
              <button aria-pressed={detail === 'summary'} onClick={() => setDetail('summary')}>
                Resumen ejecutivo
              </button>
              <button aria-pressed={detail === 'full'} onClick={() => setDetail('full')}>
                Con todos los movimientos
              </button>
            </div>
          </div>

          <article className="panel px-7 py-6" aria-label="Vista previa del informe">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
              <div>
                <p className="text-[13px] text-mist">{report.title}</p>
                <h2 className="text-[22px] font-semibold text-night">{periodLabel(period).charAt(0).toUpperCase() + periodLabel(period).slice(1)}</h2>
                <p className="text-[13px] text-mist">
                  Del {formatDateLong(period.start)} al {formatDateLong(period.end)}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={() => void run('pdf')} disabled={exporting !== null}>
                  {exporting === 'pdf' ? <Spinner /> : <FileText size={15} />} Exportar PDF
                </button>
                <button className="btn" onClick={() => void run('csv')} disabled={exporting !== null || report.summary.movements.length === 0}>
                  {exporting === 'csv' ? <Spinner /> : <Download size={15} />} CSV del periodo
                </button>
              </div>
            </header>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 py-5 md:grid-cols-4">
              {[
                ['Ingresos', <Money key="i" cents={t.incomeCents} />],
                ['Gasto neto', <Money key="g" cents={t.netExpenseCents} />],
                ['Balance', <Money key="b" cents={t.balanceCents} signed tone="auto" />],
                ['Movimientos', <span key="m" className="num">{t.countedCount}</span>],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-[13px] text-mist">{label}</dt>
                  <dd className="text-[20px] font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {t.refundCents > 0 && (
              <p className="-mt-2 mb-4 text-[13px] text-mist">
                Gasto neto = {formatEUR(t.expenseCents)} en gastos − {formatEUR(t.refundCents)} en devoluciones.
              </p>
            )}
            {report.comparison && (
              <p className="mb-4 text-[13px] text-ink-2">
                {report.comparison.partial ? `Hasta hoy, respecto al mismo punto de ${periodLabel(report.comparison.previousPeriod)}` : `Respecto a ${periodLabel(report.comparison.previousPeriod)}`}:{' '}
                {report.comparison.netExpenseChangeBp !== null && <>gasto neto {report.comparison.netExpenseChangeBp > 0 ? '+' : ''}{formatBasisPoints(report.comparison.netExpenseChangeBp)}, </>}
                balance {formatEUR(report.comparison.balanceDiffCents, { signed: true })}.
              </p>
            )}

            {report.summary.movements.length === 0 ? (
              <p className="py-6 text-mist">No hay movimientos en este periodo. El PDF se generará igualmente indicándolo.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {report.summary.expenseByCategory.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[15px] font-semibold text-night">Gasto por categoría</h3>
                    <RowsTable rows={report.summary.expenseByCategory} total={t.netExpenseCents} totalLabel="Total gasto neto" />
                  </section>
                )}
                {report.summary.incomeByCategory.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[15px] font-semibold text-night">Ingresos por categoría</h3>
                    <RowsTable rows={report.summary.incomeByCategory} total={t.incomeCents} totalLabel="Total ingresos" />
                  </section>
                )}
                {detail === 'full' && (
                  <p className="text-[13px] text-mist">
                    El PDF incluirá además el listado de los {t.countedCount} movimientos con fecha, descripción, categoría, tipo, método de pago e importe
                    {report.summary.timeline.meaningful ? ', y la evolución del gasto' : ''}.
                  </p>
                )}
              </div>
            )}

            <section className="mt-6 border-t border-line pt-4">
              <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">Notas del informe</h3>
              <ul className="list-disc pl-5 text-[13px] text-mist">
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          </article>
        </div>
      </DataGate>
    </>
  )
}
