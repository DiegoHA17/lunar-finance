/** Selector de periodo: tipo (semana, mes, trimestre, año, personalizado), navegación y salto directo a un año. */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { isValidISODate, parts, today } from '../domain/dates'
import {
  type Period,
  type PeriodKind,
  PeriodError,
  customPeriod,
  monthPeriod,
  nextPeriod,
  periodContaining,
  previousPeriod,
  quarterPeriod,
  quarterOf,
  yearPeriod,
} from '../domain/periods'
import { monthName } from '../domain/dates'

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'Semana' },
  { kind: 'month', label: 'Mes' },
  { kind: 'quarter', label: 'Trimestre' },
  { kind: 'year', label: 'Año' },
  { kind: 'custom', label: 'Personalizado' },
]

export function PeriodPicker({ value, onChange, years }: { value: Period; onChange: (p: Period) => void; years: number[] }) {
  const [customStart, setCustomStart] = useState(value.start)
  const [customEnd, setCustomEnd] = useState(value.end)
  const [error, setError] = useState<string | null>(null)
  const anchor = value.start
  const { year } = parts(anchor)

  function pickKind(kind: PeriodKind) {
    setError(null)
    if (kind === 'custom') {
      setCustomStart(value.start)
      setCustomEnd(value.end)
      onChange({ ...value, kind: 'custom' })
      return
    }
    // Se conserva la referencia temporal: el periodo nuevo contiene el día de hoy si el actual lo contenía.
    const t = today()
    const ref = t >= value.start && t <= value.end ? t : value.start
    onChange(periodContaining(kind, ref))
  }

  function applyCustom(start: string, end: string) {
    setCustomStart(start)
    setCustomEnd(end)
    if (!isValidISODate(start) || !isValidISODate(end)) return
    try {
      onChange(customPeriod(start, end))
      setError(null)
    } catch (e) {
      setError(e instanceof PeriodError ? e.message : 'Intervalo no válido.')
    }
  }

  const yearOptions = [...new Set([...years, year, parts(today()).year])].sort((a, b) => b - a)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="seg" role="group" aria-label="Tipo de periodo">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" aria-pressed={value.kind === k.kind} onClick={() => pickKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>

      {value.kind === 'custom' ? (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="pp-start">
            Desde
          </label>
          <input id="pp-start" type="date" className="field w-auto" value={customStart} onChange={(e) => applyCustom(e.target.value, customEnd)} />
          <span className="text-mist">a</span>
          <label className="sr-only" htmlFor="pp-end">
            Hasta
          </label>
          <input id="pp-end" type="date" className="field w-auto" value={customEnd} onChange={(e) => applyCustom(customStart, e.target.value)} aria-invalid={Boolean(error)} />
          {error && (
            <span className="text-xs text-negative" role="alert">
              {error}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-icon" onClick={() => onChange(previousPeriod(value))} aria-label="Periodo anterior">
            <ChevronLeft size={16} />
          </button>
          {value.kind === 'month' && (
            <select className="field w-auto" aria-label="Mes" value={parts(anchor).month} onChange={(e) => onChange(monthPeriod(year, Number(e.target.value)))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {monthName(i + 1).charAt(0).toUpperCase() + monthName(i + 1).slice(1)}
                </option>
              ))}
            </select>
          )}
          {value.kind === 'quarter' && (
            <select className="field w-auto" aria-label="Trimestre" value={quarterOf(anchor)} onChange={(e) => onChange(quarterPeriod(year, Number(e.target.value)))}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  T{q}
                </option>
              ))}
            </select>
          )}
          {value.kind === 'week' && (
            <input type="date" className="field w-auto" aria-label="Semana que contiene el día" value={anchor} onChange={(e) => isValidISODate(e.target.value) && onChange(periodContaining('week', e.target.value))} />
          )}
          {value.kind !== 'week' && (
            <select
              className="field w-auto"
              aria-label="Año"
              value={year}
              onChange={(e) => {
                const y = Number(e.target.value)
                if (value.kind === 'year') onChange(yearPeriod(y))
                else if (value.kind === 'quarter') onChange(quarterPeriod(y, quarterOf(anchor)))
                else onChange(monthPeriod(y, parts(anchor).month))
              }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost btn-icon" onClick={() => onChange(nextPeriod(value))} aria-label="Periodo siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
