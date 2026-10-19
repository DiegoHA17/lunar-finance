import { useMemo, useState } from 'react'
import { useYears } from '../state/hooks'
import { cx } from '../ui/cx'
import { CategoryIndex } from '../domain/categories'
import { formatDateShort, today } from '../domain/dates'
import { formatBasisPoints } from '../domain/money'
import { needsClassification } from '../domain/movements'
import { type Period, periodContaining, periodLabel } from '../domain/periods'
import { type Comparison, type Summary, categoryKeyOf, compareWithPrevious, signedCents, summarize } from '../domain/stats'
import { KIND_LABEL, isCounted } from '../domain/types'
import { openMovements, setPeriod } from '../state/actions'
import { useApp } from '../state/store'
import { CategoryBars, SpendColumns } from '../ui/charts'
import { MoonPhase } from '../ui/MoonPhase'
import { PeriodPicker } from '../ui/PeriodPicker'
import { CategoryDot, EmptyState, Money, Notice, PageHeader } from '../ui/primitives'
import { DataGate } from './DataGate'

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function rangeText(p: Period): string {
  const t = today()
  const state = t < p.start ? 'aún no ha empezado' : t > p.end ? 'cerrado' : 'en curso'
  return `${formatDateShort(p.start)} – ${formatDateShort(p.end)}, ${state}`
}

function Delta({ bp, upIsGood, label }: { bp: number | null; upIsGood: boolean; label: string }) {
  if (bp === null) return null
  const good = bp === 0 ? null : bp > 0 === upIsGood
  return (
    <span className={cx('num', good === true && 'text-positive', good === false && 'text-negative')}>
      {bp > 0 ? '+' : bp < 0 ? '−' : ''}
      {formatBasisPoints(Math.abs(bp))} {label}
    </span>
  )
}

function Figures({ summary, comparison }: { summary: Summary; comparison: Comparison | null }) {
  const t = summary.totals
  const prevName = comparison ? `${comparison.partial ? 'el mismo punto de ' : ''}${periodLabel(comparison.previousPeriod)}` : ''
  return (
    <section className="panel grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_0.8fr]" aria-label="Cifras del periodo">
      <div className="flex flex-col gap-1 px-6 py-5">
        <span className="text-[13px] text-mist">Gasto neto</span>
        <Money cents={t.netExpenseCents} className="text-[40px] leading-none font-semibold tracking-[-0.02em] text-night [font-variant-numeric:normal]" />
        <span className="mt-1 text-[12.5px] text-mist">
          {comparison && comparison.netExpenseChangeBp !== null ? (
            <>
              <Delta bp={comparison.netExpenseChangeBp} upIsGood={false} label={`respecto a ${prevName}`} />
            </>
          ) : (
            'Sin periodo anterior con el que comparar'
          )}
        </span>
        {t.refundCents > 0 && (
          <span className="text-[12.5px] text-mist">
            <Money cents={t.expenseCents} /> en gastos menos <Money cents={t.refundCents} /> devueltos
          </span>
        )}
      </div>
      <Stat label="Ingresos" value={<Money cents={t.incomeCents} />} note={comparison ? <Delta bp={comparison.incomeChangeBp} upIsGood label="vs. anterior" /> : null} />
      <Stat
        label="Balance"
        value={<Money cents={t.balanceCents} signed tone="auto" />}
        note={<span title="Ingresos menos gasto neto del periodo. No es el saldo de tu cuenta.">Ingresos − gasto neto</span>}
      />
      <Stat
        label="Movimientos"
        value={<span className="num">{t.countedCount}</span>}
        note={t.excludedCount > 0 ? <span className="text-warn">{t.excludedCount} fuera de los totales</span> : t.transferCount > 0 ? `${t.transferCount} transferencia(s)` : null}
      />
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-line px-6 py-5 max-md:border-t md:border-l">
      <span className="text-[13px] text-mist">{label}</span>
      <span className="text-[22px] leading-tight font-semibold text-ink">{value}</span>
      {note && <span className="text-[12.5px] text-mist">{note}</span>}
    </div>
  )
}

export function Dashboard() {
  const period = useApp((s) => s.period)
  const movements = useApp((s) => s.data.movements)
  const categories = useApp((s) => s.data.categories)
  const years = useYears()
  const [allCategories, setAllCategories] = useState(false)

  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const summary = useMemo(() => summarize(movements, index, period), [movements, index, period])
  const comparison = useMemo(() => compareWithPrevious(movements, period, today()), [movements, period])
  const pending = summary.movements.filter((m) => isCounted(m) && needsClassification(m)).length
  const latest = summary.movements.filter(isCounted).slice(0, 8)
  const empty = summary.movements.length === 0

  return (
    <>
      <PageHeader leading={<MoonPhase period={period} />} title={capitalize(periodLabel(period))} subtitle={rangeText(period)} actions={<PeriodPicker value={period} onChange={setPeriod} years={years} />} />
      <DataGate>
        {empty ? (
          <EmptyState
            title={`No hay movimientos en ${periodLabel(period)}`}
            actions={
              <button className="btn" onClick={() => setPeriod(periodContaining(period.kind === 'custom' ? 'month' : period.kind, today()))}>
                Ir al periodo actual
              </button>
            }
          >
            Los movimientos que registres con el atajo «Gasto» aparecerán aquí después de actualizar.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            <Figures summary={summary} comparison={comparison} />

            {(pending > 0 || summary.excluded.length > 0) && (
              <div className="flex flex-col gap-2">
                {pending > 0 && (
                  <Notice
                    kind="info"
                    actions={
                      <button className="btn btn-sm btn-primary" onClick={() => openMovements({ status: 'pending' })}>
                        Clasificar
                      </button>
                    }
                  >
                    {pending === 1 ? 'Hay 1 movimiento sin categoría' : `Hay ${pending} movimientos sin categoría`} en este periodo. Cuentan en los totales como «Sin categoría».
                  </Notice>
                )}
                {summary.excluded.length > 0 && (
                  <Notice
                    kind="warn"
                    actions={
                      <button className="btn btn-sm" onClick={() => openMovements({ status: 'excluded' })}>
                        Revisar
                      </button>
                    }
                  >
                    {summary.excluded.length === 1 ? '1 movimiento no se incluye' : `${summary.excluded.length} movimientos no se incluyen`} en los totales porque le faltan datos (fecha, importe o tipo).
                  </Notice>
                )}
              </div>
            )}

            <section className="panel px-5 pt-4 pb-3">
              {summary.timeline.meaningful ? (
                <SpendColumns timeline={summary.timeline} />
              ) : (
                <div>
                  <h2 className="text-[15px] font-semibold text-night">Evolución del gasto</h2>
                  <p className="py-6 text-[13px] text-mist">La evolución se muestra cuando hay gastos en al menos dos tramos del periodo.</p>
                </div>
              )}
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
              <section className="panel px-3 pt-4 pb-3">
                <div className="mb-2 flex items-baseline justify-between px-2">
                  <h2 className="text-[15px] font-semibold text-night">Gasto por categoría</h2>
                  <span className="text-[12.5px] text-mist">parte del gasto neto</span>
                </div>
                {summary.expenseByCategory.length === 0 ? (
                  <p className="px-2 py-6 text-[13px] text-mist">No hay gastos en este periodo.</p>
                ) : (
                  <>
                    <CategoryBars rows={summary.expenseByCategory} limit={allCategories ? undefined : 7} onSelect={(r) => openMovements({ categoryKey: r.key })} />
                    {summary.expenseByCategory.length > 7 && (
                      <button className="btn btn-ghost btn-sm mt-1 ml-1 text-mist" onClick={() => setAllCategories((v) => !v)}>
                        {allCategories ? 'Mostrar menos' : `Ver las ${summary.expenseByCategory.length} categorías`}
                      </button>
                    )}
                  </>
                )}
              </section>

              <section className="panel px-3 pt-4 pb-2">
                <div className="mb-1 flex items-baseline justify-between px-2">
                  <h2 className="text-[15px] font-semibold text-night">Últimos movimientos</h2>
                  <button className="btn btn-ghost btn-sm text-mist" onClick={() => openMovements({})}>
                    Ver todos
                  </button>
                </div>
                <ul>
                  {latest.map((m) => {
                    const c = categoryKeyOf(m, index)
                    const signed = signedCents(m) ?? 0
                    return (
                      <li key={m.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                        <span className="num w-12 shrink-0 text-[12.5px] text-mist">{m.date ? formatDateShort(m.date, false) : '—'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{m.description || 'Sin descripción'}</span>
                          <span className="flex items-center gap-1.5 text-[12px] text-mist">
                            {m.kind === 'transfer' ? (
                              KIND_LABEL.transfer
                            ) : (
                              <>
                                <CategoryDot color={c.color} size={6} />
                                {c.name}
                              </>
                            )}
                          </span>
                        </span>
                        {m.kind === 'transfer' ? (
                          <Money cents={m.amountCents ?? 0} className="text-mist" />
                        ) : (
                          <Money cents={signed} signed className={signed > 0 ? 'text-positive' : 'text-ink'} />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}
      </DataGate>
    </>
  )
}
