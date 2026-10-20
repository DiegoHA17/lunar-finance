/**
 * Revisión global de las categorías escritas en los movimientos (Categorías → Revisar organización).
 * Comprobaciones por nombre siempre; la IA local, si está disponible, opina sobre lo que no es seguro. Nada se
 * escribe hasta pulsar «Aplicar correcciones seleccionadas» y confirmar.
 */

import { useMemo, useRef, useState } from 'react'
import type { CategoryIndex } from '../domain/categories'
import { type CategoryReview, type ReviewGroup, type ReviewLevel, reviewCategories } from '../domain/categoryReview'
import { formatDateShort } from '../domain/dates'
import type { Category } from '../domain/types'
import { type CorrectionOutcome, reviewWithAi } from '../services/categoryReview'
import { aiCategoryMatcher, applyCategoryCorrections, toast } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Notice, Spinner } from '../ui/primitives'

type Filter = 'all' | ReviewLevel

const LEVEL_LABEL: Record<ReviewLevel, string> = { safe: 'Segura', doubtful: 'Dudosa', none: 'Sin propuesta' }
const FILTER_LABEL: Record<Filter, string> = { all: 'Todas', safe: 'Seguras', doubtful: 'Dudosas', none: 'Sin propuesta' }

export function CategoryReviewSection({ index, categories }: { index: CategoryIndex; categories: Category[] }) {
  const movements = useApp((s) => s.data.movements)
  const catalog = useApp((s) => s.data.catalog)
  const demo = useApp((s) => s.mode === 'demo')
  const [review, setReview] = useState<CategoryReview | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [aiRun, setAiRun] = useState<{ done: number; total: number } | null>(null)
  const [targets, setTargets] = useState<Record<string, string | null>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcomes, setOutcomes] = useState<CorrectionOutcome[] | null>(null)
  const abort = useRef<AbortController | null>(null)
  const busy = aiRun !== null || progress !== null

  const groups = useMemo(() => (review?.groups ?? []).filter((g) => !dismissed.has(g.key)), [review, dismissed])
  const shown = groups.filter((g) => filter === 'all' || g.level === filter)
  const count = (l: ReviewLevel) => groups.filter((g) => g.level === l).length
  const targetOf = (g: ReviewGroup) => (g.key in targets ? targets[g.key] : (g.proposal?.categoryId ?? null))
  const chosen = groups.filter((g) => selected.has(g.key) && targetOf(g))
  const movementCount = chosen.reduce((n, g) => n + g.movements.length, 0)

  function initialize(r: CategoryReview) {
    setReview(r)
    setTargets({})
    setSelected(new Set())
    setDismissed(new Set())
    setOutcomes(null)
  }

  async function run() {
    const base = reviewCategories(movements, index, catalog)
    initialize(base)
    const matcher = catalog === 'notion' ? aiCategoryMatcher() : null
    if (!matcher) {
      setAiNote(catalog === 'notion' ? 'IA no disponible: solo comprobaciones por nombre (actívala en Ajustes → Inteligencia artificial).' : 'Sin catálogo en Notion: solo comprobaciones por nombre.')
      return
    }
    if (!base.groups.some((g) => g.level !== 'safe')) {
      setAiNote(null)
      return
    }
    abort.current = new AbortController()
    setAiRun({ done: 0, total: 0 })
    const res = await reviewWithAi(base, matcher.ai, matcher.model, index, (done, total) => setAiRun({ done, total }), abort.current.signal)
    setAiRun(null)
    setReview(res.review)
    const parts = [`Revisado con ${matcher.model}`]
    if (res.failures) parts.push(`${res.failures} sin respuesta válida de la IA`)
    if (res.stopped) parts.push(res.error ? `detenido: ${res.error.message}` : 'detenido')
    setAiNote(parts.join(' · '))
  }

  function toggle(key: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  }

  async function apply() {
    setConfirming(false)
    abort.current = new AbortController()
    setProgress({ done: 0, total: movementCount })
    const res = await applyCategoryCorrections(
      chosen.map((g) => ({ group: g, categoryId: targetOf(g)! })),
      (done, total) => setProgress({ done, total }),
      abort.current.signal,
    )
    setProgress(null)
    setOutcomes(res)
    // Lo aplicado sale de la revisión; lo que falló sigue ahí para reintentarlo o revisarlo.
    const applied = new Set(res.filter((o) => o.status === 'applied').map((o) => o.movement.id))
    setReview((r) => r && { ...r, groups: r.groups.map((g) => ({ ...g, movements: g.movements.filter((m) => !applied.has(m.id)) })).filter((g) => g.movements.length > 0) })
    setSelected(new Set())
    const ok = applied.size
    toast({ kind: ok === res.length ? 'success' : 'error', message: `${ok} de ${res.length} movimiento(s) corregidos.` })
  }

  const failures = outcomes?.filter((o) => o.status !== 'applied') ?? []

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-night">Categorías de los movimientos</h3>
        <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={busy}>
          {aiRun ? <Spinner /> : null} Revisar categorías con IA
        </button>
      </div>

      {!review && <p className="text-mist">Busca nombres de categoría que no están en el catálogo (erratas, plurales, nombres inventados) y propone a cuál corresponden.</p>}

      {aiRun && (
        <div className="mb-2 flex items-center gap-3" role="status">
          <span className="text-[13px] text-mist">IA</span>
          <progress className="h-2 flex-1 accent-[var(--accent)]" value={aiRun.done} max={Math.max(aiRun.total, 1)} />
          <span className="num text-[13px] text-mist">
            {aiRun.done}/{aiRun.total}
          </span>
          <button className="btn btn-sm" onClick={() => abort.current?.abort()}>
            Cancelar
          </button>
        </div>
      )}

      {review && (
        <div className="flex flex-col gap-3">
          {aiNote && <p className="text-[12.5px] text-mist">{aiNote}</p>}

          {outcomes && (
            <Notice kind={failures.length ? 'warn' : 'info'}>
              <p>
                Aplicados: <strong>{outcomes.length - failures.length}</strong> de {outcomes.length}
                {failures.some((f) => f.status === 'not_attempted') && ` · ${failures.filter((f) => f.status === 'not_attempted').length} sin intentar`}.
              </p>
              {failures.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {failures.slice(0, 8).map((f) => (
                    <li key={f.movement.id}>
                      {f.movement.description || 'Sin descripción'} ({f.movement.date ? formatDateShort(f.movement.date) : 'sin fecha'}): {f.error?.message}
                    </li>
                  ))}
                </ul>
              )}
            </Notice>
          )}

          {groups.length === 0 ? (
            <p className="text-mist">Todas las categorías escritas están en el catálogo.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar propuestas">
                  {(['all', 'safe', 'doubtful', 'none'] as const).map((f) => (
                    <button key={f} role="tab" aria-selected={filter === f} className={`btn btn-sm ${filter === f ? '' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
                      {FILTER_LABEL[f]} ({f === 'all' ? groups.length : count(f)})
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                <button className="btn btn-sm" disabled={busy || count('safe') === 0} onClick={() => setSelected(new Set(groups.filter((g) => g.level === 'safe' && targetOf(g)).map((g) => g.key)))}>
                  Seleccionar seguras
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>
                  Quitar selección
                </button>
              </div>

              <table className="data-table text-[13.5px]">
                <thead>
                  <tr>
                    <th className="w-8">
                      <span className="sr-only">Corregir</span>
                    </th>
                    <th>Categoría actual</th>
                    <th className="w-[210px]">Categoría propuesta</th>
                    <th className="text-right">Mov.</th>
                    <th>Motivo</th>
                    <th>Seguridad</th>
                    <th className="w-8">
                      <span className="sr-only">Descartar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((g) => {
                    const target = targetOf(g)
                    const manual = g.key in targets && targets[g.key] !== (g.proposal?.categoryId ?? null)
                    return (
                      <tr key={g.key}>
                        <td>
                          <input type="checkbox" aria-label={`Corregir «${g.name}»`} disabled={!target || busy} checked={Boolean(target) && selected.has(g.key)} onChange={(e) => toggle(g.key, e.target.checked)} />
                        </td>
                        <td>
                          <strong>«{g.name}»</strong>
                          {g.variants.length > 1 && <div className="text-[12px] text-mist">{g.variants.length} variantes</div>}
                        </td>
                        <td>
                          <CategorySelect
                            className="py-1"
                            value={target}
                            kind={g.kind === 'income' ? 'income' : g.kind === 'expense' ? 'expense' : null}
                            categories={categories}
                            noneLabel={g.candidates.length ? 'Ambigua: elige' : 'Sin cambios'}
                            disabled={busy}
                            label={`Categoría para «${g.name}»`}
                            onChange={(id) => {
                              setTargets((t) => ({ ...t, [g.key]: id }))
                              toggle(g.key, id !== null)
                            }}
                          />
                        </td>
                        <td className="num text-right">{g.movements.length}</td>
                        <td className="text-[12.5px] text-ink-2">{manual ? 'Elegida a mano' : [g.proposal?.reason, g.note].filter(Boolean).join(' · ') || '—'}</td>
                        <td>
                          <span className={`chip ${manual ? '' : g.level === 'safe' ? 'text-positive' : g.level === 'doubtful' ? 'text-warn' : ''}`}>
                            {manual ? 'Manual' : LEVEL_LABEL[g.level]}
                            {g.proposal && !manual ? ` · ${Math.round(g.proposal.confidence * 100)} %` : ''}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost" aria-label={`Descartar «${g.name}»`} title="Descartar" disabled={busy} onClick={() => (setDismissed((d) => new Set(d).add(g.key)), toggle(g.key, false))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {progress ? (
                <div className="flex items-center gap-3" role="status">
                  <progress className="h-2 flex-1 accent-[var(--accent)]" value={progress.done} max={Math.max(progress.total, 1)} />
                  <span className="num text-[13px] text-mist">
                    {progress.done}/{progress.total}
                  </span>
                  <button className="btn btn-sm" onClick={() => abort.current?.abort()}>
                    Detener
                  </button>
                </div>
              ) : confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Se cambiará solo la categoría de <strong>{movementCount}</strong> movimiento(s){demo ? ' (datos de demostración)' : ' en Notion'}.
                  </span>
                  <button className="btn btn-sm btn-primary" autoFocus onClick={() => void apply()}>
                    Confirmar
                  </button>
                  <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div>
                  <button className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => setConfirming(true)}>
                    Aplicar correcciones seleccionadas{movementCount ? ` (${movementCount})` : ''}
                  </button>
                </div>
              )}
            </>
          )}

          {review.skipped > 0 && <p className="text-[12.5px] text-mist">{review.skipped} transferencia(s) con categoría desconocida se dejan como están.</p>}

          {review.recognized.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-mist">Variantes de escritura ya reconocidas ({review.recognized.length}) · no hace falta cambiarlas</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {review.recognized.map((r) => (
                  <li key={`${r.category.id}|${r.written}`}>
                    «{r.written.replace(/^\s+|\s+$/g, (s) => '·'.repeat(s.length))}» → {r.category.name} <span className="text-mist">· {r.count} mov. · {r.difference}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
