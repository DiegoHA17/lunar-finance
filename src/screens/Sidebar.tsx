import { ArrowLeftRight, FileText, LayoutDashboard, RefreshCw, Settings, Tags, WandSparkles } from 'lucide-react'
import logo from '../assets/brand/lunar-logo-64.png'
import { cx } from '../ui/cx'
import { formatInstant } from '../domain/dates'
import { needsClassification } from '../domain/movements'
import { isCounted } from '../domain/types'
import { isReady, navigate, refresh } from '../state/actions'
import { type Screen, useApp } from '../state/store'

const NAV: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'movements', label: 'Movimientos', icon: ArrowLeftRight },
  { id: 'categories', label: 'Categorías', icon: Tags },
  { id: 'rules', label: 'Reglas', icon: WandSparkles },
  { id: 'reports', label: 'Informes', icon: FileText },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-1.5 max-[960px]:justify-center max-[960px]:px-0">
      <img src={logo} width={28} height={28} alt="" className="shrink-0 select-none" draggable={false} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-night max-[960px]:hidden">Lunar Finance</span>
    </div>
  )
}

function NavButton({ id, label, icon: Icon, badge }: { id: Screen; label: string; icon: typeof LayoutDashboard; badge?: number }) {
  const active = useApp((s) => s.screen) === id
  return (
    <button
      onClick={() => navigate(id)}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cx(
        'flex w-full items-center gap-3 rounded-md px-2.5 py-[7px] text-left transition-colors max-[960px]:justify-center',
        active ? 'bg-selected font-medium text-night' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.1 : 1.8} aria-hidden className="shrink-0" />
      <span className="flex-1 max-[960px]:hidden">{label}</span>
      {badge ? (
        <span className="num rounded-full bg-accent-soft px-1.5 text-[11.5px] text-accent max-[960px]:hidden" aria-label={`${badge} pendientes de clasificar`}>
          {badge}
        </span>
      ) : null}
    </button>
  )
}

export function Sidebar() {
  const data = useApp((s) => s.data)
  const mode = useApp((s) => s.mode)
  const ready = useApp(() => isReady())
  const pending = data.movements.filter((m) => isCounted(m) && needsClassification(m)).length
  return (
    <nav aria-label="Navegación principal" className="flex w-[212px] shrink-0 flex-col gap-1 border-r border-line bg-sidebar px-3 pt-5 pb-3 max-[960px]:w-[64px] max-[960px]:px-2">
      <Logo />
      <div className="mt-6 flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavButton key={n.id} {...n} badge={n.id === 'movements' ? pending : undefined} />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {ready && (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-mist max-[960px]:justify-center">
            <button
              className="btn btn-ghost btn-icon size-7 min-h-7 shrink-0"
              onClick={() => void refresh()}
              disabled={data.status === 'loading'}
              aria-label="Actualizar datos desde Notion"
              title="Actualizar datos desde Notion"
            >
              <RefreshCw size={14} className={data.status === 'loading' ? 'animate-spin' : ''} />
            </button>
            <span className="leading-tight max-[960px]:hidden" aria-live="polite">
              {data.status === 'loading'
                ? 'Leyendo de Notion…'
                : data.fetchedAt
                  ? `${mode === 'demo' ? 'Demo · ' : ''}Actualizado ${formatInstant(data.fetchedAt)}`
                  : data.status === 'error'
                    ? 'Error al leer'
                    : ''}
            </span>
          </div>
        )}
        <NavButton id="settings" label="Ajustes" icon={Settings} />
      </div>
    </nav>
  )
}
