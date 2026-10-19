import { CircleAlert, CircleCheck, KeyRound, Lock, TriangleAlert } from 'lucide-react'
import { cx } from '../ui/cx'
import { type ReactNode, useState } from 'react'
import { type DiagnosticReport, LunarError } from '../infra/contracts'
import { originPropertyPlan } from '../services/migration'
import { applyOriginMigration, backend, clearToken, saveConfig, saveToken, setPrefs, switchMode } from '../state/actions'
import { type ThemePref, useApp } from '../state/store'
import { Notice, PageHeader, Spinner } from '../ui/primitives'
import { SourceSetup } from './SourceSetup'

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-7 first:pt-0 last:border-0 lg:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-[15px] font-semibold text-night">{title}</h2>
        {description && <div className="mt-1 text-[13px] text-mist">{description}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function TokenSection() {
  const configured = useApp((s) => s.tokenConfigured)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className={cx('flex items-center gap-2 text-[13.5px]', configured ? 'text-positive' : 'text-mist')}>
        {configured ? <Lock size={15} /> : <KeyRound size={15} />}
        {configured ? 'Token guardado en el Administrador de credenciales de Windows. No se vuelve a mostrar.' : 'No hay ningún token guardado en este equipo.'}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setSaving(true)
          if (await saveToken(token)) setToken('')
          setSaving(false)
        }}
      >
        <div className="min-w-[280px] flex-1">
          <label htmlFor="token" className="mb-1 block text-[13px] font-medium text-ink-2">
            {configured ? 'Sustituir el token' : 'Secreto de la integración'}
          </label>
          <input id="token" type="password" autoComplete="off" spellCheck={false} className="field" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={!token.trim() || saving}>
          {saving ? <Spinner /> : null} Guardar token
        </button>
        {configured &&
          (confirmClear ? (
            <button type="button" className="btn btn-danger" onClick={() => void clearToken().then(() => setConfirmClear(false))} onBlur={() => setConfirmClear(false)} autoFocus>
              Confirmar: eliminar
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConfirmClear(true)}>
              Eliminar token
            </button>
          ))}
      </form>
      <details className="rounded-lg border border-line px-4 py-3 text-[13.5px]">
        <summary className="cursor-pointer font-medium">Cómo obtener el token y dar acceso a tu base de datos</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-2">
          <li>
            Abre <strong>notion.so/profile/integrations</strong> y crea una integración <em>interna</em> (por ejemplo, «Lunar») en el espacio de trabajo donde está tu base de datos de gastos.
          </li>
          <li>En «Capacidades», activa «Leer contenido», «Actualizar contenido» e «Insertar contenido».</li>
          <li>Copia el «Internal Integration Secret» (empieza por «ntn_») y pégalo arriba. Se guarda cifrado por Windows; Lunar no lo escribe en ningún archivo.</li>
          <li>
            <strong>Comparte la base de datos con la integración</strong>: abre la base de datos en Notion → menú «···» arriba a la derecha → Conexiones → busca la integración y confírmalo. Sin este paso Notion responde «404 object_not_found» aunque el token sea correcto.
          </li>
          <li>Si vas a crear el catálogo de categorías, comparte también la página que contiene la base de datos.</li>
        </ol>
        <p className="mt-2 text-mist">Puedes reutilizar la integración del atajo «Atajo iPhone», pero una integración propia para Lunar permite revocar una sin romper la otra.</p>
      </details>
    </div>
  )
}

function StepIcon({ status }: { status: 'ok' | 'warning' | 'error' }) {
  if (status === 'ok') return <CircleCheck size={16} className="text-positive" aria-label="Correcto" />
  if (status === 'warning') return <TriangleAlert size={16} className="text-warn" aria-label="Aviso" />
  return <CircleAlert size={16} className="text-negative" aria-label="Error" />
}

function Diagnostics() {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [error, setError] = useState<LunarError | null>(null)
  const [running, setRunning] = useState(false)
  async function run() {
    setRunning(true)
    setError(null)
    try {
      setReport(await backend().diagnose())
    } catch (e) {
      setError(LunarError.from(e))
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button className="btn" onClick={() => void run()} disabled={running}>
          {running ? <Spinner /> : null} {report ? 'Repetir diagnóstico' : 'Ejecutar diagnóstico'}
        </button>
      </div>
      {error && <Notice kind="error">{error.message}</Notice>}
      {report && (
        <ol className="flex flex-col rounded-lg border border-line" aria-live="polite">
          {report.steps.map((s) => (
            <li key={s.id} className="flex gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="mt-0.5">
                <StepIcon status={s.status} />
              </span>
              <div className="min-w-0 text-[13.5px]">
                <p className="font-medium">{s.title}</p>
                <p className="whitespace-pre-line text-ink-2">{s.detail}</p>
                {s.hint && <p className="mt-1 text-[12.5px] text-mist">{s.hint}</p>}
                {s.error?.detail && <p className="mt-1 font-mono text-[11.5px] break-all text-faint">{s.error.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {report?.movementsReady && <p className="text-[13px] text-positive">La conexión funciona: Lunar puede leer tus movimientos.</p>}
    </div>
  )
}

function Migrations() {
  const config = useApp((s) => s.config)
  const plan = originPropertyPlan(config)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!config.notion.movements) return <p className="text-[13px] text-mist">Configura primero la base de datos de movimientos.</p>
  if (!plan) return <p className="text-[13px] text-mist">No hay cambios pendientes. El origen de las clasificaciones se registra en «{config.notion.movements.fields.origin?.name}».</p>
  return (
    <div className="rounded-lg border border-line px-4 py-3 text-[13.5px]">
      <p className="font-medium">{plan.title}</p>
      <p className="mt-0.5 text-ink-2">{plan.description}</p>
      <p className="mt-2 font-medium">Cambio en Notion</p>
      <ul className="list-disc pl-5 text-ink-2">
        {plan.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="mt-2 font-medium">Consecuencias</p>
      <ul className="list-disc pl-5 text-ink-2">
        {plan.consequences.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        {confirm ? (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await applyOriginMigration()
                setBusy(false)
                setConfirm(false)
              }}
            >
              {busy ? <Spinner /> : null} Sí, añadir la propiedad
            </button>
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>
            Añadir la propiedad…
          </button>
        )}
      </div>
    </div>
  )
}

function CategoriesSource() {
  const config = useApp((s) => s.config)
  const [editing, setEditing] = useState(false)
  const src = config.notion.categories
  if (!src && !editing) {
    return (
      <div className="flex flex-col items-start gap-2 text-[13.5px]">
        <p className="text-ink-2">No hay catálogo. Puedes crearlo desde la pantalla Categorías o conectar una base de datos que ya tengas.</p>
        <button className="btn" onClick={() => setEditing(true)}>
          Conectar una base de datos existente
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {src && !editing && (
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span>
            Catálogo: <strong>{src.title ?? src.dataSourceId}</strong>
          </span>
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Revisar mapeo
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => void saveConfig({ ...config, notion: { ...config.notion, categories: undefined } })}
            title="Lunar dejará de usarlo. No se borra nada en Notion."
          >
            Desconectar
          </button>
        </div>
      )}
      {editing && <SourceSetup role="categories" onSaved={() => setEditing(false)} />}
    </div>
  )
}

export function Settings() {
  const mode = useApp((s) => s.mode)
  const native = useApp((s) => s.native)
  const theme = useApp((s) => s.prefs.theme)
  const config = useApp((s) => s.config)
  const [editMovements, setEditMovements] = useState(false)
  const demo = mode === 'demo'

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="panel px-7 py-7">
        <Section title="Datos" description="De dónde lee Lunar los movimientos.">
          <div className="seg" role="group" aria-label="Origen de los datos">
            <button aria-pressed={!demo} onClick={() => void switchMode('notion')} disabled={!native}>
              Mis datos de Notion
            </button>
            <button aria-pressed={demo} onClick={() => void switchMode('demo')}>
              Demostración
            </button>
          </div>
          {!native && <p className="mt-2 text-[13px] text-mist">En el navegador solo está disponible la demostración. La conexión con Notion requiere la aplicación de escritorio.</p>}
        </Section>

        {!demo && (
          <Section title="Conexión con Notion" description="El token se guarda en el Administrador de credenciales de Windows, nunca en archivos ni en la interfaz.">
            <TokenSection />
          </Section>
        )}

        <Section title="Base de datos de movimientos" description="La base de datos donde el atajo «Gasto» registra tus movimientos, y qué propiedad corresponde a cada dato.">
          {config.notion.movements && !editMovements ? (
            <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <span>
                <strong>{config.notion.movements.title ?? config.notion.movements.dataSourceId}</strong>
              </span>
              <button className="btn btn-sm" onClick={() => setEditMovements(true)}>
                Cambiar o revisar el mapeo
              </button>
            </div>
          ) : (
            <SourceSetup role="movements" onSaved={() => setEditMovements(false)} />
          )}
        </Section>

        <Section title="Diagnóstico" description="Comprueba paso a paso el token, los permisos, el identificador y el esquema. No modifica nada.">
          <Diagnostics />
        </Section>

        <Section title="Catálogo de categorías" description="Base de datos de Notion con tus categorías.">
          <CategoriesSource />
        </Section>

        <Section title="Mejoras opcionales del esquema" description="Cambios no destructivos en tu base de datos. Nunca se aplican sin tu confirmación.">
          <Migrations />
        </Section>

        <Section title="Apariencia">
          <div className="seg" role="group" aria-label="Tema">
            {(
              [
                ['system', 'Como el sistema'],
                ['light', 'Claro'],
                ['dark', 'Oscuro'],
              ] as [ThemePref, string][]
            ).map(([v, label]) => (
              <button key={v} aria-pressed={theme === v} onClick={() => void setPrefs({ theme: v })}>
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Acerca de Lunar">
          <dl className="grid grid-cols-[180px_1fr] gap-y-1 text-[13.5px]">
            <dt className="text-mist">Versión</dt>
            <dd>0.1.0</dd>
            <dt className="text-mist">API de Notion</dt>
            <dd>2026-03-11 (fuentes de datos)</dd>
            <dt className="text-mist">Datos locales</dt>
            <dd>Configuración, reglas y preferencias en %APPDATA%\com.lunar.finance. Los movimientos y categorías solo están en Notion.</dd>
          </dl>
        </Section>
      </div>
    </>
  )
}
