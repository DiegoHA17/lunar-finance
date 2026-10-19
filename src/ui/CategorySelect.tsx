import { categoryKindFor, sortCategories } from '../domain/categories'
import { cx } from './cx'
import type { Category, MovementKind } from '../domain/types'

/**
 * Selector nativo de categoría (accesible por teclado). Solo ofrece categorías activas y compatibles con el tipo
 * del movimiento; la categoría actual se muestra aunque esté archivada, pero no se puede volver a elegir otra
 * archivada.
 */
export function CategorySelect({
  value,
  kind,
  categories,
  onChange,
  id,
  label = 'Categoría',
  className,
  disabled,
  noneLabel = 'Sin categoría',
  unknownLabel,
}: {
  value: string | null
  kind: MovementKind | null
  categories: Category[]
  onChange: (id: string | null) => void
  id?: string
  label?: string
  className?: string
  disabled?: boolean
  noneLabel?: string
  /** Si el movimiento tiene una categoría que no está en el catálogo, se muestra con esta etiqueta. */
  unknownLabel?: string
}) {
  const wanted = categoryKindFor(kind)
  const sorted = sortCategories(categories)
  const current = categories.find((c) => c.id === value)
  const usable = sorted.filter((c) => c.status === 'active' && (!wanted || c.kind === wanted))
  const groups: { label: string; items: Category[] }[] = wanted
    ? [{ label: wanted === 'income' ? 'Ingresos' : 'Gastos', items: usable }]
    : [
        { label: 'Gastos', items: usable.filter((c) => c.kind === 'expense') },
        { label: 'Ingresos', items: usable.filter((c) => c.kind === 'income') },
      ]
  return (
    <select
      id={id}
      aria-label={label}
      className={cx('field', className)}
      value={value ?? (unknownLabel ? '__unknown' : '')}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">{noneLabel}</option>
      {unknownLabel && !value && (
        <option value="__unknown" disabled>
          {unknownLabel}
        </option>
      )}
      {current && !usable.includes(current) && (
        <option value={current.id} disabled>
          {current.name} {current.status === 'archived' ? '(archivada)' : '(otro tipo)'}
        </option>
      )}
      {groups.map((g) =>
        g.items.length ? (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  )
}
