/** Piezas básicas reutilizables de la interfaz. */

import { CircleAlert, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, createElement, useEffect, useId, useRef } from 'react'
import { cx } from './cx'
import { formatEUR } from '../domain/money'
import type { Category } from '../domain/types'
import type { CategoryRowStatus } from '../domain/stats'
import { LunarError } from '../infra/contracts'
import { categoryIcon } from './icons'
import { swatchColor } from './palette'

export function Spinner({ className = '' }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cx('animate-spin', className)} size={16} />
}

/** Importe con cifras tabulares. `signed` muestra «+» en positivos; el color solo refuerza, nunca es la única señal. */
export function Money({ cents, signed, tone, className }: { cents: number; signed?: boolean; tone?: 'auto' | 'none'; className?: string }) {
  const color = tone === 'auto' ? (cents > 0 ? 'text-positive' : cents < 0 ? 'text-negative' : '') : ''
  return <span className={cx('num whitespace-nowrap', color, className)}>{formatEUR(cents, { signed })}</span>
}

export function CategoryDot({ color, size = 8 }: { color: string; size?: number }) {
  if (color === 'none') return <span aria-hidden className="inline-block shrink-0 rounded-full border border-dashed border-line-strong" style={{ width: size, height: size }} />
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: swatchColor(color) }} />
}

export function CategoryLabel({
  name,
  color,
  icon,
  status,
  showIcon = true,
}: {
  name: string
  color: string
  icon: string
  status?: CategoryRowStatus | Category['status']
  showIcon?: boolean
}) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', status === 'none' && 'text-mist')}>
      {showIcon ? (
        <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: color === 'none' ? 'var(--hover)' : `color-mix(in srgb, ${swatchColor(color)} 16%, transparent)` }}>
          {createElement(categoryIcon(icon), { size: 14, style: { color: color === 'none' ? 'var(--mist)' : swatchColor(color) }, 'aria-hidden': true })}
        </span>
      ) : (
        <CategoryDot color={color} />
      )}
      <span className="truncate">{name}</span>
      {status === 'archived' && <span className="chip">archivada</span>}
      {status === 'unknown' && (
        <span className="chip" title="Esta categoría no está en el catálogo">
          no catalogada
        </span>
      )}
    </span>
  )
}

export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-14 text-center">
      {icon ?? <MoonGlyph />}
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children && <div className="text-mist">{children}</div>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

/** Pequeña luna decorativa para estados vacíos. */
export function MoonGlyph({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r="15" fill="var(--accent-soft)" />
      <path d="M22 7a15 15 0 1 1 0 30a11 15 0 1 0 0-30Z" fill="var(--accent)" opacity="0.75" />
      <circle cx="7" cy="9" r="1" fill="var(--faint)" />
      <circle cx="38" cy="36" r="1.2" fill="var(--faint)" />
      <circle cx="37" cy="8" r="0.8" fill="var(--faint)" />
    </svg>
  )
}

export function Notice({ kind = 'info', children, actions }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode; actions?: ReactNode }) {
  const Icon = kind === 'error' ? CircleAlert : kind === 'warn' ? TriangleAlert : Info
  return (
    <div className={cx('notice', `notice-${kind}`)} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

/** Error explicado: qué ha pasado, qué hacer y el detalle técnico plegado. */
export function ErrorPanel({ error, onRetry, actions }: { error: unknown; onRetry?: () => void; actions?: ReactNode }) {
  const err = LunarError.from(error)
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-12" role="alert">
      <div className="flex items-center gap-2 text-negative">
        <CircleAlert size={18} aria-hidden />
        <h2 className="text-base font-semibold">{err.message}</h2>
      </div>
      {err.hint && <p className="text-ink-2">{err.hint}</p>}
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            Reintentar
          </button>
        )}
        {actions}
      </div>
      {err.detail && (
        <details className="text-xs text-mist">
          <summary className="cursor-pointer">Detalle técnico</summary>
          <code className="mt-1 block break-all">{err.detail}</code>
        </details>
      )}
    </div>
  )
}

/** Diálogo modal nativo (`<dialog>`): foco atrapado, Escape y fondo gestionados por el navegador. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={wide ? { width: 'min(860px, calc(100vw - 32px))' } : undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
            <h2 id={titleId} className="text-[15px] font-semibold">
              {title}
            </h2>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
              <X size={16} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-negative" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-mist">{hint}</p>
      )}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, leading }: { title: string; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-night">{title}</h1>
          {subtitle && <div className="mt-0.5 text-[13px] text-mist">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Skeleton({ className }: { className: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}
