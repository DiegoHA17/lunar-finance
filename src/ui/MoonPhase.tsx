/**
 * Fase lunar del periodo: la luna se va llenando a medida que transcurre. Luna llena = periodo cerrado;
 * luna nueva = periodo futuro. Aporta información (cuánto queda del periodo) además de identidad.
 */

import type { Period } from '../domain/periods'
import { elapsedFraction, litPath } from './moon'

export function MoonPhase({ period, size = 30 }: { period: Period; size?: number }) {
  const f = elapsedFraction(period)
  const r = size / 2 - 1.5
  const c = size / 2
  const label =
    f === 0 ? 'Periodo que aún no ha empezado' : f === 1 ? 'Periodo cerrado' : `Ha transcurrido el ${Math.round(f * 100)} % del periodo`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <circle cx={c} cy={c} r={r} fill="var(--accent-soft)" stroke="var(--line-strong)" strokeWidth="1" />
      {f > 0.01 && <path d={litPath(f, c, c, r)} fill="var(--accent)" opacity="0.85" />}
    </svg>
  )
}
