/** Crear o editar una regla de clasificación, con vista previa de su efecto sobre los movimientos cargados. */

import { useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { FIELD_LABEL, MATCH_LABEL, MAX_PRIORITY, type MatchType, type Rule, type RuleField, textMatches, validateRule } from '../domain/classifier/rules'
import { parseAmountInput, formatDecimal } from '../domain/money'
import { KIND_LABEL, type MovementKind } from '../domain/types'
import { ruleImpact } from '../services/rules'
import { upsertRule } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Dialog, Field, Notice } from '../ui/primitives'

const KINDS: MovementKind[] = ['expense', 'income', 'refund']

export function RuleDialog({ initial, onClose, title }: { initial: Rule; onClose: () => void; title?: string }) {
  const categories = useApp((s) => s.data.categories)
  const movements = useApp((s) => s.data.movements)
  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const [rule, setRule] = useState<Rule>(initial)
  const [exceptions, setExceptions] = useState(initial.exceptions.join(', '))
  const [min, setMin] = useState(initial.conditions.minCents != null ? formatDecimal(initial.conditions.minCents) : '')
  const [max, setMax] = useState(initial.conditions.maxCents != null ? formatDecimal(initial.conditions.maxCents) : '')
  const [test, setTest] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const minCents = min.trim() ? parseAmountInput(min) : null
  const maxCents = max.trim() ? parseAmountInput(max) : null
  const amountError = (min.trim() && minCents === null) || (max.trim() && maxCents === null) ? 'Escribe importes válidos, por ejemplo 12,50.' : undefined

  const candidate: Rule = useMemo(
    () => ({
      ...rule,
      pattern: rule.pattern.trim(),
      exceptions: exceptions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      conditions: {
        ...(rule.conditions.kinds?.length ? { kinds: rule.conditions.kinds } : {}),
        ...(minCents != null ? { minCents } : {}),
        ...(maxCents != null ? { maxCents } : {}),
        ...(rule.conditions.paymentMethod?.trim() ? { paymentMethod: rule.conditions.paymentMethod.trim() } : {}),
      },
    }),
    [rule, exceptions, minCents, maxCents],
  )
  const errors = validateRule(candidate, index)
  const valid = Object.keys(errors).length === 0 && !amountError
  const impact = useMemo(() => (candidate.pattern ? ruleImpact(candidate, movements, index) : null), [candidate, movements, index])
  const target = index.get(candidate.categoryId)

  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setRule((r) => ({ ...r, [k]: v }))

  async function save() {
    setSubmitted(true)
    if (!valid) return
    setSaving(true)
    const ok = await upsertRule({ ...candidate, categoryName: target?.name ?? candidate.categoryName })
    setSaving(false)
    if (ok) onClose()
  }

  const methods = useMemo(() => [...new Set(movements.map((m) => m.paymentMethod).filter((x): x is string => Boolean(x)))].sort(), [movements])

  return (
    <Dialog
      open
      onClose={onClose}
      title={title ?? (initial.pattern ? 'Editar regla' : 'Nueva regla')}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar regla'}
          </button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[150px_170px_1fr] gap-2 max-sm:grid-cols-1">
            <Field label="Si" htmlFor="rule-field">
              <select id="rule-field" className="field" value={rule.field} onChange={(e) => set('field', e.target.value as RuleField)}>
                {(Object.keys(FIELD_LABEL) as RuleField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABEL[f].toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Coincidencia" htmlFor="rule-match">
              <select id="rule-match" className="field" value={rule.match} onChange={(e) => set('match', e.target.value as MatchType)}>
                {(Object.keys(MATCH_LABEL) as MatchType[]).map((m) => (
                  <option key={m} value={m}>
                    {MATCH_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Texto" htmlFor="rule-pattern" error={submitted ? errors.pattern : undefined}>
              <input id="rule-pattern" className="field" value={rule.pattern} onChange={(e) => set('pattern', e.target.value)} placeholder="mercadona" autoFocus aria-invalid={submitted && Boolean(errors.pattern)} />
            </Field>
          </div>
          <Field label="Entonces, categoría" htmlFor="rule-cat" error={submitted ? errors.categoryId : undefined}>
            <CategorySelect id="rule-cat" value={rule.categoryId || null} kind={null} categories={categories} noneLabel="Elige una categoría" onChange={(id) => set('categoryId', id ?? '')} />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Prioridad" htmlFor="rule-priority" error={submitted ? errors.priority : undefined} hint="Si varias reglas coinciden, gana la de mayor prioridad.">
              <input id="rule-priority" type="number" min={0} max={MAX_PRIORITY} step={1} className="field num" value={rule.priority} onChange={(e) => set('priority', Number(e.target.value))} />
            </Field>
            <Field label="Excepciones" htmlFor="rule-ex" hint="Si el texto contiene alguna, no se aplica. Separadas por comas.">
              <input id="rule-ex" className="field" value={exceptions} onChange={(e) => setExceptions(e.target.value)} placeholder="prime, devolución" />
            </Field>
          </div>
          <details className="rounded-lg border border-line px-3 py-2" open={Boolean(rule.conditions.kinds?.length || min || max || rule.conditions.paymentMethod)}>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Condiciones adicionales</summary>
            <div className="mt-3 flex flex-col gap-3 pb-1">
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-1 text-[13px] text-ink-2">Solo para</legend>
                {KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={rule.conditions.kinds?.includes(k) ?? false}
                      onChange={(e) => {
                        const kinds = new Set(rule.conditions.kinds ?? [])
                        if (e.target.checked) kinds.add(k)
                        else kinds.delete(k)
                        set('conditions', { ...rule.conditions, kinds: [...kinds] })
                      }}
                    />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                <Field label="Importe mínimo (€)" htmlFor="rule-min" error={submitted ? amountError || errors.amount : undefined}>
                  <input id="rule-min" className="field num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
                </Field>
                <Field label="Importe máximo (€)" htmlFor="rule-max">
                  <input id="rule-max" className="field num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
                </Field>
                <Field label="Método de pago" htmlFor="rule-pm">
                  <input id="rule-pm" className="field" list="rule-pm-list" value={rule.conditions.paymentMethod ?? ''} onChange={(e) => set('conditions', { ...rule.conditions, paymentMethod: e.target.value })} />
                  <datalist id="rule-pm-list">
                    {methods.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" checked={rule.accentSensitive} onChange={(e) => set('accentSensitive', e.target.checked)} />
                Distinguir acentos (por defecto «cafe» y «café» coinciden)
              </label>
            </div>
          </details>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={rule.active} onChange={(e) => set('active', e.target.checked)} />
            Regla activa
          </label>
        </div>

        <aside className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4 text-[13px]">
          <h3 className="font-semibold text-ink">Efecto de la regla</h3>
          {impact ? (
            <>
              <p className="text-ink-2">
                Propondría <strong className="text-ink">{target?.name ?? 'una categoría'}</strong> para <strong className="num text-ink">{impact.pending.length}</strong> movimiento(s) sin categoría.
              </p>
              {impact.conflicting.length > 0 && (
                <Notice kind="info">
                  {impact.conflicting.length} movimiento(s) ya clasificados de otra forma también coinciden. <strong>No se cambiarán</strong>: las reglas solo proponen categoría a los pendientes.
                </Notice>
              )}
              {impact.pending.slice(0, 5).map((m) => (
                <div key={m.id} className="truncate text-mist">
                  {m.description}
                </div>
              ))}
            </>
          ) : (
            <p className="text-mist">Escribe un texto para ver a qué movimientos afectaría.</p>
          )}
          <div className="mt-auto flex flex-col gap-1">
            <label htmlFor="rule-test" className="text-ink-2">
              Probar con un texto
            </label>
            <input id="rule-test" className="field" value={test} onChange={(e) => setTest(e.target.value)} placeholder="Compra MERCADONA 1234" />
            {test && (
              <p className={textMatches(candidate, test) ? 'text-positive' : 'text-mist'}>{textMatches(candidate, test) ? 'Coincide (sin contar condiciones)' : 'No coincide'}</p>
            )}
          </div>
        </aside>
      </div>
    </Dialog>
  )
}
