import { useMemo } from 'react'
import { parts } from '../domain/dates'
import { useApp } from './store'

/** Años presentes en los movimientos (para los selectores de periodo). */
export function useYears(): number[] {
  const movements = useApp((s) => s.data.movements)
  return useMemo(() => [...new Set(movements.flatMap((m) => (m.date ? [parts(m.date).year] : [])))], [movements])
}
