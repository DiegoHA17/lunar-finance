/**
 * Motor de reglas determinista.
 *
 * Orden total entre reglas que coinciden:
 *   1. prioridad (mayor primero)
 *   2. especificidad: tipo de coincidencia (igual > palabra > empieza por > contiene), longitud del patrón,
 *      número de condiciones
 *   3. fecha de creación (más antigua primero) e ID — solo para ordenar la lista, nunca para decidir un empate
 *      entre categorías distintas.
 *
 * Si las mejores reglas tienen la misma prioridad y la misma especificidad pero apuntan a categorías distintas,
 * el resultado es «ambiguo»: el movimiento queda pendiente y se explica por qué.
 */

import { canAssign, type CategoryIndex } from '../categories'
import type { Cents } from '../money'
import { normalizeKeepAccents, normalizeText, words } from '../text'
import type { Movement, MovementKind } from '../types'

export type MatchType = 'contains' | 'word' | 'startsWith' | 'equals'
export type RuleField = 'description' | 'paymentMethod'

export const MATCH_LABEL: Record<MatchType, string> = {
  contains: 'contiene',
  word: 'contiene la palabra',
  startsWith: 'empieza por',
  equals: 'es exactamente',
}

export const FIELD_LABEL: Record<RuleField, string> = { description: 'Descripción', paymentMethod: 'Método de pago' }

export interface RuleConditions {
  kinds?: MovementKind[]
  minCents?: Cents | null
  maxCents?: Cents | null
  paymentMethod?: string | null
}

export interface Rule {
  id: string
  pattern: string
  field: RuleField
  match: MatchType
  /** Si es `true`, «año» y «ano» son distintos. Por defecto se ignoran los acentos. */
  accentSensitive: boolean
  categoryId: string
  /** Nombre de la categoría al crear la regla, para poder repararla si el ID cambia. */
  categoryName: string
  priority: number
  active: boolean
  conditions: RuleConditions
  /** Si el texto contiene alguna de estas expresiones, la regla no se aplica. */
  exceptions: string[]
  createdAt: string
  source: 'manual' | 'correction'
  note?: string
}

export interface RulesDocument {
  version: 1
  rules: Rule[]
}

export const DEFAULT_PRIORITY = 50
export const MAX_PRIORITY = 1000

const MATCH_RANK: Record<MatchType, number> = { equals: 4, word: 3, startsWith: 2, contains: 1 }

function norm(rule: Pick<Rule, 'accentSensitive'>, s: string | null | undefined): string {
  return rule.accentSensitive ? normalizeKeepAccents(s) : normalizeText(s)
}

function fieldText(rule: Rule, m: Movement): string {
  return norm(rule, rule.field === 'description' ? m.description : m.paymentMethod)
}

function containsWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/** ¿Coincide el texto con el patrón según el tipo de coincidencia? (sin condiciones ni excepciones) */
export function textMatches(rule: Pick<Rule, 'pattern' | 'match' | 'accentSensitive'>, text: string): boolean {
  const p = norm(rule, rule.pattern)
  const t = norm(rule, text)
  if (!p) return false
  switch (rule.match) {
    case 'contains':
      return t.includes(p)
    case 'startsWith':
      return t.startsWith(p)
    case 'equals':
      return t === p
    case 'word':
      return containsWords(words(t), words(p))
  }
}

export function ruleMatches(rule: Rule, m: Movement): boolean {
  if (!rule.active) return false
  const text = fieldText(rule, m)
  if (!textMatches(rule, text)) return false
  for (const ex of rule.exceptions) {
    const e = norm(rule, ex)
    if (e && text.includes(e)) return false
  }
  const c = rule.conditions
  if (c.kinds && c.kinds.length > 0 && (m.kind === null || !c.kinds.includes(m.kind))) return false
  if (c.minCents != null && (m.amountCents === null || m.amountCents < c.minCents)) return false
  if (c.maxCents != null && (m.amountCents === null || m.amountCents > c.maxCents)) return false
  if (c.paymentMethod && normalizeText(c.paymentMethod) !== normalizeText(m.paymentMethod)) return false
  return true
}

function conditionCount(r: Rule): number {
  const c = r.conditions
  return (c.kinds?.length ? 1 : 0) + (c.minCents != null ? 1 : 0) + (c.maxCents != null ? 1 : 0) + (c.paymentMethod ? 1 : 0) + (r.exceptions.length ? 1 : 0)
}

/** Especificidad comparable: mayor es más específica. */
export function specificity(r: Rule): [number, number, number] {
  return [MATCH_RANK[r.match], norm(r, r.pattern).length, conditionCount(r)]
}

function compareTuple(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]
  return 0
}

/** Orden total y estable de reglas. */
export function compareRules(a: Rule, b: Rule): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  const s = compareTuple(specificity(a), specificity(b))
  if (s !== 0) return s
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface SkippedRule {
  rule: Rule
  reason: string
}

export type RuleEvaluation =
  | { status: 'matched'; categoryId: string; rule: Rule; others: Rule[]; skipped: SkippedRule[] }
  | { status: 'ambiguous'; candidates: Rule[]; reason: string; skipped: SkippedRule[] }
  | { status: 'none'; reason: string; skipped: SkippedRule[] }

/** Busca la categoría de una regla por ID y, si ya no existe, por el nombre guardado. */
export function ruleTarget(rule: Rule, categories: CategoryIndex) {
  return categories.get(rule.categoryId) ?? (rule.categoryName ? categories.findByName(rule.categoryName) : undefined)
}

export function evaluateRules(rules: Rule[], m: Movement, categories: CategoryIndex): RuleEvaluation {
  const skipped: SkippedRule[] = []
  const valid: Rule[] = []
  for (const r of rules) {
    if (!ruleMatches(r, m)) continue
    const target = ruleTarget(r, categories)
    const check = canAssign(target, m)
    if (!check.ok) skipped.push({ rule: r, reason: check.reason })
    else valid.push(r)
  }
  if (valid.length === 0) {
    const reason =
      skipped.length > 0
        ? `Hay reglas que coinciden, pero no se pueden aplicar: ${skipped.map((s) => s.reason).join(' ')}`
        : 'Ninguna regla coincide con la descripción.'
    return { status: 'none', reason, skipped }
  }
  const sorted = [...valid].sort(compareRules)
  const top = sorted[0]
  const topTarget = ruleTarget(top, categories)!
  const tied = sorted.filter(
    (r) => r.priority === top.priority && compareTuple(specificity(r), specificity(top)) === 0 && ruleTarget(r, categories)!.id !== topTarget.id,
  )
  if (tied.length > 0) {
    const candidates = [top, ...tied]
    const names = [...new Set(candidates.map((r) => ruleTarget(r, categories)!.name))]
    return {
      status: 'ambiguous',
      candidates,
      reason: `Varias reglas con la misma prioridad proponen categorías distintas (${names.join(', ')}). Ajusta sus prioridades o elige a mano.`,
      skipped,
    }
  }
  return { status: 'matched', categoryId: topTarget.id, rule: top, others: sorted.slice(1), skipped }
}

export interface RuleDraftErrors {
  pattern?: string
  categoryId?: string
  priority?: string
  amount?: string
}

export function validateRule(rule: Rule, categories: CategoryIndex): RuleDraftErrors {
  const errors: RuleDraftErrors = {}
  const p = rule.pattern.trim()
  if (!p) errors.pattern = 'Escribe el texto que se debe detectar.'
  else if (p.length > 100) errors.pattern = 'El texto no puede superar los 100 caracteres.'
  else if (rule.match === 'word' && words(norm(rule, p)).length === 0) errors.pattern = 'El texto debe contener al menos una palabra.'
  const target = categories.get(rule.categoryId)
  if (!target) errors.categoryId = 'Elige una categoría existente.'
  else if (target.status === 'archived') errors.categoryId = `«${target.name}» está archivada.`
  if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > MAX_PRIORITY) {
    errors.priority = `La prioridad debe ser un número entero entre 0 y ${MAX_PRIORITY}.`
  }
  const { minCents, maxCents } = rule.conditions
  if (minCents != null && maxCents != null && minCents > maxCents) errors.amount = 'El importe mínimo es mayor que el máximo.'
  return errors
}

export interface RuleConflict {
  a: Rule
  b: Rule
  kind: 'contradiction' | 'duplicate'
  message: string
}

/**
 * Pares de reglas activas que pueden coincidir con el mismo texto. «Contradicción»: misma prioridad y misma
 * especificidad con categorías distintas (producirían un resultado ambiguo). «Duplicado»: misma regla repetida.
 */
export function detectConflicts(rules: Rule[]): RuleConflict[] {
  const active = rules.filter((r) => r.active)
  const out: RuleConflict[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a.field !== b.field) continue
      const pa = normalizeText(a.pattern)
      const pb = normalizeText(b.pattern)
      const overlap = pa === pb || ((a.match === 'contains' || a.match === 'word') && pb.includes(pa)) || ((b.match === 'contains' || b.match === 'word') && pa.includes(pb))
      if (!overlap) continue
      if (a.categoryId === b.categoryId) {
        if (pa === pb && a.match === b.match) out.push({ a, b, kind: 'duplicate', message: `Las reglas «${a.pattern}» están repetidas.` })
        continue
      }
      if (a.priority === b.priority && compareTuple(specificity(a), specificity(b)) === 0) {
        out.push({
          a,
          b,
          kind: 'contradiction',
          message: `«${a.pattern}» y «${b.pattern}» tienen la misma prioridad y especificidad pero categorías distintas: un movimiento que cumpla ambas quedará pendiente.`,
        })
      }
    }
  }
  return out
}

const STOP_WORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'a', 'al', 'con', 'por', 'para', 'un', 'una', 'compra', 'pago', 'cargo',
  'tarjeta', 'recibo', 'transferencia', 'bizum', 'cobro', 'sl', 'sa', 'slu', 'es', 'www', 'com',
])

/**
 * Propone el texto de una regla a partir de la descripción corregida: la primera palabra significativa
 * (sin números, fechas ni palabras vacías). El usuario puede editarla antes de guardar.
 */
export function suggestPattern(description: string): string {
  const tokens = words(normalizeText(description)).filter((w) => w.length >= 3 && !/\d/.test(w) && !STOP_WORDS.has(w))
  return tokens[0] ?? normalizeText(description).slice(0, 40)
}

export function newRuleId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `r_${rnd}`
}

export function emptyRule(categoryId = '', categoryName = ''): Rule {
  return {
    id: newRuleId(),
    pattern: '',
    field: 'description',
    match: 'word',
    accentSensitive: false,
    categoryId,
    categoryName,
    priority: DEFAULT_PRIORITY,
    active: true,
    conditions: {},
    exceptions: [],
    createdAt: new Date().toISOString(),
    source: 'manual',
  }
}

/** Valida y normaliza un documento de reglas leído de disco (o importado). Descarta lo que no sea válido. */
export function parseRulesDocument(value: unknown): { rules: Rule[]; discarded: number } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as RulesDocument).rules)) return { rules: [], discarded: 0 }
  const rules: Rule[] = []
  let discarded = 0
  const seen = new Set<string>()
  for (const raw of (value as RulesDocument).rules as Partial<Rule>[]) {
    if (
      !raw ||
      typeof raw.id !== 'string' ||
      typeof raw.pattern !== 'string' ||
      typeof raw.categoryId !== 'string' ||
      !['contains', 'word', 'startsWith', 'equals'].includes(raw.match as string) ||
      seen.has(raw.id)
    ) {
      discarded++
      continue
    }
    seen.add(raw.id)
    const c = raw.conditions ?? {}
    const conditions: RuleConditions = {}
    const kinds = Array.isArray(c.kinds) ? c.kinds.filter((k) => ['expense', 'income', 'refund', 'transfer'].includes(k)) : []
    if (kinds.length) conditions.kinds = kinds
    if (Number.isSafeInteger(c.minCents)) conditions.minCents = c.minCents
    if (Number.isSafeInteger(c.maxCents)) conditions.maxCents = c.maxCents
    if (typeof c.paymentMethod === 'string' && c.paymentMethod.trim()) conditions.paymentMethod = c.paymentMethod
    const rule: Rule = {
      id: raw.id,
      pattern: raw.pattern,
      field: raw.field === 'paymentMethod' ? 'paymentMethod' : 'description',
      match: raw.match as MatchType,
      accentSensitive: raw.accentSensitive === true,
      categoryId: raw.categoryId,
      categoryName: typeof raw.categoryName === 'string' ? raw.categoryName : '',
      priority: Number.isInteger(raw.priority) ? Math.min(MAX_PRIORITY, Math.max(0, raw.priority as number)) : DEFAULT_PRIORITY,
      active: raw.active !== false,
      conditions,
      exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.filter((e): e is string => typeof e === 'string') : [],
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      source: raw.source === 'correction' ? 'correction' : 'manual',
    }
    if (typeof raw.note === 'string' && raw.note.trim()) rule.note = raw.note
    rules.push(rule)
  }
  return { rules, discarded }
}
