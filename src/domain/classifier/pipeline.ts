/**
 * Pipeline de clasificación. Hoy solo hay un proveedor (reglas); la interfaz permite añadir más adelante un
 * proveedor de IA local (Ollama) sin cambiar el resto:
 *
 *   1. reglas → si hay coincidencia clara, propuesta de confianza alta;
 *   2. si no hay coincidencia o es ambigua y hay un proveedor de IA habilitado, se le pide una propuesta;
 *   3. toda propuesta se valida (la categoría existe, está activa y es compatible con el tipo);
 *   4. las propuestas de baja confianza siempre requieren confirmación.
 */

import { canAssign, type CategoryIndex } from '../categories'
import type { Movement } from '../types'
import { evaluateRules, type Rule } from './rules'

export interface ClassificationContext {
  categories: CategoryIndex
  rules: Rule[]
}

export type ProposalSource = 'rule' | 'ai'

export interface Proposal {
  movementId: string
  status: 'proposed' | 'ambiguous' | 'none'
  categoryId: string | null
  source: ProposalSource | null
  confidence: 'high' | 'low' | null
  /** Confianza numérica (0–1) que declaró el proveedor de IA. */
  confidenceValue?: number
  /** Explicación para el usuario. */
  reason: string
  ruleId?: string
  needsConfirmation: boolean
}

/** Respuesta cruda de un proveedor antes de validarla. */
export interface ProviderSuggestion {
  categoryId: string
  confidence: number
  reason: string
}

export interface ClassificationProvider {
  readonly id: 'ai'
  readonly label: string
  /** Debe resolver a `null` (no lanzar) si el proveedor no está disponible. */
  suggest(movement: Movement, ctx: ClassificationContext, signal?: AbortSignal): Promise<ProviderSuggestion | null>
}

export const AI_CONFIDENCE_THRESHOLD = 0.8

/** Clasificación solo con reglas (síncrona): la que usa la v1. */
export function classifyWithRules(m: Movement, ctx: ClassificationContext): Proposal {
  const ev = evaluateRules(ctx.rules, m, ctx.categories)
  if (ev.status === 'matched') {
    const cat = ctx.categories.get(ev.categoryId)!
    return {
      movementId: m.id,
      status: 'proposed',
      categoryId: ev.categoryId,
      source: 'rule',
      confidence: 'high',
      reason: `Regla: ${ev.rule.field === 'description' ? 'descripción' : 'método de pago'} ${describeMatch(ev.rule)} → ${cat.name}`,
      ruleId: ev.rule.id,
      needsConfirmation: false,
    }
  }
  return {
    movementId: m.id,
    status: ev.status,
    categoryId: null,
    source: null,
    confidence: null,
    reason: ev.reason,
    needsConfirmation: true,
  }
}

function describeMatch(r: Rule): string {
  const verb = { contains: 'contiene', word: 'contiene la palabra', startsWith: 'empieza por', equals: 'es' }[r.match]
  return `${verb} «${r.pattern}»`
}

/** Valida la propuesta de un proveedor externo con las mismas reglas que una asignación manual. */
export function validateSuggestion(m: Movement, s: ProviderSuggestion, ctx: ClassificationContext, providerLabel: string): Proposal {
  const cat = ctx.categories.get(s.categoryId)
  const check = canAssign(cat, m)
  if (!check.ok || !Number.isFinite(s.confidence)) {
    return {
      movementId: m.id,
      status: 'none',
      categoryId: null,
      source: null,
      confidence: null,
      reason: `${providerLabel} propuso una categoría no válida: ${check.ok ? 'confianza ilegible' : check.reason}`,
      needsConfirmation: true,
    }
  }
  const high = s.confidence >= AI_CONFIDENCE_THRESHOLD
  return {
    movementId: m.id,
    status: 'proposed',
    categoryId: cat!.id,
    source: 'ai',
    confidence: high ? 'high' : 'low',
    confidenceValue: s.confidence,
    reason: `${providerLabel}: ${s.reason.slice(0, 200)}`,
    // Las propuestas de IA siempre se confirman en la v1 del diseño; el umbral solo ordena y resalta.
    needsConfirmation: true,
  }
}

export class ClassificationPipeline {
  private readonly ai: ClassificationProvider | null

  constructor(ai: ClassificationProvider | null = null) {
    this.ai = ai
  }

  async classify(m: Movement, ctx: ClassificationContext, signal?: AbortSignal): Promise<Proposal> {
    const byRules = classifyWithRules(m, ctx)
    if (byRules.status === 'proposed' || !this.ai) return byRules
    try {
      const s = await this.ai.suggest(m, ctx, signal)
      if (!s) return byRules
      return validateSuggestion(m, s, ctx, this.ai.label)
    } catch {
      // Un proveedor caído nunca bloquea la clasificación por reglas.
      return byRules
    }
  }
}
