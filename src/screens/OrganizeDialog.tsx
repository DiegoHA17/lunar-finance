/**
 * Propuestas para mantener ordenadas las categorías. Nada se aplica solo: cada acción es un clic explícito del
 * usuario y ninguna borra ni fusiona registros (archivar conserva el histórico).
 */

import { useMemo, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { type Rule, emptyRule } from '../domain/classifier/rules'
import { type CategoryRow, summarize } from '../domain/stats'
import type { Category } from '../domain/types'
import { findSimilarCategories, suggestRules } from '../services/ai'
import { aiProvider, reviewDuplicatesWithAi, setCategoryArchived, toastError, updateCategory } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Dialog, Spinner } from '../ui/primitives'
import { RuleDialog } from './RuleDialog'

interface Pair {
  a: Category
  b: Category
  reason: string
}

export function OrganizeDialog({ onClose, onCreateCategory }: { onClose: () => void; onCreateCategory: (name: string, kind: Category['kind']) => void }) {
  const categories = useApp((s) => s.data.categories)
  const movements = useApp((s) => s.data.movements)
  const rules = useApp((s) => s.rules)
  const index = useMemo(() => new CategoryIndex(categories), [categories])
  const active = categories.filter((c) => c.status === 'active')
  const provider = useMemo(() => aiProvider(), [])

  const [aiPairs, setAiPairs] = useState<Pair[] | null>(null)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<string | null>(null)
  const [aliasTarget, setAliasTarget] = useState<Record<string, string | null>>({})
  const [aiHints, setAiHints] = useState<Record<string, string>>({})
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null)

  const pairs = useMemo(() => {
    const out: Pair[] = [...findSimilarCategories(active)]
    for (const p of aiPairs ?? []) if (!out.some((o) => [o.a.id, o.b.id].sort().join() === [p.a.id, p.b.id].sort().join())) out.push(p)
    return out.filter((p) => !dismissed.has(`${p.a.id}|${p.b.id}`))
  }, [active, aiPairs, dismissed])

  // Nombres usados en movimientos que no están en el catálogo (todo el historial).
  const unknown: CategoryRow[] = useMemo(() => {
    const all = summarize(movements, index, { kind: 'custom', start: '1900-01-01', end: '2200-12-31' })
    return [...all.expenseByCategory, ...all.incomeByCategory].filter((r) => r.status === 'unknown' && !dismissed.has(r.key))
  }, [movements, index, dismissed])

  const ruleSuggestions = useMemo(() => suggestRules(movements, rules, index).filter((s) => !dismissed.has(`rule:${s.pattern}`)), [movements, rules, index, dismissed])

  async function findSynonyms() {
    setAiBusy('pairs')
    try {
      const found = await reviewDuplicatesWithAi(active.map((c) => c.name))
      const byName = new Map(active.map((c) => [c.name, c]))
      setAiPairs(found.flatMap((p) => (byName.get(p.a) && byName.get(p.b) ? [{ a: byName.get(p.a)!, b: byName.get(p.b)!, reason: `IA: ${p.reason}` }] : [])))
    } catch (e) {
      toastError(e, 'No se pudo consultar a la IA')
    } finally {
      setAiBusy(null)
    }
  }

  async function suggestFor(row: CategoryRow) {
    if (!provider) return
    setAiBusy(row.key)
    try {
      const s = await provider.suggest(
        { id: row.key, url: null, description: `Categoría «${row.name}»`, date: null, amountCents: null, kind: row.kind, rawKind: null, categoryLink: null, categoryId: null, paymentMethod: null, origin: 'unknown', issues: [], createdTime: '', lastEditedTime: '' },
        { categories: index },
      )
      if (s && index.get(s.categoryId)?.status === 'active') {
        setAliasTarget((t) => ({ ...t, [row.key]: s.categoryId }))
        setAiHints((h) => ({ ...h, [row.key]: `IA: ${index.get(s.categoryId)!.name}` }))
      } else setAiHints((h) => ({ ...h, [row.key]: 'IA: ninguna encaja' }))
    } catch (e) {
      toastError(e, 'No se pudo consultar a la IA')
    } finally {
      setAiBusy(null)
    }
  }

  async function addAlias(row: CategoryRow) {
    const target = index.get(aliasTarget[row.key] ?? null)
    if (!target) return
    const ok = await updateCategory(target, { id: target.id, name: target.name, kind: target.kind, color: target.color, icon: target.icon, description: target.description, aliases: [...target.aliases, row.name] })
    if (ok) setDismissed((d) => new Set(d).add(row.key))
  }

  const empty = pairs.length === 0 && unknown.length === 0 && ruleSuggestions.length === 0

  return (
    <Dialog open wide onClose={onClose} title="Revisar organización">
      <div className="flex flex-col gap-6 text-[13.5px]">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-night">Posibles duplicados</h3>
            {provider && (
              <button className="btn btn-sm" onClick={() => void findSynonyms()} disabled={aiBusy !== null}>
                {aiBusy === 'pairs' ? <Spinner /> : null} Buscar sinónimos con IA
              </button>
            )}
          </div>
          {pairs.length === 0 ? (
            <p className="text-mist">{aiPairs ? 'Ninguno.' : 'Ninguno por nombre.'}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {pairs.map((p) => {
                const key = `${p.a.id}|${p.b.id}`
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="flex-1">
                      <strong>{p.a.name}</strong> y <strong>{p.b.name}</strong> <span className="text-mist">· {p.reason}</span>
                    </span>
                    {confirm === key ? (
                      <button
                        className="btn btn-sm btn-danger"
                        autoFocus
                        onBlur={() => setConfirm(null)}
                        onClick={async () => {
                          if (await setCategoryArchived(p.b, true)) setDismissed((d) => new Set(d).add(key))
                          setConfirm(null)
                        }}
                      >
                        Archivar «{p.b.name}»
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setConfirm(key)}>
                        Archivar «{p.b.name}»…
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => setDismissed((d) => new Set(d).add(key))}>
                      Descartar
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {unknown.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-night">No catalogadas</h3>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {unknown.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-32 flex-1">
                    <strong>{r.name}</strong> <span className="text-mist">· {r.count} mov.</span>
                    {aiHints[r.key] && <span className="chip ml-2">{aiHints[r.key]}</span>}
                  </span>
                  <CategorySelect className="w-48 py-1" value={aliasTarget[r.key] ?? null} kind={r.kind === 'income' ? 'income' : 'expense'} categories={categories} noneLabel="Alias de…" label={`Alias de ${r.name}`} onChange={(id) => setAliasTarget((t) => ({ ...t, [r.key]: id }))} />
                  <button className="btn btn-sm" disabled={!aliasTarget[r.key]} onClick={() => void addAlias(r)}>
                    Añadir alias
                  </button>
                  {provider && (
                    <button className="btn btn-sm btn-ghost" disabled={aiBusy !== null} onClick={() => void suggestFor(r)}>
                      {aiBusy === r.key ? <Spinner /> : null} Sugerir
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => onCreateCategory(r.name, r.kind)}>
                    Crear
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {ruleSuggestions.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-night">Reglas sugeridas</h3>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {ruleSuggestions.map((s) => (
                <li key={s.pattern} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="flex-1">
                    «{s.pattern}» → <strong>{s.category.name}</strong> <span className="text-mist">· {s.count} mov.</span>
                  </span>
                  <button className="btn btn-sm" onClick={() => setRuleDraft({ ...emptyRule(s.category.id, s.category.name), pattern: s.pattern, source: 'correction' })}>
                    Crear regla
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setDismissed((d) => new Set(d).add(`rule:${s.pattern}`))}>
                    Descartar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {empty && <p className="py-4 text-center text-mist">Todo en orden.</p>}
      </div>
      {ruleDraft && (
        <RuleDialog
          initial={ruleDraft}
          onClose={() => {
            setDismissed((d) => new Set(d).add(`rule:${ruleDraft.pattern}`))
            setRuleDraft(null)
          }}
        />
      )}
    </Dialog>
  )
}
