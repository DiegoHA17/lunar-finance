/** Pagos periódicos: reglas, pagos pendientes de confirmar y alta de la propiedad «Pago periódico». */

import { Pause, Pencil, Play, Plus, Trash } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { formatDateLong, today } from '../domain/dates'
import { MODE_LABEL, type PlanItem, type RecurringRule, nextOccurrence, scheduleLabel } from '../domain/recurring'
import { KIND_LABEL, type MovementKind } from '../domain/types'
import { recurrencePropertyPlan } from '../services/migration'
import {
  applyRecurrenceMigration,
  approveOccurrences,
  deleteRecurringRule,
  loadRecurringState,
  relinkRecurring,
  setRecurringActive,
  skipOccurrences,
} from '../state/actions'
import { useApp } from '../state/store'
import { cx } from '../ui/cx'
import { CategoryLabel, EmptyState, Money, Notice, PageHeader, Spinner } from '../ui/primitives'
import { DataGate } from './DataGate'
import { RecurringDialog } from './RecurringDialog'

function signed(cents: number, kind: MovementKind): number {
  return kind === 'expense' ? -cents : cents
}

function PropertySetup() {
  const config = useApp((s) => s.config)
  const plan = recurrencePropertyPlan(config)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!plan) return null
  return (
    <section className="panel px-5 py-4 text-[13.5px]">
      <p className="font-medium">Para registrar pagos en Notion falta un paso</p>
      <p className="mt-0.5 text-ink-2">Puedes crear y revisar pagos periódicos, pero no se registrará ninguno hasta añadir esta propiedad.</p>
      <ul className="mt-2 list-disc pl-5 text-ink-2">
        {[...plan.changes, ...plan.consequences].map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        {confirm ? (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await applyRecurrenceMigration()
                setBusy(false)
                setConfirm(false)
              }}
            >
              {busy ? <Spinner /> : null} Sí, añadir la propiedad
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>
            Añadir la propiedad en Notion…
          </button>
        )}
      </div>
    </section>
  )
}

function PendingList({ items, blocked, busy }: { items: PlanItem[]; blocked: boolean; busy: boolean }) {
  const [working, setWorking] = useState(false)
  const clean = items.filter((i) => !i.warning)
  async function run(fn: () => Promise<unknown>) {
    setWorking(true)
    await fn()
    setWorking(false)
  }
  const disabled = blocked || busy || working
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold text-night">Pendientes de registrar ({items.length})</h2>
        {clean.length > 1 && (
          <button className="btn btn-sm" disabled={disabled} onClick={() => void run(() => approveOccurrences(clean))}>
            Registrar los {clean.length} sin avisos
          </button>
        )}
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
            <span className="num w-28 shrink-0 text-[13px] text-ink-2">{formatDateLong(it.draft.date)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">{it.draft.description}</p>
              <p className="text-[12.5px] text-mist">
                {KIND_LABEL[it.draft.kind]}
                {it.draft.categoryName ? ` · ${it.draft.categoryName}` : ''}
                {it.action === 'auto' ? ' · se registrará al sincronizar' : ''}
              </p>
              {it.warning && <p className="text-[12.5px] text-warn">{it.warning}</p>}
            </div>
            <Money cents={signed(it.draft.amountCents, it.draft.kind)} signed={it.draft.kind !== 'transfer'} className="w-28 shrink-0 text-right" />
            <div className="flex shrink-0 gap-1.5">
              <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => void run(() => approveOccurrences([it]))}>
                {it.uncertain ? 'Registrar de nuevo' : 'Registrar'}
              </button>
              <button className="btn btn-sm" disabled={busy || working} onClick={() => void run(() => skipOccurrences([it]))}>
                {it.uncertain ? 'Ya está en Notion' : 'Omitir'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RuleRow({ rule, onEdit }: { rule: RecurringRule; onEdit: () => void }) {
  const ledger = useApp((s) => s.recurring.doc?.ledger ?? {})
  const categories = useApp((s) => s.data.categories)
  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const next = nextOccurrence(rule, ledger)
  const cat = rule.categoryId ? (index.get(rule.categoryId) ?? (rule.categoryName ? index.findByName(rule.categoryName) : undefined)) : undefined
  return (
    <li className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0', !rule.active && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{rule.description}</p>
        <p className="text-[12.5px] text-mist">
          {scheduleLabel(rule)} · {MODE_LABEL[rule.mode]}
          {rule.paymentMethod ? ` · ${rule.paymentMethod}` : ''}
        </p>
      </div>
      <div className="w-44 shrink-0 max-md:hidden">
        {cat ? <CategoryLabel name={cat.name} color={cat.color} icon={cat.icon} status={cat.status} /> : <span className="text-[13px] text-mist">{rule.categoryName ?? (rule.kind === 'transfer' ? 'Transferencia' : 'Sin categoría')}</span>}
      </div>
      <Money cents={signed(rule.amountCents, rule.kind)} signed={rule.kind !== 'transfer'} className="w-24 shrink-0 text-right" />
      <div className="w-40 shrink-0 text-[12.5px] text-ink-2">
        {!rule.active ? 'En pausa' : next ? <>Próximo: {next < today() ? <span className="text-warn">{formatDateLong(next)} (vencido)</span> : formatDateLong(next)}</> : '—'}
      </div>
      <div className="flex shrink-0 gap-0.5">
        <button className="btn btn-ghost btn-icon size-7 min-h-7" aria-label={`Editar ${rule.description}`} title="Editar" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon size-7 min-h-7"
          aria-label={rule.active ? `Pausar ${rule.description}` : `Reanudar ${rule.description}`}
          title={rule.active ? 'Pausar' : 'Reanudar desde hoy'}
          onClick={() => void setRecurringActive(rule.id, !rule.active)}
        >
          {rule.active ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {confirmDelete ? (
          <button className="btn btn-sm btn-danger" onClick={() => void deleteRecurringRule(rule.id)} onBlur={() => setConfirmDelete(false)} autoFocus>
            Eliminar
          </button>
        ) : (
          <button className="btn btn-ghost btn-icon size-7 min-h-7" aria-label={`Eliminar ${rule.description}`} title="Eliminar" onClick={() => setConfirmDelete(true)}>
            <Trash size={14} />
          </button>
        )}
      </div>
    </li>
  )
}

export function Recurring() {
  const recurring = useApp((s) => s.recurring)
  const config = useApp((s) => s.config)
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null)

  useEffect(() => {
    void loadRecurringState()
  }, [])

  const rules = recurring.doc?.rules ?? []
  const plan = recurring.plan
  const mismatch = Boolean(recurring.doc?.dataSourceId && recurring.doc.dataSourceId !== config.notion.movements?.dataSourceId)

  return (
    <>
      <PageHeader
        title="Pagos periódicos"
        subtitle="Gastos e ingresos que se repiten. Se registran en Notion al abrir o sincronizar Lunar Finance."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!recurring.doc}>
            <Plus size={15} /> Nuevo pago periódico
          </button>
        }
      />
      <DataGate>
        <div className="flex flex-col gap-4">
          {recurring.error && <Notice kind="error">{recurring.error.message}{recurring.error.hint ? ` ${recurring.error.hint}` : ''}</Notice>}
          <PropertySetup />
          {plan?.blocked && config.notion.movements?.fields.recurrence && (
            <Notice
              kind="warn"
              actions={
                mismatch ? (
                  <button className="btn btn-sm" onClick={() => void relinkRecurring()}>
                    Usar la base actual
                  </button>
                ) : undefined
              }
            >
              {plan.blocked}
            </Notice>
          )}
          {plan && plan.repeatedKeys.length > 0 && (
            <Notice kind="warn">
              {plan.repeatedKeys.length === 1 ? 'Un pago periódico aparece' : `${plan.repeatedKeys.length} pagos periódicos aparecen`} más de una vez en Notion. Revisa los
              movimientos duplicados; Lunar Finance no los borra.
            </Notice>
          )}
          {plan && plan.items.length > 0 && <PendingList items={plan.items} blocked={Boolean(plan.blocked)} busy={recurring.busy} />}
          {recurring.doc && rules.length === 0 ? (
            <EmptyState
              title="Todavía no hay pagos periódicos"
              actions={
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  Crear el primero
                </button>
              }
            >
              Alquiler, suscripciones, nómina… Elige si se registran solos o tras tu confirmación.
            </EmptyState>
          ) : (
            rules.length > 0 && (
              <section className="panel overflow-hidden">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-[15px] font-semibold text-night">Reglas ({rules.length})</h2>
                </div>
                <ul>
                  {[...rules]
                    .sort((a, b) => Number(b.active) - Number(a.active) || a.description.localeCompare(b.description, 'es'))
                    .map((r) => (
                      <RuleRow key={r.id} rule={r} onEdit={() => setEditing(r)} />
                    ))}
                </ul>
              </section>
            )
          )}
        </div>
      </DataGate>
      {editing && <RecurringDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
