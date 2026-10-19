/**
 * Asistente para crear la base de datos «Categorías» en Notion. Explica el cambio antes de hacerlo, no modifica
 * ningún movimiento y deja que el usuario elija qué categorías dar de alta.
 */

import { useEffect, useMemo, useState } from 'react'
import { SUGGESTED_CATEGORIES, type SuggestedCategory } from '../domain/categories'
import { nameKey } from '../domain/text'
import { LunarError } from '../infra/contracts'
import type { CatalogSetupProgress } from '../services/categories'
import { fetchSchema, setupCatalog } from '../state/actions'
import { useApp } from '../state/store'
import { CategoryLabel, Dialog, Field, Notice, Spinner } from '../ui/primitives'

export function CatalogSetupDialog({ onClose }: { onClose: () => void }) {
  const config = useApp((s) => s.config)
  const categories = useApp((s) => s.data.categories)
  const [parent, setParent] = useState('')
  const [parentHint, setParentHint] = useState<string | null>(null)
  const existing: SuggestedCategory[] = useMemo(() => categories.map((c) => ({ name: c.name, kind: c.kind, color: c.color, icon: c.icon })), [categories])
  const suggestions = useMemo(() => SUGGESTED_CATEGORIES.filter((s) => !existing.some((e) => nameKey(e.name) === nameKey(s.name))), [existing])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing.map((e) => nameKey(e.name))))
  const [progress, setProgress] = useState<CatalogSetupProgress | null>(null)
  const [error, setError] = useState<LunarError | null>(null)
  const [result, setResult] = useState<{ created: number; failed: { name: string; error: string }[] } | null>(null)

  useEffect(() => {
    const id = config.notion.movements?.dataSourceId
    if (!id) return
    fetchSchema(id)
      .then((s) => {
        if (s.parentPageId) {
          setParent((p) => p || s.parentPageId!)
          setParentHint('La página de tu base de datos de gastos')
        }
      })
      .catch(() => setParentHint(null))
  }, [config.notion.movements?.dataSourceId])

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const seed = [...existing, ...suggestions].filter((c) => selected.has(nameKey(c.name)))

  async function run() {
    setError(null)
    setProgress({ done: 0, total: seed.length, current: '' })
    try {
      const r = await setupCatalog(parent.trim(), seed, setProgress)
      setResult(r)
    } catch (e) {
      setError(LunarError.from(e))
      setProgress(null)
    }
  }

  const running = progress !== null && result === null
  return (
    <Dialog
      open
      wide
      onClose={() => !running && onClose()}
      title="Crear el catálogo de categorías en Notion"
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            Listo
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={running}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void run()} disabled={running || !parent.trim()}>
              {running ? 'Creando…' : `Crear catálogo con ${seed.length} categoría(s)`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p>
            Base de datos «Categorías» creada con <strong>{result.created}</strong> categoría(s). Lunar Finance ya la usa como catálogo.
          </p>
          {result.failed.length > 0 && (
            <Notice kind="warn">
              No se pudieron crear: {result.failed.map((f) => `${f.name} (${f.error})`).join('; ')}. Puedes crearlas desde la pantalla Categorías.
            </Notice>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] text-ink-2">Se creará la base de datos «Categorías». Tus movimientos no se modifican.</p>
          <Field label="Página de Notion donde crearla" htmlFor="cat-parent" hint={parentHint ?? 'Página compartida con tu integración'}>
            <input id="cat-parent" className="field" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="https://www.notion.so/Finanzas-…" disabled={running} />
          </Field>
          {error && (
            <Notice kind="error">
              <p>{error.message}</p>
              {error.hint && <p className="mt-0.5 text-[12.5px]">{error.hint}</p>}
            </Notice>
          )}
          {running && progress && (
            <div className="flex items-center gap-3" role="status">
              <Spinner />
              <progress className="h-2 flex-1" value={progress.done} max={Math.max(1, progress.total)} />
              <span className="text-[13px] text-mist">{progress.current ? `Creando «${progress.current}»` : 'Creando la base de datos…'}</span>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-ink-2">Ya usadas en tus movimientos ({existing.length})</legend>
              {existing.length === 0 ? (
                <p className="text-[13px] text-mist">Ninguna todavía.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {existing.map((c) => (
                    <li key={c.name}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={selected.has(nameKey(c.name))} onChange={() => toggle(nameKey(c.name))} disabled={running} />
                        <CategoryLabel name={c.name} color={c.color} icon={c.icon} />
                        <span className="text-[12px] text-mist">{c.kind === 'income' ? 'ingreso' : 'gasto'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <fieldset>
              <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-medium text-ink-2">
                <span>Sugeridas (opcionales)</span>
                {suggestions.length > 0 && (
                  <button type="button" className="text-[12.5px] font-normal text-accent hover:underline" onClick={() => setSelected((s) => new Set([...s, ...suggestions.map((x) => nameKey(x.name))]))}>
                    Marcar todas
                  </button>
                )}
              </legend>
              <ul className="flex flex-col gap-1">
                {suggestions.map((c) => (
                  <li key={c.name}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.has(nameKey(c.name))} onChange={() => toggle(nameKey(c.name))} disabled={running} />
                      <CategoryLabel name={c.name} color={c.color} icon={c.icon} />
                      <span className="text-[12px] text-mist">{c.kind === 'income' ? 'ingreso' : 'gasto'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
        </div>
      )}
    </Dialog>
  )
}
