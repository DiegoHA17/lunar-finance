import { useEffect, useLayoutEffect, useRef } from 'react'
import { Categories } from './screens/Categories'
import { Dashboard } from './screens/Dashboard'
import { Movements } from './screens/Movements'
import { Reports } from './screens/Reports'
import { Rules } from './screens/Rules'
import { Settings } from './screens/Settings'
import { Welcome } from './screens/Welcome'
import { Sidebar } from './screens/Sidebar'
import { switchMode } from './state/actions'
import { useApp } from './state/store'
import logo from './assets/brand/lunar-logo-256.png'
import { Spinner } from './ui/primitives'
import { Toasts } from './ui/Toasts'

function useTheme() {
  const theme = useApp((s) => s.prefs.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function DemoBanner() {
  const native = useApp((s) => s.native)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warn-line bg-warn-soft px-5 py-1.5 text-[13px] text-warn" role="status">
      <span>
        <strong className="font-semibold">Demostración</strong> · datos ficticios
      </span>
      {native && (
        <button className="btn btn-sm border-warn-line bg-transparent text-warn" onClick={() => void switchMode('notion')}>
          Usar mis datos de Notion
        </button>
      )}
    </div>
  )
}

export function App() {
  useTheme()
  const booted = useApp((s) => s.booted)
  const screen = useApp((s) => s.screen)
  const mode = useApp((s) => s.mode)
  const welcomed = useApp((s) => s.prefs.welcomed)
  const native = useApp((s) => s.native)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [screen])

  if (!booted) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-mist">
          <img src={logo} width={72} height={72} alt="Lunar Finance" className="select-none" draggable={false} />
          <Spinner />
        </div>
      </div>
    )
  }

  if (native && !welcomed) return <Welcome />

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'demo' && <DemoBanner />}
        <main ref={mainRef} id="main" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
          <div className="mx-auto w-full max-w-[1180px] px-6 pt-7 pb-12 lg:px-10">
            {screen === 'dashboard' && <Dashboard />}
            {screen === 'movements' && <Movements />}
            {screen === 'categories' && <Categories />}
            {screen === 'rules' && <Rules />}
            {screen === 'reports' && <Reports />}
            {screen === 'settings' && <Settings />}
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
