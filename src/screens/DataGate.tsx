/**
 * Decide qué mostrar según el estado de los datos. Distingue explícitamente:
 *   - sin configurar → invitación a conectar;
 *   - cargando sin datos → esqueleto;
 *   - error sin datos → error explicado (nunca una lista vacía);
 *   - error con datos previos → datos + aviso de que pueden estar desactualizados.
 */

import type { ReactNode } from 'react'
import { formatInstant } from '../domain/dates'
import { isReady, navigate, refresh, switchMode } from '../state/actions'
import { useApp } from '../state/store'
import { EmptyState, ErrorPanel, Notice, Skeleton } from '../ui/primitives'

export function DataGate({ children }: { children: ReactNode }) {
  const data = useApp((s) => s.data)
  const native = useApp((s) => s.native)
  const mode = useApp((s) => s.mode)
  const tokenConfigured = useApp((s) => s.tokenConfigured)
  const ready = useApp(() => isReady())

  if (!ready) {
    return (
      <EmptyState
        title={tokenConfigured ? 'Elige tu base de datos de movimientos' : 'Conecta Lunar Finance con Notion'}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => navigate('settings')}>
              {tokenConfigured ? 'Configurar la base de datos' : 'Configurar la conexión'}
            </button>
            {native && mode !== 'demo' && (
              <button className="btn" onClick={() => void switchMode('demo')}>
                Ver demostración
              </button>
            )}
          </>
        }
      />
    )
  }

  const hasData = data.fetchedAt !== null
  if (!hasData && (data.status === 'loading' || data.status === 'idle')) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando datos de Notion">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }
  if (!hasData && data.status === 'error') {
    return (
      <ErrorPanel
        error={data.error}
        onRetry={() => void refresh()}
        actions={
          <button className="btn" onClick={() => navigate('settings')}>
            Abrir diagnóstico
          </button>
        }
      />
    )
  }
  return (
    <>
      {data.status === 'error' && data.error && (
        <div className="mb-4">
          <Notice
            kind="error"
            actions={
              <button className="btn btn-sm" onClick={() => void refresh()}>
                Reintentar
              </button>
            }
          >
            <p>
              No se pudo actualizar: {data.error.message} {data.fetchedAt && <span className="opacity-80">(datos del {formatInstant(data.fetchedAt)})</span>}
            </p>
            {data.error.hint && <p className="mt-0.5 text-[12.5px] opacity-85">{data.error.hint}</p>}
          </Notice>
        </div>
      )}
      {data.notices.map((n) => (
        <div key={n} className="mb-4">
          <Notice kind="warn">{n}</Notice>
        </div>
      ))}
      {children}
    </>
  )
}
