import { CircleAlert, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { MODEL_CATALOG, aiState, chooseModel, formatBytes, recommendDownload, suitableModels } from '../services/ai'
import { cancelPull, getHost, openOllamaDownload, pullModel, refreshAi, setAiPrefs, startAi } from '../state/actions'
import { useApp } from '../state/store'
import { Spinner } from '../ui/primitives'

function Progress({ completed, total, status }: { completed: number; total: number; status: string }) {
  // Solo se muestra porcentaje cuando Ollama informa bytes reales; si no, actividad sin cifras.
  if (total > 0) {
    const pct = Math.floor((completed / total) * 100)
    return (
      <div className="flex flex-col gap-1" role="status">
        <progress className="h-2 w-full" value={completed} max={total} aria-label="Progreso de la descarga" />
        <span className="num text-[12.5px] text-mist">
          {pct} % · {formatBytes(completed)} de {formatBytes(total)}
        </span>
      </div>
    )
  }
  return (
    <span className="flex items-center gap-2 text-[13px] text-mist" role="status">
      <Spinner /> {status}
    </span>
  )
}

export function AiSettings() {
  const ai = useApp((s) => s.ai)
  const prefs = useApp((s) => s.prefs.ai)
  const supported = getHost().ai !== null
  const model = chooseModel(ai.status, prefs.model)
  const state = aiState(ai.status, supported, model)
  const installed = suitableModels(ai.status?.models ?? [])
  const recommended = ai.status ? recommendDownload(ai.status.resources) : MODEL_CATALOG[0]
  const [choice, setChoice] = useState<string>(recommended.name)
  const [confirming, setConfirming] = useState(false)
  const pull = ai.pull
  const pulling = pull?.state === 'running'
  const free = ai.status?.resources.freeDiskBytes ?? null
  const chosen = MODEL_CATALOG.find((m) => m.name === choice) ?? recommended

  if (state === 'unsupported') return <p className="text-[13px] text-mist">Disponible en la aplicación de escritorio.</p>

  const check = (
    <button className="btn btn-sm btn-ghost" onClick={() => void refreshAi()} disabled={ai.checking}>
      {ai.checking ? <Spinner /> : null} Comprobar
    </button>
  )

  return (
    <div className="flex flex-col gap-3 text-[13.5px]">
      {state === 'not_installed' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-mist">Ollama no está instalado.</span>
          <button className="btn btn-sm btn-primary" onClick={() => void openOllamaDownload()}>
            Instalar Ollama
          </button>
          {check}
        </div>
      )}

      {state === 'stopped' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-mist">Ollama está detenido.</span>
          {ai.status?.canStart && (
            <button className="btn btn-sm btn-primary" onClick={() => void startAi()} disabled={ai.starting}>
              {ai.starting ? <Spinner /> : null} Iniciar Ollama
            </button>
          )}
          {check}
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-wrap items-center gap-2 text-negative">
          <CircleAlert size={15} aria-hidden />
          <span>{ai.status?.error?.message ?? 'No se pudo comprobar Ollama.'}</span>
          <button className="btn btn-sm" onClick={() => void refreshAi()} disabled={ai.checking}>
            Reintentar
          </button>
        </div>
      )}

      {state === 'ready' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-positive">
            <CircleCheck size={15} aria-hidden /> Disponible
          </span>
          <select className="field w-auto py-1" aria-label="Modelo" value={model ?? ''} onChange={(e) => void setAiPrefs({ model: e.target.value })}>
            {installed.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {formatBytes(m.size)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.enabled} onChange={(e) => void setAiPrefs({ enabled: e.target.checked, model })} />
            Proponer categorías con IA
          </label>
          {check}
        </div>
      )}

      {(state === 'no_model' || pull) && ai.status?.running && (
        <div className="flex max-w-xl flex-col gap-2 rounded-lg border border-line px-4 py-3">
          {pulling && pull ? (
            <>
              <span>Descargando {pull.model}</span>
              <Progress completed={pull.completed} total={pull.total} status={pull.status} />
              <div>
                <button className="btn btn-sm" onClick={() => void cancelPull()}>
                  Cancelar
                </button>
              </div>
            </>
          ) : pull && (pull.state === 'cancelled' || pull.state === 'error') ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={pull.state === 'error' ? 'text-negative' : 'text-mist'}>{pull.state === 'error' ? (pull.error?.message ?? 'La descarga falló.') : 'Descarga cancelada.'}</span>
              <button className="btn btn-sm btn-primary" onClick={() => void pullModel(pull.model)}>
                Reanudar
              </button>
            </div>
          ) : state === 'no_model' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-mist">Sin modelo de texto.</span>
                <select className="field w-auto py-1" aria-label="Modelo a descargar" value={choice} onChange={(e) => (setChoice(e.target.value), setConfirming(false))}>
                  {MODEL_CATALOG.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.label} · {formatBytes(m.downloadBytes)}
                      {m.name === recommended.name ? ' · recomendado' : ''}
                    </option>
                  ))}
                </select>
                {!confirming && (
                  <button className="btn btn-sm btn-primary" onClick={() => setConfirming(true)}>
                    Descargar modelo
                  </button>
                )}
              </div>
              {confirming && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Descargar <strong>{chosen.name}</strong> ({formatBytes(chosen.downloadBytes)})
                    {free !== null && <span className="text-mist"> · libres: {formatBytes(free)}</span>}
                  </span>
                  <button className="btn btn-sm btn-primary" disabled={free !== null && free < chosen.downloadBytes * 1.1} onClick={() => (setConfirming(false), void pullModel(chosen.name))}>
                    Confirmar
                  </button>
                  <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                    Cancelar
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {ai.status?.running && ai.status.version && <span className="text-[12px] text-faint">Ollama {ai.status.version}</span>}
    </div>
  )
}
