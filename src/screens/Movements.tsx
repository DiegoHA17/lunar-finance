import { Download, Pencil, Plus, Search, TriangleAlert, WandSparkles } from 'lucide-react'
import { cx } from '../ui/cx'
import { useMemo, useState } from 'react'
import { CategoryIndex, sortCategories } from '../domain/categories'
import type { Rule } from '../domain/classifier/rules'
import { formatDateES } from '../domain/dates'
import { EMPTY_FILTER, type MovementFilter, type StatusFilter, applyFilter, isFilterActive } from '../domain/filters'
import { needsClassification, sortMovements } from '../domain/movements'
import { periodLabel, periodSlug } from '../domain/periods'
import { UNCATEGORIZED_KEY, categoryKeyOf, computeTotals, signedCents } from '../domain/stats'
import { KIND_LABEL, type Movement, type MovementKind, isCounted } from '../domain/types'
import { ruleFromCorrection } from '../services/rules'
import { exportCsv } from '../services/reports'
import { assignCategory, exportWithHost, setPeriod, toast } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { PeriodPicker } from '../ui/PeriodPicker'
import { EmptyState, Money, PageHeader } from '../ui/primitives'
import { ClassifyDialog } from './ClassifyDialog'
import { useYears } from '../state/hooks'
import { DataGate } from './DataGate'
import { MovementDialog } from './MovementDialog'
import { RuleDialog } from './RuleDialog'

const PAGE = 100

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Sin categoría' },
  { value: 'issues', label: 'Con avisos' },
  { value: 'excluded', label: 'Fuera de los totales' },
  { value: 'duplicates', label: 'Posibles duplicados' },
]

function Summary({ list }: { list: Movement[] }) {
  const t = computeTotals(list)
  const item = (label: string, value: React.ReactNode) => (
    <span className="flex items-baseline gap-1.5">
      <span className="text-mist">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]" aria-label="Totales de la selección">
      {item('Movimientos', <span className="num">{list.length}</span>)}
      {item('Gasto neto', <Money cents={t.netExpenseCents} />)}
      {item('Ingresos', <Money cents={t.incomeCents} />)}
      {item('Balance', <Money cents={t.balanceCents} signed tone="auto" />)}
      {t.excludedCount > 0 && item('Fuera de totales', <span className="num text-warn">{t.excludedCount}</span>)}
    </div>
  )
}

export function Movements() {
  const movements = useApp((s) => s.data.movements)
  const categories = useApp((s) => s.data.categories)
  const period = useApp((s) => s.period)
  const nav = useApp((s) => s.movementsNav)
  const mode = useApp((s) => s.mode)
  const years = useYears()
  const index = useMemo(() => new CategoryIndex(categories), [categories])

  const [allDates, setAllDates] = useState(false)
  const [filter, setFilter] = useState<MovementFilter>(EMPTY_FILTER)
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<Movement | null | 'new'>(null)
  const [classifying, setClassifying] = useState(false)
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Filtro solicitado desde otra pantalla (dashboard, categorías): estado derivado, aplicado una vez por petición.
  const [navSeen, setNavSeen] = useState<number | null>(null)
  if (nav && nav.nonce !== navSeen) {
    setNavSeen(nav.nonce)
    setFilter({ ...EMPTY_FILTER, categoryKeys: nav.categoryKey ? [nav.categoryKey] : [], status: nav.status ?? 'all' })
    setLimit(PAGE)
  }

  const effective = useMemo(() => ({ ...filter, period: allDates ? null : period }), [filter, allDates, period])
  const list = useMemo(() => sortMovements(applyFilter(movements, effective, index)), [movements, effective, index])
  const pendingAll = useMemo(() => movements.filter((m) => needsClassification(m) && isCounted(m)).length, [movements])
  const methods = useMemo(() => [...new Set(movements.map((m) => m.paymentMethod).filter((x): x is string => Boolean(x)))].sort(), [movements])
  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of movements) {
      const k = categoryKeyOf(m, index)
      if (!seen.has(k.key)) seen.set(k.key, k.status === 'archived' ? `${k.name} (archivada)` : k.status === 'unknown' ? `${k.name} (no catalogada)` : k.name)
    }
    for (const c of sortCategories(categories)) if (!seen.has(c.id)) seen.set(c.id, c.status === 'archived' ? `${c.name} (archivada)` : c.name)
    return [...seen.entries()].sort((a, b) => (a[0] === UNCATEGORIZED_KEY ? -1 : b[0] === UNCATEGORIZED_KEY ? 1 : a[1].localeCompare(b[1], 'es')))
  }, [movements, categories, index])

  const set = (patch: Partial<MovementFilter>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setLimit(PAGE)
  }

  async function changeCategory(m: Movement, id: string | null) {
    setBusy(m.id)
    const cat = id ? (index.get(id) ?? null) : null
    const ok = await assignCategory(m, cat)
    setBusy(null)
    if (ok && cat) {
      toast({
        kind: 'success',
        message: `«${m.description}» clasificado como ${cat.name}.`,
        action: { label: 'Crear una regla para casos así', run: () => setRuleDraft(ruleFromCorrection(m, cat)) },
      })
    }
  }

  const exportName = `Lunar Finance movimientos ${allDates ? 'todos' : periodSlug(period)}${mode === 'demo' ? ' (demo)' : ''}`

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle={allDates ? 'Todo el historial' : periodLabel(period)}
        actions={
          <>
            <button className="btn" onClick={() => setEditing('new')}>
              <Plus size={15} /> Nuevo movimiento
            </button>
            <button className="btn" disabled={list.length === 0} onClick={() => void exportWithHost((h) => exportCsv(h, list, index, exportName), 'CSV')}>
              <Download size={15} /> Exportar CSV
            </button>
          </>
        }
      />
      <DataGate>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {!allDates && <PeriodPicker value={period} onChange={setPeriod} years={years} />}
            <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
              <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} />
              Todas las fechas
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-2" role="search">
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mist" aria-hidden />
              <input className="field pl-8" placeholder="Buscar por descripción, categoría o método" aria-label="Buscar movimientos" value={filter.search} onChange={(e) => set({ search: e.target.value })} />
            </div>
            <select className="field w-auto" aria-label="Tipo" value={filter.kinds[0] ?? ''} onChange={(e) => set({ kinds: e.target.value ? [e.target.value as MovementKind] : [] })}>
              <option value="">Todos los tipos</option>
              {(Object.keys(KIND_LABEL) as MovementKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <select className="field w-auto max-w-[220px]" aria-label="Categoría" value={filter.categoryKeys[0] ?? ''} onChange={(e) => set({ categoryKeys: e.target.value ? [e.target.value] : [] })}>
              <option value="">Todas las categorías</option>
              {categoryOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {methods.length > 0 && (
              <select className="field w-auto" aria-label="Método de pago" value={filter.paymentMethods[0] ?? ''} onChange={(e) => set({ paymentMethods: e.target.value ? [e.target.value] : [] })}>
                <option value="">Todos los métodos</option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <select className="field w-auto" aria-label="Estado" value={filter.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {isFilterActive(filter) && (
              <button className="btn btn-ghost" onClick={() => set(EMPTY_FILTER)}>
                Quitar filtros
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Summary list={list} />
            {pendingAll > 0 && (
              <button className="btn btn-primary" onClick={() => setClassifying(true)}>
                <WandSparkles size={15} /> Clasificar {pendingAll} sin categoría
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <EmptyState title={movements.length === 0 ? 'Aún no hay movimientos' : 'Ningún movimiento coincide con estos filtros'}>
              {movements.length === 0 ? null : 'Prueba con otro periodo o quita algún filtro.'}
            </EmptyState>
          ) : (
            <div className="panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table text-[13.5px]">
                  <thead>
                    <tr>
                      <th className="w-[96px]">Fecha</th>
                      <th>Descripción</th>
                      <th className="w-[210px]">Categoría</th>
                      <th className="w-[130px] max-[1100px]:hidden">Método</th>
                      <th className="w-[120px] text-right">Importe</th>
                      <th className="w-10">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice(0, limit).map((m) => {
                      const signed = signedCents(m)
                      const warn = m.issues.length > 0
                      const blocking = !isCounted(m)
                      return (
                        <tr key={m.id} className={cx(blocking && 'bg-warn-soft/50')}>
                          <td className="num text-mist">{m.date ? formatDateES(m.date) : '—'}</td>
                          <td>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate">{m.description || <span className="text-mist">Sin descripción</span>}</span>
                              {warn && (
                                <span title={m.issues.map((i) => i.message).join('\n')} className={blocking ? 'text-negative' : 'text-warn'}>
                                  <TriangleAlert size={14} aria-label={m.issues.map((i) => i.message).join(' ')} />
                                </span>
                              )}
                            </div>
                            {m.kind !== 'expense' && <div className="text-[12px] text-mist">{m.kind ? KIND_LABEL[m.kind] : `Tipo: ${m.rawKind ?? 'vacío'}`}</div>}
                          </td>
                          <td>
                            {m.kind === 'transfer' ? (
                              <span className="text-mist">No aplica</span>
                            ) : (
                              <CategorySelect
                                className={cx('py-1', !m.categoryLink && 'text-mist')}
                                value={m.categoryId}
                                kind={m.kind}
                                categories={categories}
                                unknownLabel={
                                  m.categoryLink && !m.categoryId ? (m.categoryLink.type === 'name' ? `${m.categoryLink.name} (no catalogada)` : 'Categoría no encontrada') : undefined
                                }
                                disabled={busy === m.id}
                                label={`Categoría de ${m.description}`}
                                onChange={(id) => void changeCategory(m, id)}
                              />
                            )}
                          </td>
                          <td className="truncate text-ink-2 max-[1100px]:hidden">{m.paymentMethod ?? ''}</td>
                          <td className="text-right">
                            {signed === null ? (
                              <span className="text-mist">{m.amountCents !== null ? <Money cents={m.amountCents} /> : '—'}</span>
                            ) : m.kind === 'transfer' ? (
                              <Money cents={m.amountCents ?? 0} className="text-mist" />
                            ) : (
                              <Money cents={signed} signed className={signed > 0 ? 'text-positive' : ''} />
                            )}
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-icon size-7 min-h-7" onClick={() => setEditing(m)} aria-label={`Editar ${m.description}`}>
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {list.length > limit && (
                <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-mist">
                  <span>
                    Mostrando {limit} de {list.length}
                  </span>
                  <button className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                    Mostrar {Math.min(PAGE, list.length - limit)} más
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </DataGate>
      {editing && <MovementDialog movement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {classifying && <ClassifyDialog onClose={() => setClassifying(false)} />}
      {ruleDraft && <RuleDialog initial={ruleDraft} title="Crear regla a partir de la corrección" onClose={() => setRuleDraft(null)} />}
    </>
  )
}
