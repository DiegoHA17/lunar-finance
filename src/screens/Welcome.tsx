import logo from '../assets/brand/lunar-logo-256.png'
import { navigate, setPrefs, switchMode } from '../state/actions'

/** Primera apertura: conectar con Notion o explorar con datos de demostración. */
export function Welcome() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="flex max-w-[520px] flex-col gap-6">
        <img src={logo} width={112} height={112} alt="Lunar Finance" className="-ml-2 select-none" draggable={false} />
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.015em] text-night">Tus gastos de Notion, ordenados.</h1>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            onClick={async () => {
              await setPrefs({ welcomed: true })
              navigate('settings')
            }}
          >
            Conectar con Notion
          </button>
          <button className="btn" onClick={() => void switchMode('demo')}>
            Ver demostración
          </button>
        </div>
      </div>
    </div>
  )
}
