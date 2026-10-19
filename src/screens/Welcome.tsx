import logo from '../assets/brand/lunar-logo-256.png'
import { navigate, setPrefs, switchMode } from '../state/actions'

/** Primera apertura: conectar con Notion o explorar con datos de demostración. */
export function Welcome() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="flex max-w-[520px] flex-col gap-6">
        <img src={logo} width={112} height={112} alt="Lunar" className="-ml-2 select-none" draggable={false} />
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.015em] text-night">Tus gastos de Notion, ordenados.</h1>
          <p className="mt-3 text-[15px] text-ink-2">
            Lunar lee los movimientos que registras con el atajo «Gasto», los clasifica con tus propias reglas y prepara informes en PDF y CSV. Tus datos siguen viviendo solo en tu Notion.
          </p>
        </div>
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
            Explorar con datos de demostración
          </button>
        </div>
        <p className="text-[12.5px] text-mist">Necesitarás el secreto de una integración interna de Notion con acceso a tu base de datos de gastos. Lunar te guía paso a paso.</p>
      </div>
    </div>
  )
}
