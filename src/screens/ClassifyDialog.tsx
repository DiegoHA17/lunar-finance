/**
 * Revisión de propuestas para los movimientos sin categoría. Nada se escribe hasta pulsar «Aplicar»; los casos
 * ambiguos o sin regla se muestran con su motivo y se pueden clasificar a mano.
 */

import { useMemo, useRef, useState } from 'react'
import { CategoryIndex } from '../domain/categories'
import { formatDateShort } from '../domain/dates'
import type { ApplyOutcome, PreviewItem } from '../services/classification'
import { previewPending } from '../services/classification'
import { preselect, proposeWithAi } from '../services/ai'
import { aiProvider, applyClassification, savedWhere, toast } from '../state/actions'
import { useApp } from '../state/store'
import { CategorySelect } from '../ui/CategorySelect'
import { Dialog, Money, Notice } from '../ui/primitives'

export function ClassifyDialog({ onClose }: { onClose: () => void }) {
  const movements = useApp((s) => s.data.movements)
  const categories = useApp((s) => s.data.categories)
  const rules = useApp((s) => s.rules)
  const index = useMemo(() => new CategoryIndex(categories), [categories])
  // La vista previa se calcula una vez al abrir: lo que se revisa es lo que se aplica.
  const [items, setItems] = useState<PreviewItem[]>(() => previewPending(movements, rules, index))
  const provider = useMemo(() => aiProvider(), [])
  const [aiRun, setAiRun] = useState<{ done: number; total: number } | null>(null)
  const [aiFailures, setAiFailures] = useState(0)
  const aiAbort = useRef<AbortController | null>(null)
  const [manual, setManual] = useState<Record<string, string | null>>({})
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.filter((i) => i.proposal.status === 'proposed').map((i) => i.movement.id)))
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcomes, setOutcomes] = useState<ApplyOutcome[] | null>(null)
  const abort = useRef<AbortController | null>(null)

  const effective = (i: PreviewItem): PreviewItem => {
    const m = manual[i.movement.id]
    if (m === undefined) return i
    if (m === null) return { ...i, proposal: { ...i.proposal, status: 'none', categoryId: null } }
    return { ...i, proposal: { ...i.proposal, status: 'proposed', categoryId: m, source: null, reason: 'Elegida en la revisión' } }
  }
  const toApply = items.map(effective).filter((i) => selected.has(i.movement.id) && i.proposal.status === 'proposed')
  const proposedCount = items.filter((i) => i.proposal.status === 'proposed').length
  const unresolved = items.filter((i) => i.proposal.status !== 'proposed' && manual[i.movement.id] === undefined)

  async function askAi() {
    if (!provider) return
    aiAbort.current = new AbortController()
    setAiRun({ done: 0, total: unresolved.length })
    const res = await proposeWithAi(unresolved, provider, index, rules, (done, total) => setAiRun({ done, total }), aiAbort.current.signal, movements)
    const byId = new Map(res.items.map((it) => [it.movement.id, it]))
    setItems((prev) => prev.map((it) => byId.get(it.movement.id) ?? it))
    setSelected((s) => {
      const n = new Set(s)
      for (const it of res.items) if (preselect(it.proposal)) n.add(it.movement.id)
      return n
    })
    setAiFailures(res.failures.length)
    setAiRun(null)
    const first = res.failures[0]?.error
    if (res.stopped && first) toast({ kind: 'error', message: first.message, hint: first.hint })
  }

  async function apply() {
    abort.current = new AbortController()
    setProgress({ done: 0, total: toApply.length })
    const res = await applyClassification(toApply, (done, total) => setProgress({ done, total }), abort.current.signal)
    setOutcomes(res)
    const ok = res.filter((o) => o.ok).length
    if (ok) toast({ kind: 'success', message: `${ok} movimiento(s) clasificados${savedWhere()}.` })
  }

  const failures = outcomes?.filter((o) => !o.ok) ?? []
  const running = (progress !== null && outcomes === null) || aiRun !== null

  return (
    <Dialog
      open
      wide
      onClose={() => (running ? (abort.current?.abort(), aiAbort.current?.abort()) : onClose())}
      title="Clasificar movimientos sin categoría"
      footer={
        outcomes ? (
          <button className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        ) : running ? (
          <button className="btn" onClick={() => (abort.current?.abort(), aiAbort.current?.abort())}>
            Detener
          </button>
        ) : (
          <>
            <span className="mr-auto">
              {provider && unresolved.length > 0 && (
                <button className="btn" onClick={() => void askAi()}>
                  Proponer con IA ({unresolved.length})
                </button>
              )}
            </span>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void apply()} disabled={toApply.length === 0}>
              Aplicar {toApply.length} clasificación(es)
            </button>
          </>
        )
      }
    >
      {items.length === 0 ? (
        <p className="py-8 text-center text-mist">Nada pendiente.</p>
      ) : outcomes ? (
        <div className="flex flex-col gap-3">
          <p>
            Clasificados: <strong>{outcomes.filter((o) => o.ok).length}</strong> de {toApply.length}.
          </p>
          {failures.length > 0 && (
            <Notice kind="error">
              <p>{failures.length} no se pudieron guardar:</p>
              <ul className="mt-1 list-disc pl-4">
                {failures.slice(0, 8).map((f) => (
                  <li key={f.movementId}>
                    {items.find((i) => i.movement.id === f.movementId)?.movement.description}: {f.error?.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {outcomes.length < toApply.length && <Notice kind="warn">Detenido. Los cambios ya guardados se mantienen.</Notice>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-2">
            <strong>{proposedCount}</strong> de {items.length} con propuesta
            {aiFailures > 0 && <span className="text-mist"> · {aiFailures} sin respuesta válida de la IA</span>}
          </p>
          {(aiRun ?? progress) && running && (
            <div className="flex items-center gap-3" role="status">
              {aiRun && <span className="text-[13px] text-mist">IA</span>}
              <progress className="h-2 flex-1 accent-[var(--accent)]" value={(aiRun ?? progress)!.done} max={(aiRun ?? progress)!.total} />
              <span className="num text-[13px] text-mist">
                {(aiRun ?? progress)!.done}/{(aiRun ?? progress)!.total}
              </span>
            </div>
          )}
          <table className="data-table text-[13.5px]">
            <thead>
              <tr>
                <th className="w-8">
                  <span className="sr-only">Aplicar</span>
                </th>
                <th>Movimiento</th>
                <th className="w-[230px]">Categoría</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((raw) => {
                const i = effective(raw)
                const id = i.movement.id
                const canApply = i.proposal.status === 'proposed'
                return (
                  <tr key={id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Aplicar a ${i.movement.description}`}
                        disabled={!canApply || running}
                        checked={canApply && selected.has(id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s)
                            if (e.target.checked) n.add(id)
                            else n.delete(id)
                            return n
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="truncate">{i.movement.description || 'Sin descripción'}</div>
                      <div className="text-[12px] text-mist">
                        {i.movement.date ? formatDateShort(i.movement.date) : 'sin fecha'} · {i.proposal.reason}
                        {i.proposal.source === 'ai' && i.proposal.confidenceValue !== undefined && (
                          <span className={`chip ml-1.5 ${i.proposal.confidence === 'high' ? '' : 'text-warn'}`}>IA {Math.round(i.proposal.confidenceValue * 100)} %</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <CategorySelect
                        className="py-1"
                        value={i.proposal.categoryId}
                        kind={i.movement.kind}
                        categories={categories}
                        noneLabel={raw.proposal.status === 'ambiguous' ? 'Ambigua: elige' : 'Elegir…'}
                        disabled={running}
                        label={`Categoría para ${i.movement.description}`}
                        onChange={(cid) => {
                          setManual((m) => ({ ...m, [id]: cid }))
                          setSelected((s) => {
                            const n = new Set(s)
                            if (cid) n.add(id)
                            else n.delete(id)
                            return n
                          })
                        }}
                      />
                    </td>
                    <td className="text-right">
                      <Money cents={i.movement.amountCents ?? 0} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}
