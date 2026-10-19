import { Pencil, Plus, Trash } from 'lucide-react'
import { cx } from '../ui/cx'
import { useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { FIELD_LABEL, MATCH_LABEL, type Rule, compareRules, detectConflicts, emptyRule, ruleTarget } from '../domain/classifier/rules'
import { formatEUR } from '../domain/money'
import { KIND_LABEL } from '../domain/types'
import { ruleImpact } from '../services/rules'
import { deleteRule, upsertRule } from '../state/actions'
import { useApp } from '../state/store'
import { CategoryLabel, EmptyState, Notice, PageHeader } from '../ui/primitives'
import { DataGate } from './DataGate'
import { RuleDialog } from './RuleDialog'

function conditionsText(r: Rule): string[] {
  const out: string[] = []
  if (r.conditions.kinds?.length) out.push(`solo ${r.conditions.kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(' o ')}`)
  if (r.conditions.minCents != null) out.push(`desde ${formatEUR(r.conditions.minCents)}`)
  if (r.conditions.maxCents != null) out.push(`hasta ${formatEUR(r.conditions.maxCents)}`)
  if (r.conditions.paymentMethod) out.push(`pagado con ${r.conditions.paymentMethod}`)
  if (r.exceptions.length) out.push(`excepto si contiene ${r.exceptions.map((e) => `«${e}»`).join(', ')}`)
  if (r.accentSensitive) out.push('distingue acentos')
  return out
}

export function Rules() {
  const rules = useApp((s) => s.rules)
  const notice = useApp((s) => s.rulesNotice)
  const categories = useApp((s) => s.data.categories)
  const movements = useApp((s) => s.data.movements)
  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const [editing, setEditing] = useState<Rule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const sorted = useMemo(() => [...rules].sort(compareRules), [rules])
  const conflicts = useMemo(() => detectConflicts(rules), [rules])
  const impacts = useMemo(() => new Map(rules.map((r) => [r.id, ruleImpact(r, movements, index)])), [rules, movements, index])

  return (
    <>
      <PageHeader
        title="Reglas de clasificación"
        subtitle="Proponen una categoría para los movimientos que llegan sin ella. Nunca cambian los ya clasificados."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing(emptyRule())} disabled={categories.length === 0}>
            <Plus size={15} /> Nueva regla
          </button>
        }
      />
      <DataGate>
        <div className="flex flex-col gap-4">
          {notice && <Notice kind="warn">{notice}</Notice>}
          {conflicts.length > 0 && (
            <Notice kind="warn">
              <p className="font-medium">Reglas que conviene revisar</p>
              <ul className="mt-1 list-disc pl-4">
                {conflicts.map((c) => (
                  <li key={`${c.a.id}-${c.b.id}`}>{c.message}</li>
                ))}
              </ul>
            </Notice>
          )}
          {sorted.length === 0 ? (
            <EmptyState
              title="Todavía no hay reglas"
              actions={
                <button className="btn btn-primary" onClick={() => setEditing(emptyRule())} disabled={categories.length === 0}>
                  Crear la primera regla
                </button>
              }
            >
              Por ejemplo: si la descripción contiene «mercadona», proponer «Alimentación». También puedes crearlas al corregir la categoría de un movimiento.
            </EmptyState>
          ) : (
            <section className="panel overflow-hidden">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
                <h2 className="text-[15px] font-semibold text-night">Orden de evaluación</h2>
                <span className="text-[12.5px] text-mist">Gana la de mayor prioridad; a igualdad, la más específica.</span>
              </div>
              <ol>
                {sorted.map((r) => {
                  const target = ruleTarget(r, index)
                  const impact = impacts.get(r.id)!
                  const conds = conditionsText(r)
                  return (
                    <li key={r.id} className={cx('flex items-center gap-4 border-b border-line px-4 py-3 last:border-0', !r.active && 'opacity-55')}>
                      <span className="num w-10 shrink-0 text-center text-[13px] text-mist" title="Prioridad">
                        {r.priority}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px]">
                          <span className="text-mist">{FIELD_LABEL[r.field]} {MATCH_LABEL[r.match]}</span> <strong className="font-medium text-ink">«{r.pattern}»</strong>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-mist">
                          {conds.length > 0 && <span>{conds.join(', ')}</span>}
                          {r.source === 'correction' && <span className="chip">creada al corregir</span>}
                          {!target && <span className="text-negative">la categoría ya no existe</span>}
                        </p>
                      </div>
                      <div className="w-48 shrink-0 max-md:hidden">{target ? <CategoryLabel name={target.name} color={target.color} icon={target.icon} status={target.status} /> : <span className="text-negative">—</span>}</div>
                      <div className="num w-28 shrink-0 text-right text-[12.5px] text-mist max-lg:hidden" title="Movimientos que coinciden">
                        {impact.pending.length} pendiente(s)
                        <br />
                        {impact.alreadyClassified.length} ya clasificados
                      </div>
                      <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
                        <input type="checkbox" checked={r.active} onChange={(e) => void upsertRule({ ...r, active: e.target.checked })} />
                        Activa
                      </label>
                      <div className="flex shrink-0 gap-0.5">
                        <button className="btn btn-ghost btn-icon size-7 min-h-7" aria-label={`Editar regla ${r.pattern}`} onClick={() => setEditing(r)}>
                          <Pencil size={14} />
                        </button>
                        {confirmDelete === r.id ? (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={async () => {
                              await deleteRule(r.id)
                              setConfirmDelete(null)
                            }}
                            onBlur={() => setConfirmDelete(null)}
                            autoFocus
                          >
                            Eliminar
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-icon size-7 min-h-7" aria-label={`Eliminar regla ${r.pattern}`} onClick={() => setConfirmDelete(r.id)}>
                            <Trash size={14} />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
          <p className="text-[12.5px] text-mist">
            Las reglas se guardan en este equipo (archivo rules.json en la carpeta de datos de Lunar), no en Notion. Si varias reglas con la misma prioridad y especificidad proponen categorías distintas, el movimiento queda pendiente en lugar de elegirse una al azar.
          </p>
        </div>
      </DataGate>
      {editing && <RuleDialog initial={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
