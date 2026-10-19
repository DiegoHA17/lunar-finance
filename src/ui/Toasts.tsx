import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { dismissToast } from '../state/actions'
import { useApp } from '../state/store'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? CircleAlert : t.kind === 'success' ? CircleCheck : Info
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-pop)]" role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={16} className={t.kind === 'error' ? 'mt-0.5 text-negative' : t.kind === 'success' ? 'mt-0.5 text-positive' : 'mt-0.5 text-accent'} aria-hidden />
            <div className="min-w-0 flex-1 text-[13.5px]">
              <p className="text-ink">{t.message}</p>
              {t.hint && <p className="mt-0.5 break-words text-[12.5px] text-mist">{t.hint}</p>}
              {t.action && (
                <button
                  className="btn btn-sm mt-2"
                  onClick={() => {
                    t.action!.run()
                    dismissToast(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="text-mist hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
