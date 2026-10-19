import { daysBetweenInclusive, today } from '../domain/dates'
import type { Period } from '../domain/periods'

/** Parte transcurrida del periodo (0 = futuro, 1 = cerrado). */
export function elapsedFraction(p: Period, now = today()): number {
  if (now < p.start) return 0
  if (now >= p.end) return 1
  return daysBetweenInclusive(p.start, now) / daysBetweenInclusive(p.start, p.end)
}

/** Trayectoria de la parte iluminada (creciente: luz a la derecha). */
export function litPath(f: number, cx: number, cy: number, r: number): string {
  if (f >= 0.999) return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
  const rx = Math.abs(1 - 2 * f) * r
  // De arriba abajo por la derecha; vuelta por el terminador: hacia la derecha si es creciente, a la izquierda si es gibosa.
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${rx} ${r} 0 0 ${f < 0.5 ? 0 : 1} ${cx} ${cy - r} Z`
}
