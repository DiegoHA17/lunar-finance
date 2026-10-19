/** Filtros de la lista de movimientos. El CSV exporta exactamente el resultado de {@link applyFilter}. */

import type { CategoryIndex } from './categories'
import { needsClassification } from './movements'
import { type Period, inPeriod } from './periods'
import { categoryKeyOf } from './stats'
import { normalizeText } from './text'
import { type Movement, type MovementKind, isCounted } from './types'

export type StatusFilter = 'all' | 'pending' | 'issues' | 'excluded' | 'duplicates'

export interface MovementFilter {
  period: Period | null
  search: string
  kinds: MovementKind[]
  categoryKeys: string[]
  paymentMethods: string[]
  status: StatusFilter
}

export const EMPTY_FILTER: MovementFilter = { period: null, search: '', kinds: [], categoryKeys: [], paymentMethods: [], status: 'all' }

export function applyFilter(list: Movement[], f: MovementFilter, categories: CategoryIndex): Movement[] {
  const q = normalizeText(f.search)
  const methods = new Set(f.paymentMethods.map(normalizeText))
  return list.filter((m) => {
    if (f.period && !inPeriod(f.period, m.date)) return false
    if (f.kinds.length && (m.kind === null || !f.kinds.includes(m.kind))) return false
    if (f.categoryKeys.length && !f.categoryKeys.includes(categoryKeyOf(m, categories).key)) return false
    if (methods.size && !methods.has(normalizeText(m.paymentMethod))) return false
    switch (f.status) {
      case 'pending':
        if (!needsClassification(m)) return false
        break
      case 'issues':
        if (m.issues.length === 0) return false
        break
      case 'excluded':
        if (isCounted(m)) return false
        break
      case 'duplicates':
        if (!m.issues.some((i) => i.code === 'possible_duplicate')) return false
        break
    }
    if (q) {
      const hay = normalizeText(`${m.description} ${m.paymentMethod ?? ''} ${categoryKeyOf(m, categories).name}`)
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function isFilterActive(f: MovementFilter): boolean {
  return Boolean(f.search.trim() || f.kinds.length || f.categoryKeys.length || f.paymentMethods.length || f.status !== 'all')
}
