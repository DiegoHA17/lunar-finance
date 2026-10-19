import { Archive, ArchiveRestore, ArrowLeftRight, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CategoryIndex, sortCategories } from '../domain/categories'
import { periodLabel } from '../domain/periods'
import { type CategoryRow, summarize } from '../domain/stats'
import type { Category, CategoryKind } from '../domain/types'
import { openMovements, setCategoryArchived, setPeriod } from '../state/actions'
import { useApp } from '../state/store'
import { PeriodPicker } from '../ui/PeriodPicker'
import { CategoryLabel, Money, Notice, PageHeader } from '../ui/primitives'
import { CatalogSetupDialog } from './CatalogSetupDialog'
import { CategoryDialog } from './CategoryDialog'
import { useYears } from '../state/hooks'
import { DataGate } from './DataGate'

function CategoryTable({
  title,
  list,
  rows,
  editable,
  onEdit,
}: {
  title: string
  list: Category[]
  rows: Map<string, CategoryRow>
  editable: boolean
  onEdit: (c: Category) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  if (list.length === 0) return null
  return (
    <section className="panel overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold text-night">{title}</h2>
      <table className="data-table text-[13.5px]">
        <thead>
          <tr>
            <th>Categoría</th>
            <th className="max-md:hidden">Alias</th>
            <th className="w-28 text-right">Movimientos</th>
            <th className="w-32 text-right">Importe</th>
            <th className="w-[124px]">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const r = rows.get(c.id)
            return (
              <tr key={c.id}>
                <td>
                  <CategoryLabel name={c.name} color={c.color} icon={c.icon} status={c.status} />
                  {c.description && <div className="mt-0.5 truncate pl-8 text-[12px] text-mist">{c.description}</div>}
                </td>
                <td className="truncate text-[12.5px] text-mist max-md:hidden">{c.aliases.join(', ')}</td>
                <td className="num text-right text-ink-2">{r?.count ?? 0}</td>
                <td className="text-right">{r ? <Money cents={r.netCents} /> : <span className="text-faint">—</span>}</td>
                <td>
                  <div className="flex justify-end gap-0.5">
                    <button className="btn btn-ghost btn-icon size-7 min-h-7" title="Ver movimientos" aria-label={`Ver movimientos de ${c.name}`} onClick={() => openMovements({ categoryKey: c.id })}>
                      <ArrowLeftRight size={14} />
                    </button>
                    {editable && (
                      <>
                        <button className="btn btn-ghost btn-icon size-7 min-h-7" title="Editar" aria-label={`Editar ${c.name}`} onClick={() => onEdit(c)}>
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon size-7 min-h-7"
                          disabled={busy === c.id}
                          title={c.status === 'archived' ? 'Reactivar' : 'Archivar'}
                          aria-label={c.status === 'archived' ? `Reactivar ${c.name}` : `Archivar ${c.name}`}
                          onClick={async () => {
                            setBusy(c.id)
                            await setCategoryArchived(c, c.status !== 'archived')
                            setBusy(null)
                          }}
                        >
                          {c.status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export function Categories() {
  const categories = useApp((s) => s.data.categories)
  const movements = useApp((s) => s.data.movements)
  const catalog = useApp((s) => s.data.catalog)
  const mode = useApp((s) => s.mode)
  const period = useApp((s) => s.period)
  const years = useYears()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [newKind, setNewKind] = useState<CategoryKind>('expense')
  const [newName, setNewName] = useState('')
  const [setup, setSetup] = useState(false)

  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const summary = useMemo(() => summarize(movements, index, period), [movements, index, period])
  const rows = useMemo(() => new Map([...summary.expenseByCategory, ...summary.incomeByCategory].map((r) => [r.key, r])), [summary])
  const sorted = sortCategories(categories)
  const active = sorted.filter((c) => c.status === 'active')
  const archived = sorted.filter((c) => c.status === 'archived')
  const unknown = [...summary.expenseByCategory, ...summary.incomeByCategory].filter((r) => r.status === 'unknown')
  const editable = catalog === 'notion'

  return (
    <>
      <PageHeader
        title="Categorías"
        subtitle={`Importes de ${periodLabel(period)}`}
        actions={
          editable && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setNewKind('expense')
                setNewName('')
                setEditing('new')
              }}
            >
              <Plus size={15} /> Nueva categoría
            </button>
          )
        }
      />
      <DataGate>
        <div className="flex flex-col gap-5">
          <PeriodPicker value={period} onChange={setPeriod} years={years} />
          {!editable && (
            <Notice
              kind="info"
              actions={
                mode !== 'demo' && (
                  <button className="btn btn-sm btn-primary" onClick={() => setSetup(true)}>
                    Crear catálogo en Notion
                  </button>
                )
              }
            >
              <p className="font-medium text-ink">Aún no tienes un catálogo de categorías.</p>
              <p>
                Estas categorías se han deducido de los valores de tus movimientos y son de solo lectura. Crea el catálogo en Notion para editarlas, archivarlas, añadir alias y elegir colores e iconos.
              </p>
            </Notice>
          )}
          {unknown.length > 0 && editable && (
            <Notice
              kind="warn"
              actions={unknown.slice(0, 3).map((u) => (
                <button
                  key={u.key}
                  className="btn btn-sm"
                  onClick={() => {
                    setNewKind(u.kind)
                    setNewName(u.name)
                    setEditing('new')
                  }}
                >
                  Crear «{u.name}»
                </button>
              ))}
            >
              Hay movimientos con categorías que no están en el catálogo: {unknown.map((u) => `«${u.name}»`).join(', ')}. Créalas con ese nombre (o añádelo como alias de otra) para que se asocien.
            </Notice>
          )}
          <CategoryTable title="Gastos" list={active.filter((c) => c.kind === 'expense')} rows={rows} editable={editable} onEdit={setEditing} />
          <CategoryTable title="Ingresos" list={active.filter((c) => c.kind === 'income')} rows={rows} editable={editable} onEdit={setEditing} />
          {archived.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer py-1 text-[13.5px] font-medium text-ink-2">Archivadas ({archived.length})</summary>
              <p className="mt-1 mb-3 text-[13px] text-mist">No admiten movimientos nuevos, pero se conservan en los movimientos antiguos y en los informes.</p>
              <CategoryTable title="Archivadas" list={archived} rows={rows} editable={editable} onEdit={setEditing} />
            </details>
          )}
          {categories.length === 0 && <p className="text-mist">No hay categorías todavía.</p>}
        </div>
      </DataGate>
      {editing && <CategoryDialog category={editing === 'new' ? null : editing} defaultKind={newKind} defaultName={newName} onClose={() => setEditing(null)} />}
      {setup && <CatalogSetupDialog onClose={() => setSetup(false)} />}
    </>
  )
}
