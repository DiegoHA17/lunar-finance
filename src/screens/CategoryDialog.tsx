import { useMemo, useState } from 'react'
import { cx } from '../ui/cx'
import { type CategoryDraft, validateCategoryDraft } from '../domain/categories'
import type { Category, CategoryKind } from '../domain/types'
import { createCategory, updateCategory } from '../state/actions'
import { useApp } from '../state/store'
import { CATEGORY_ICONS } from '../ui/icons'
import { SWATCHES, swatchColor } from '../ui/palette'
import { CategoryLabel, Dialog, Field, Notice } from '../ui/primitives'

export function CategoryDialog({
  category,
  onClose,
  defaultKind = 'expense',
  defaultName = '',
}: {
  category: Category | null
  onClose: () => void
  defaultKind?: CategoryKind
  defaultName?: string
}) {
  const all = useApp((s) => s.data.categories)
  const [draft, setDraft] = useState<CategoryDraft>(() =>
    category
      ? { id: category.id, name: category.name, kind: category.kind, color: category.color, icon: category.icon, description: category.description, aliases: category.aliases }
      : { name: defaultName, kind: defaultKind, color: 'moon', icon: 'tag', description: '', aliases: [] },
  )
  const [aliasText, setAliasText] = useState(draft.aliases.join(', '))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const candidate = useMemo(
    () => ({
      ...draft,
      aliases: aliasText
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    }),
    [draft, aliasText],
  )
  const errors = validateCategoryDraft(candidate, all)
  const renamed = category && category.name.trim() !== candidate.name.trim()

  async function save() {
    setSubmitted(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    const ok = category ? await updateCategory(category, candidate) : Boolean(await createCategory(candidate))
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? `Editar «${category.name}»` : 'Nueva categoría'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Guardando en Notion…' : category ? 'Guardar cambios' : 'Crear categoría'}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
          <span className="text-[12.5px] text-mist">Vista previa</span>
          <CategoryLabel name={candidate.name || 'Nombre de la categoría'} color={candidate.color} icon={candidate.icon} />
        </div>
        <Field label="Nombre" htmlFor="cat-name" error={submitted ? errors.name : undefined}>
          <input id="cat-name" className="field" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={submitted && Boolean(errors.name)} />
        </Field>
        {renamed && (
          <Notice kind="info">«{category!.name}» se guardará como alias: los movimientos antiguos con ese nombre seguirán asociados a esta categoría sin modificarlos.</Notice>
        )}
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Tipo</legend>
          <div className="seg" role="group">
            {(['expense', 'income'] as CategoryKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => setDraft({ ...draft, kind: k })}>
                {k === 'expense' ? 'Gasto' : 'Ingreso'}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Color</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {SWATCHES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={draft.color === s.key}
                aria-label={s.label}
                title={s.label}
                onClick={() => setDraft({ ...draft, color: s.key })}
                className={cx('size-7 rounded-full border-2 transition-transform', draft.color === s.key ? 'scale-110 border-ink' : 'border-transparent')}
                style={{ background: swatchColor(s.key) }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Icono</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5" role="radiogroup" aria-label="Icono">
            {Object.entries(CATEGORY_ICONS)
              .filter(([k]) => k !== 'circle-help')
              .map(([key, { icon: Icon, label }]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={draft.icon === key}
                  aria-label={label}
                  title={label}
                  onClick={() => setDraft({ ...draft, icon: key })}
                  className={cx('grid h-9 place-items-center rounded-md border transition-colors', draft.icon === key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-hover')}
                >
                  <Icon size={16} />
                </button>
              ))}
          </div>
        </fieldset>
        <Field label="Alias" htmlFor="cat-alias" error={submitted ? errors.aliases : undefined} hint="Otros nombres con los que aparece en tus movimientos, separados por comas.">
          <input id="cat-alias" className="field" value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="Súper, Compra semanal" />
        </Field>
        <Field label="Descripción (opcional)" htmlFor="cat-desc">
          <textarea id="cat-desc" className="field min-h-16" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
