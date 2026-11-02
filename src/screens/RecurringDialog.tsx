/** Crear o editar un pago periódico (se guarda en el equipo; los movimientos se registran en Notion). */

import { useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { isValidISODate, today } from '../domain/dates'
import { formatDecimal, parseAmountInput } from '../domain/money'
import { FREQUENCY_LABEL, type Frequency, MODE_LABEL, type RecurringMode, type RecurringRule, scheduleLabel } from '../domain/recurring'
import { KIND_LABEL, type MovementKind } from '../domain/types'
import { type RecurringInput, validateRecurringInput } from '../services/recurring'
import { saveRecurringRule } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Dialog, Field, Notice } from '../ui/primitives'

const KINDS: MovementKind[] = ['expense', 'income', 'refund', 'transfer']
const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'yearly']
const MODES: RecurringMode[] = ['confirm', 'auto']

export function RecurringDialog({ rule, onClose }: { rule: RecurringRule | null; onClose: () => void }) {
  const categories = useApp((s) => s.data.categories)
  const movements = useApp((s) => s.data.movements)
  const doc = useApp((s) => s.recurring.doc)
  const index = useMemo(() => new CategoryIndex(categories), [categories])

  const [description, setDescription] = useState(rule?.description ?? '')
  const [amount, setAmount] = useState(rule ? formatDecimal(rule.amountCents) : '')
  const [kind, setKind] = useState<MovementKind>(rule?.kind ?? 'expense')
  const [categoryId, setCategoryId] = useState<string | null>(rule ? (rule.categoryId ?? (rule.categoryName ? (index.findByName(rule.categoryName)?.id ?? null) : null)) : null)
  // Si la categoría de la regla ya no existe, se conserva la referencia (y su aviso) hasta que el usuario elija otra.
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState(rule?.paymentMethod ?? '')
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(rule?.startDate ?? today())
  const [mode, setMode] = useState<RecurringMode>(rule?.mode ?? 'confirm')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const amountCents = parseAmountInput(amount)
  const category = categoryId ? (index.get(categoryId) ?? null) : null
  const input: RecurringInput = {
    description,
    amountCents: amountCents ?? 0,
    kind,
    categoryId: kind === 'transfer' ? null : rule && !categoryTouched && !category ? rule.categoryId : (category?.id ?? null),
    categoryName: kind === 'transfer' ? null : rule && !categoryTouched && !category ? rule.categoryName : (category?.name ?? null),
    paymentMethod: paymentMethod.trim() || null,
    frequency,
    startDate,
    mode,
  }
  const error = doc ? validateRecurringInput(input, rule, doc, index) : null
  const methods = useMemo(() => [...new Set(movements.map((m) => m.paymentMethod).filter((x): x is string => Boolean(x)))].sort(), [movements])
  const scheduleChanged = rule && (rule.startDate !== startDate || rule.frequency !== frequency)

  async function save() {
    setSubmitted(true)
    if (error) return
    setSaving(true)
    const ok = await saveRecurringRule(input, rule?.id ?? null)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? 'Editar pago periódico' : 'Nuevo pago periódico'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Guardando…' : rule ? 'Guardar cambios' : 'Crear pago periódico'}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {submitted && error && <Notice kind="error">{error}</Notice>}
        {rule && <Notice>Los cambios solo afectan a los pagos que aún no se han registrado. Los movimientos ya creados en Notion no se modifican.</Notice>}
        <Field label="Descripción" htmlFor="rp-desc">
          <input id="rp-desc" className="field" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Importe (€)" htmlFor="rp-amount">
            <input id="rp-amount" className="field num text-right" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Método de pago" htmlFor="rp-pm">
            <input id="rp-pm" className="field" list="rp-pm-list" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
            <datalist id="rp-pm-list">
              {methods.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Tipo</legend>
          <div className="seg" role="group">
            {KINDS.map((k) => (
              <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>
        {kind !== 'transfer' && (
          <Field label="Categoría" htmlFor="rp-cat">
            <CategorySelect
              id="rp-cat"
              value={categoryId}
              kind={kind}
              categories={categories}
              onChange={(id) => (setCategoryId(id), setCategoryTouched(true))}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Frecuencia</legend>
            <div className="seg" role="group">
              {FREQUENCIES.map((f) => (
                <button type="button" key={f} aria-pressed={frequency === f} onClick={() => setFrequency(f)}>
                  {FREQUENCY_LABEL[f]}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={rule ? 'Fecha del próximo pago' : 'Fecha del primer pago'} htmlFor="rp-start" hint={isValidISODate(startDate) ? scheduleLabel({ frequency, startDate }) : undefined}>
            <input id="rp-start" type="date" className="field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        {scheduleChanged && <p className="-mt-2 text-xs text-mist">El nuevo calendario empieza en esa fecha; las fechas anteriores a hoy necesitarán tu confirmación.</p>}
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Registro</legend>
          <div className="seg" role="group">
            {MODES.map((m) => (
              <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-mist">
            {mode === 'auto'
              ? 'Al abrir o sincronizar Lunar Finance, los pagos vencidos se registran solos en Notion. Los anteriores a hoy siempre piden confirmación.'
              : 'Los pagos vencidos aparecen en «Pendientes de registrar» hasta que los confirmes u omitas.'}
          </p>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
