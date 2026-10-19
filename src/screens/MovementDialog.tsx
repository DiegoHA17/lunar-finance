/** Crear un movimiento nuevo o editar uno existente (se guarda en Notion). */

import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CategoryIndex, canAssign } from '../domain/categories'
import { classifyWithRules } from '../domain/classifier/pipeline'
import { isValidISODate, today } from '../domain/dates'
import { formatDecimal, parseAmountInput } from '../domain/money'
import { KIND_LABEL, type Movement, type MovementKind } from '../domain/types'
import type { MovementDraft } from '../infra/mapping'
import { createMovement, openNotion, saveMovement } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Dialog, Field, Notice } from '../ui/primitives'

const KINDS: MovementKind[] = ['expense', 'income', 'refund', 'transfer']

export function MovementDialog({ movement, onClose }: { movement: Movement | null; onClose: () => void }) {
  const categories = useApp((s) => s.data.categories)
  const rules = useApp((s) => s.rules)
  const movements = useApp((s) => s.data.movements)
  const config = useApp((s) => s.config)
  const index = useMemo(() => new CategoryIndex(categories), [categories])

  const [description, setDescription] = useState(movement?.description ?? '')
  const [date, setDate] = useState(movement?.date ?? today())
  const [amount, setAmount] = useState(movement?.amountCents != null ? formatDecimal(movement.amountCents) : '')
  const [kind, setKind] = useState<MovementKind>(movement?.kind ?? 'expense')
  const [categoryId, setCategoryId] = useState<string | null>(movement?.categoryId ?? null)
  const [paymentMethod, setPaymentMethod] = useState(movement?.paymentMethod ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState(false)

  const amountCents = parseAmountInput(amount)
  const category = categoryId ? (index.get(categoryId) ?? null) : null
  const errors: Partial<Record<'description' | 'date' | 'amount' | 'category', string>> = {}
  if (!description.trim()) errors.description = 'La descripción es obligatoria.'
  if (!isValidISODate(date)) errors.date = 'La fecha no es válida.'
  if (amountCents === null || amountCents <= 0) errors.amount = 'Escribe un importe positivo, por ejemplo 12,50. El sentido lo indica el tipo.'
  const categoryChanged = categoryId !== (movement?.categoryId ?? null)
  if (category && categoryChanged) {
    const check = canAssign(category, { kind })
    if (!check.ok) errors.category = check.reason
  }
  const valid = Object.keys(errors).length === 0

  // Sugerencia por reglas mientras se escribe (solo si aún no hay categoría elegida).
  const suggestion = useMemo(() => {
    if (categoryId || !description.trim() || kind === 'transfer') return null
    const p = classifyWithRules(
      { id: 'draft', url: null, description, date, amountCents, kind, rawKind: null, categoryLink: null, categoryId: null, paymentMethod: paymentMethod || null, origin: 'unknown', issues: [], createdTime: '', lastEditedTime: '' },
      { categories: index, rules },
    )
    return p.status === 'proposed' ? index.get(p.categoryId) : null
  }, [categoryId, description, date, amountCents, kind, paymentMethod, index, rules])

  const methods = useMemo(() => [...new Set(movements.map((m) => m.paymentMethod).filter((x): x is string => Boolean(x)))].sort(), [movements])
  const multiMethod = config.notion.movements?.fields.paymentMethod?.kind === 'multi_select'

  async function save(allowDuplicate = false) {
    setSubmitted(true)
    if (!valid || amountCents === null) return
    setSaving(true)
    if (!movement) {
      const draft: MovementDraft = { description: description.trim(), date, amountCents, kind, category: kind === 'transfer' ? null : category, paymentMethod: paymentMethod.trim() || null }
      const r = await createMovement(draft, allowDuplicate)
      setSaving(false)
      if (r === 'duplicate') setDuplicate(true)
      if (r === 'ok') onClose()
      return
    }
    // Edición: solo se envían los campos que han cambiado.
    const patch: Partial<MovementDraft> = {}
    if (description.trim() !== movement.description) patch.description = description.trim()
    if (date !== movement.date) patch.date = date
    if (amountCents !== movement.amountCents) patch.amountCents = amountCents
    if (kind !== movement.kind) patch.kind = kind
    if (categoryChanged) patch.category = category
    if (!multiMethod && (paymentMethod.trim() || null) !== movement.paymentMethod) patch.paymentMethod = paymentMethod.trim() || null
    if (Object.keys(patch).length === 0) {
      setSaving(false)
      onClose()
      return
    }
    const ok = await saveMovement(movement, patch)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={movement ? 'Editar movimiento' : 'Nuevo movimiento'}
      footer={
        <>
          {movement?.url && (
            <button className="btn btn-ghost mr-auto text-mist" onClick={() => void openNotion(movement.url)}>
              <ExternalLink size={14} /> Abrir en Notion
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          {duplicate ? (
            <button className="btn btn-primary" onClick={() => void save(true)} disabled={saving}>
              Crear igualmente
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Guardando en Notion…' : movement ? 'Guardar cambios' : 'Crear movimiento'}
            </button>
          )}
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save(duplicate)
        }}
      >
        {movement && movement.issues.length > 0 && (
          <Notice kind="warn">
            <ul className="list-disc pl-4">
              {movement.issues.map((i) => (
                <li key={i.code}>{i.message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {duplicate && <Notice kind="warn">Ya existe uno igual (fecha, importe, tipo y descripción).</Notice>}
        <Field label="Descripción" htmlFor="mv-desc" error={submitted ? errors.description : undefined}>
          <input id="mv-desc" className="field" value={description} onChange={(e) => (setDescription(e.target.value), setDuplicate(false))} autoFocus aria-invalid={submitted && Boolean(errors.description)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" htmlFor="mv-date" error={submitted ? errors.date : undefined}>
            <input id="mv-date" type="date" className="field" value={date} onChange={(e) => (setDate(e.target.value), setDuplicate(false))} />
          </Field>
          <Field label="Importe (€)" htmlFor="mv-amount" error={submitted ? errors.amount : undefined}>
            <input id="mv-amount" className="field num text-right" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => (setAmount(e.target.value), setDuplicate(false))} aria-invalid={submitted && Boolean(errors.amount)} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Tipo</legend>
          <div className="seg" role="group">
            {KINDS.map((k) => (
              <button type="button" key={k} aria-pressed={kind === k} onClick={() => (setKind(k), setDuplicate(false))}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {kind === 'transfer' && <p className="mt-1 text-xs text-mist">No cuenta como gasto ni ingreso.</p>}
        </fieldset>
        {kind !== 'transfer' && (
          <Field label="Categoría" htmlFor="mv-cat" error={submitted ? errors.category : undefined}>
            <CategorySelect id="mv-cat" value={categoryId} kind={kind} categories={categories} onChange={setCategoryId} />
            {suggestion && (
              <button type="button" className="mt-1 self-start text-[12.5px] text-accent hover:underline" onClick={() => setCategoryId(suggestion.id)}>
                Sugerencia: {suggestion.name}
              </button>
            )}
          </Field>
        )}
        <Field label="Método de pago" htmlFor="mv-pm" hint={multiMethod ? 'Esta propiedad es de selección múltiple: edítala en Notion.' : undefined}>
          <input id="mv-pm" className="field" list="mv-pm-list" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={multiMethod} />
          <datalist id="mv-pm-list">
            {methods.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
