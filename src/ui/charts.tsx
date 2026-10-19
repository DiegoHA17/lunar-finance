/**
 * Gráficos SVG/HTML propios, de una sola serie en el color de acento (la identidad la da el texto, no el color).
 * Barras ≤ 24 px con extremo redondeado de 4 px anclado a la línea base, rejilla recesiva y tooltip al pasar el
 * ratón o al enfocar con el teclado. Cada gráfico tiene una vista de tabla equivalente.
 */

import { cx } from './cx'
import { useLayoutEffect, useRef, useState } from 'react'
import { niceCeil } from '../domain/scale'
import { formatDateShort } from '../domain/dates'
import { formatBasisPoints, formatEUR } from '../domain/money'
import type { CategoryRow, Timeline } from '../domain/stats'
import { CategoryLabel } from './primitives'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function compactEUR(cents: number): string {
  const e = cents / 100
  if (Math.abs(e) >= 1000) return `${(e / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} mil €`
  return `${e.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
}

/** Barra vertical con el extremo de datos redondeado y la base recta. */
function columnPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h)
  if (up) return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}

const GRAN_LABEL = { day: 'día', week: 'semana', month: 'mes' } as const

export function SpendColumns({ timeline, height = 200 }: { timeline: Timeline; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const points = timeline.points
  const values = points.map((p) => p.netExpenseCents)
  const top = niceCeil(Math.max(0, ...values))
  const bottom = Math.min(0, ...values) < 0 ? -niceCeil(-Math.min(...values)) : 0
  const left = 56
  const padTop = 10
  const padBottom = 24
  const plotW = Math.max(0, width - left - 4)
  const plotH = height - padTop - padBottom
  const span = top - bottom || 1
  const y = (v: number) => padTop + ((top - v) / span) * plotH
  const slot = points.length ? plotW / points.length : 0
  const barW = Math.max(2, Math.min(24, slot * 0.64))
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 44))))

  const activePoint = active !== null && active < points.length ? points[active] : null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-night">Gasto neto por {GRAN_LABEL[timeline.granularity]}</h2>
        <button className="btn btn-ghost btn-sm text-mist" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Ver gráfico' : 'Ver como tabla'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="data-table text-[13px]">
            <thead>
              <tr>
                <th>Tramo</th>
                <th className="text-right">Gastos</th>
                <th className="text-right">Devoluciones</th>
                <th className="text-right">Gasto neto</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucket.key}>
                  <td>{p.bucket.start === p.bucket.end ? formatDateShort(p.bucket.start) : `${formatDateShort(p.bucket.start, false)} – ${formatDateShort(p.bucket.end)}`}</td>
                  <td className="num text-right">{formatEUR(p.expenseCents)}</td>
                  <td className="num text-right">{formatEUR(p.refundCents)}</td>
                  <td className="num text-right font-medium">{formatEUR(p.netExpenseCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={`Gráfico de columnas del gasto neto por ${GRAN_LABEL[timeline.granularity]}`}>
              {[top, top / 2, 0, ...(bottom < 0 ? [bottom] : [])].map((v) => (
                <g key={v}>
                  <line x1={left} x2={width - 4} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--line-strong)' : 'var(--chart-grid)'} strokeWidth="1" />
                  {/* Una etiqueta demasiado cerca de la del cero se omite (la línea se mantiene). */}
                  {(v === 0 || Math.abs(y(v) - y(0)) >= 14) && (
                    <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mist)" className="num">
                      {compactEUR(v)}
                    </text>
                  )}
                </g>
              ))}
              {points.map((p, i) => {
                const v = p.netExpenseCents
                const cxPos = left + slot * i + slot / 2
                const h = Math.abs(y(v) - y(0))
                return (
                  <g key={p.bucket.key}>
                    {v !== 0 && h > 0.5 && (
                      <path
                        d={columnPath(cxPos - barW / 2, v > 0 ? y(v) : y(0), barW, Math.max(1, h), v > 0)}
                        fill={v < 0 ? 'var(--positive)' : active === null || active === i ? 'var(--chart-bar)' : 'var(--chart-bar-soft)'}
                        style={{ transition: 'fill var(--dur) ease' }}
                      />
                    )}
                    {i % labelEvery === 0 && (
                      <text x={cxPos} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--mist)">
                        {p.bucket.label}
                      </text>
                    )}
                    {/* Zona de interacción: toda la columna, mayor que la barra. */}
                    <rect
                      x={left + slot * i}
                      y={padTop}
                      width={slot}
                      height={plotH}
                      fill="transparent"
                      tabIndex={0}
                      aria-label={`${p.bucket.label}: ${formatEUR(v)}`}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    />
                  </g>
                )
              })}
            </svg>
          )}
          {activePoint && active !== null && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]"
              style={{
                left: Math.min(Math.max(left + slot * active + slot / 2 - 90, 0), Math.max(0, width - 180)),
                top: 0,
                width: 180,
              }}
            >
              <div className="font-medium text-ink">
                {activePoint.bucket.start === activePoint.bucket.end
                  ? formatDateShort(activePoint.bucket.start)
                  : `${formatDateShort(activePoint.bucket.start, false)} – ${formatDateShort(activePoint.bucket.end)}`}
              </div>
              <div className="mt-1 flex justify-between text-ink-2">
                <span>Gasto neto</span>
                <span className="num font-medium text-ink">{formatEUR(activePoint.netExpenseCents)}</span>
              </div>
              {activePoint.refundCents > 0 && (
                <div className="flex justify-between text-mist">
                  <span>Devoluciones</span>
                  <span className="num">{formatEUR(activePoint.refundCents)}</span>
                </div>
              )}
              {activePoint.incomeCents > 0 && (
                <div className="flex justify-between text-mist">
                  <span>Ingresos</span>
                  <span className="num">{formatEUR(activePoint.incomeCents)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Ranking horizontal de categorías: nombre, barra proporcional, importe y parte del total. */
export function CategoryBars({ rows, limit, onSelect }: { rows: CategoryRow[]; limit?: number; onSelect?: (row: CategoryRow) => void }) {
  const shown = limit ? rows.slice(0, limit) : rows
  const max = Math.max(1, ...shown.map((r) => r.netCents))
  return (
    <ul className="flex flex-col">
      {shown.map((r) => {
        const content = (
          <>
            <span className="min-w-0 flex-[0_1_12rem]">
              <CategoryLabel name={r.name} color={r.color} icon={r.icon} status={r.status} />
            </span>
            <span className="hidden h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--chart-bar-soft)] sm:block" aria-hidden>
              <span className="block h-full rounded-full bg-[var(--chart-bar)]" style={{ width: `${Math.max(0, (r.netCents / max) * 100)}%` }} />
            </span>
            <span className="num w-24 shrink-0 text-right font-medium">{formatEUR(r.netCents)}</span>
            <span className="num w-14 shrink-0 text-right text-[12.5px] text-mist">{r.shareBp === null ? '—' : formatBasisPoints(r.shareBp)}</span>
          </>
        )
        return (
          <li key={r.key}>
            {onSelect ? (
              <button
                className={cx('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover')}
                onClick={() => onSelect(r)}
                title={`${r.count} movimiento(s). Ver movimientos de ${r.name}`}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-2 py-1.5">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
