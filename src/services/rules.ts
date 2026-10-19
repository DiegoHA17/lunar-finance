/** Persistencia y utilidades de las reglas de clasificación (documento local `rules.json`). */

import type { CategoryIndex } from '../domain/categories'
import { DEFAULT_PRIORITY, type Rule, newRuleId, parseRulesDocument, ruleMatches, ruleTarget, suggestPattern } from '../domain/classifier/rules'
import { needsClassification } from '../domain/movements'
import { type Category, type Movement, isCounted } from '../domain/types'
import type { Backend } from '../infra/backend'

export async function loadRules(backend: Backend): Promise<{ rules: Rule[]; discarded: number }> {
  return parseRulesDocument(await backend.readStore('rules'))
}

export async function saveRules(backend: Backend, rules: Rule[]): Promise<void> {
  await backend.writeStore('rules', { version: 1, rules })
}

/**
 * Actualiza el ID de categoría de las reglas cuyo destino solo se encuentra por nombre (p. ej. tras crear el
 * catálogo en Notion, cuando los IDs implícitos pasan a ser IDs de página). Devuelve `changed` si hay que guardar.
 */
export function repairRuleTargets(rules: Rule[], index: CategoryIndex): { rules: Rule[]; changed: boolean } {
  let changed = false
  const out = rules.map((r) => {
    const target = ruleTarget(r, index)
    if (target && (target.id !== r.categoryId || target.name !== r.categoryName)) {
      changed = true
      return { ...r, categoryId: target.id, categoryName: target.name }
    }
    return r
  })
  return { rules: out, changed }
}

/** Regla propuesta a partir de una corrección manual. El usuario la revisa antes de guardarla. */
export function ruleFromCorrection(m: Movement, category: Category): Rule {
  const pattern = suggestPattern(m.description)
  return {
    id: newRuleId(),
    pattern,
    field: 'description',
    match: pattern.includes(' ') ? 'contains' : 'word',
    accentSensitive: false,
    categoryId: category.id,
    categoryName: category.name,
    priority: DEFAULT_PRIORITY,
    active: true,
    conditions: m.kind ? { kinds: m.kind === 'refund' ? ['expense', 'refund'] : [m.kind] } : {},
    exceptions: [],
    createdAt: new Date().toISOString(),
    source: 'correction',
  }
}

export interface RuleImpact {
  /** Movimientos pendientes a los que la regla propondría categoría. */
  pending: Movement[]
  /** Movimientos ya clasificados que también coinciden (NO se cambian automáticamente). */
  alreadyClassified: Movement[]
  /** De esos, los que tienen otra categoría distinta. */
  conflicting: Movement[]
}

export function ruleImpact(rule: Rule, movements: Movement[], index: CategoryIndex): RuleImpact {
  const target = ruleTarget(rule, index)
  const matching = movements.filter((m) => ruleMatches({ ...rule, active: true }, m))
  // Mismo criterio que la revisión en lote: solo pendientes incluidos en los totales.
  const pending = matching.filter((m) => needsClassification(m) && isCounted(m))
  const alreadyClassified = matching.filter((m) => !needsClassification(m) && m.categoryLink !== null)
  const conflicting = alreadyClassified.filter((m) => m.categoryId !== target?.id)
  return { pending, alreadyClassified, conflicting }
}
