/**
 * Elegir la fuente de datos de Notion de un rol y asignar sus propiedades a los campos de Lunar. Para
 * movimientos, también qué valores de «Tipo» son gasto, ingreso, devolución o transferencia.
 */

import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { nameKey } from '../domain/text'
import type { MovementKind } from '../domain/types'
import { KIND_LABEL } from '../domain/types'
import { type AppConfig, LunarError, type Role, type SchemaDto, type SourceConfig, type SourceSummary } from '../infra/contracts'
import { DEFAULT_KIND_VALUES, fieldSpecs, suggestMapping, toFieldRef } from '../infra/fieldSpecs'
import { resolveKind } from '../infra/mapping'
import { backend, saveConfig } from '../state/actions'
import { useApp } from '../state/store'
import { Field, Notice, Spinner } from '../ui/primitives'

const KINDS: MovementKind[] = ['expense', 'income', 'refund', 'transfer']

export function SourceSetup({ role, onSaved }: { role: Role; onSaved?: () => void }) {
  const config = useApp((s) => s.config)
  const movements = useApp((s) => s.data.movements)
  const current = role === 'movements' ? config.notion.movements : config.notion.categories
  const [sources, setSources] = useState<SourceSummary[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(current ? 'schema' : null)
  const [error, setError] = useState<LunarError | null>(null)
  const [schema, setSchema] = useState<SchemaDto | null>(null)
  const [fields, setFields] = useState<SourceConfig['fields']>(current?.fields ?? {})
  const [valueMap, setValueMap] = useState<Record<string, string[]>>(current?.valueMap ?? DEFAULT_KIND_VALUES)

  // Si ya hay una fuente configurada, se carga su esquema para poder revisar el mapeo.
  useEffect(() => {
    if (!current) return
    let cancel = false
    backend()
      .getSchema(current.dataSourceId)
      .then((s) => !cancel && setSchema(s))
      .catch((e) => !cancel && setError(LunarError.from(e)))
      .finally(() => !cancel && setBusy(null))
    return () => {
      cancel = true
    }
  }, [current])

  async function listShared() {
    setError(null)
    setBusy('list')
    try {
      setSources(await backend().listSources())
    } catch (e) {
      setError(LunarError.from(e))
    } finally {
      setBusy(null)
    }
  }

  async function choose(id: string) {
    setError(null)
    setBusy('schema')
    try {
      const s = await backend().getSchema(id)
      setSchema(s)
      setFields(suggestMapping(role, s))
      if (role === 'movements') setValueMap(DEFAULT_KIND_VALUES)
    } catch (e) {
      setError(LunarError.from(e))
    } finally {
      setBusy(null)
    }
  }

  async function resolve() {
    if (!input.trim()) return
    setError(null)
    setBusy('resolve')
    try {
      const found = await backend().resolveSource(input.trim())
      if (found.length === 1) await choose(found[0].id)
      else setSources(found)
    } catch (e) {
      setError(LunarError.from(e))
    } finally {
      setBusy(null)
    }
  }

  const specs = fieldSpecs(role)
  const missing = specs.filter((s) => s.required && !fields[s.key])

  // Valores posibles de «Tipo»: opciones del esquema o, si es texto, los valores vistos en los movimientos.
  const kindProp = schema?.properties.find((p) => p.id === fields.kind?.id)
  const kindValues = useMemo(() => {
    const fromSchema = kindProp?.options ?? []
    const seen = role === 'movements' && schema?.id === config.notion.movements?.dataSourceId ? movements.map((m) => m.rawKind).filter((x): x is string => Boolean(x)) : []
    const all = new Map<string, string>()
    for (const v of [...fromSchema, ...seen]) if (!all.has(nameKey(v))) all.set(nameKey(v), v)
    return [...all.values()]
  }, [kindProp, movements, role, schema, config.notion.movements?.dataSourceId])

  function kindOf(value: string): MovementKind | '' {
    return resolveKind(value, valueMap) ?? ''
  }

  function setKindOf(value: string, kind: MovementKind | '') {
    const next: Record<string, string[]> = {}
    for (const k of KINDS) next[k] = (valueMap[k] ?? []).filter((v) => nameKey(v) !== nameKey(value))
    if (kind) next[kind] = [...next[kind], value]
    setValueMap(next)
  }

  const unassignedKinds = role === 'movements' ? kindValues.filter((v) => !kindOf(v)) : []

  async function save() {
    if (!schema) return
    const src: SourceConfig = { dataSourceId: schema.id, databaseId: schema.databaseId, title: schema.title, fields, valueMap: role === 'movements' ? valueMap : {} }
    const next: AppConfig = { ...config, notion: { ...config.notion, [role]: src } }
    setBusy('save')
    const ok = await saveConfig(next)
    setBusy(null)
    if (ok) onSaved?.()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[260px] flex-1">
          <Field label="Enlace o ID de la base de datos" htmlFor={`src-${role}`}>
            <input id={`src-${role}`} className="field" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void resolve()} placeholder="https://www.notion.so/…" />
          </Field>
        </div>
        <button className="btn" onClick={() => void resolve()} disabled={!input.trim() || busy !== null}>
          {busy === 'resolve' ? <Spinner /> : null} Usar este enlace
        </button>
        <button className="btn" onClick={() => void listShared()} disabled={busy !== null}>
          {busy === 'list' ? <Spinner /> : <Search size={15} />} Ver bases de datos compartidas
        </button>
      </div>

      {error && (
        <Notice kind="error">
          <p>{error.message}</p>
          {error.hint && <p className="mt-0.5 text-[12.5px]">{error.hint}</p>}
        </Notice>
      )}

      {sources && (
        <div className="rounded-lg border border-line">
          {sources.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-mist">
              La integración no puede ver ninguna base de datos. En Notion, abre la base de datos → menú «···» → Conexiones → añade tu integración, y vuelve a buscar.
            </p>
          ) : (
            <ul>
              {sources.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0">
                  <span className="truncate">{s.title}</span>
                  <button className="btn btn-sm" onClick={() => void choose(s.id)} disabled={busy !== null}>
                    {schema?.id === s.id ? 'Seleccionada' : 'Elegir'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {busy === 'schema' && (
        <p className="flex items-center gap-2 text-[13px] text-mist">
          <Spinner /> Leyendo las propiedades…
        </p>
      )}

      {schema && (
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px]">
            Base de datos: <strong>{schema.title || '(sin título)'}</strong> <span className="text-mist">({schema.properties.length} propiedades)</span>
          </p>
          <table className="data-table text-[13.5px]">
            <thead>
              <tr>
                <th className="w-[200px]">Campo de Lunar</th>
                <th>Propiedad de Notion</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((spec) => {
                const options = schema.properties.filter((p) => spec.types.includes(p.type))
                const value = fields[spec.key]?.id ?? ''
                return (
                  <tr key={spec.key}>
                    <td>
                      <div className="font-medium">
                        {spec.label}
                        {spec.required ? '' : <span className="font-normal text-mist"> (opcional)</span>}
                      </div>
                      {spec.help && <div className="text-[12px] text-mist">{spec.help}</div>}
                    </td>
                    <td>
                      <select
                        className="field"
                        aria-label={`Propiedad para ${spec.label}`}
                        value={value}
                        aria-invalid={spec.required && !value}
                        onChange={(e) => {
                          const p = schema.properties.find((x) => x.id === e.target.value)
                          setFields((f) => {
                            const n = { ...f }
                            if (p) n[spec.key] = toFieldRef(p)
                            else delete n[spec.key]
                            return n
                          })
                        }}
                      >
                        <option value="">{spec.required ? 'Elige una propiedad' : 'No usar'}</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.type})
                          </option>
                        ))}
                      </select>
                      {options.length === 0 && <p className="mt-1 text-[12px] text-warn">No hay propiedades de tipo {spec.types.join(' o ')}.</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {role === 'movements' && fields.kind && (
            <div>
              <h3 className="mb-1 text-[13.5px] font-medium">Valores de «{fields.kind.name}»</h3>
              <p className="mb-2 text-[12.5px] text-mist">Indica qué significa cada valor. Un valor sin asignar deja el movimiento fuera de los totales (nunca se adivina).</p>
              {kindValues.length === 0 ? (
                <p className="text-[13px] text-mist">No hay valores todavía. Se reconocerán «Gasto», «Ingreso», «Devolución» y «Transferencia».</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {kindValues.map((v) => (
                    <label key={v} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-[13.5px]">
                      <span className="truncate">{v}</span>
                      <select className="field w-auto py-1" value={kindOf(v)} onChange={(e) => setKindOf(v, e.target.value as MovementKind | '')} aria-label={`Significado de ${v}`}>
                        <option value="">Sin asignar</option>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {unassignedKinds.length > 0 && <p className="mt-2 text-[12.5px] text-warn">Sin asignar: {unassignedKinds.join(', ')}.</p>}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={() => void save()} disabled={missing.length > 0 || busy !== null}>
              {busy === 'save' ? <Spinner /> : null} Guardar y leer datos
            </button>
            {missing.length > 0 && <span className="text-[12.5px] text-mist">Falta asignar: {missing.map((m) => m.label).join(', ')}.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
