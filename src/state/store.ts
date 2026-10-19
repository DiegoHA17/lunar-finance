/** Estado global mínimo (sin dependencias): un objeto inmutable, suscriptores y selectores. */

import { useSyncExternalStore } from 'react'
import type { Rule } from '../domain/classifier/rules'
import { today } from '../domain/dates'
import { type Period, type PeriodKind, periodContaining } from '../domain/periods'
import type { Category, Movement } from '../domain/types'
import type { AppConfig, LunarError, PageDto } from '../infra/contracts'

export type Screen = 'dashboard' | 'movements' | 'categories' | 'rules' | 'reports' | 'settings'
export type ThemePref = 'system' | 'light' | 'dark'
export type DataMode = 'notion' | 'demo'

export interface Preferences {
  theme: ThemePref
  mode: DataMode
  periodKind: Exclude<PeriodKind, 'custom'>
  welcomed: boolean
}

export const DEFAULT_PREFS: Preferences = { theme: 'system', mode: 'notion', periodKind: 'month', welcomed: false }

export interface DataState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  movements: Movement[]
  categories: Category[]
  pages: Map<string, PageDto>
  categoryPages: Map<string, PageDto>
  fetchedAt: string | null
  complete: boolean
  notices: string[]
  catalog: 'notion' | 'implicit'
  /** Error de la última carga. Si había datos previos, se siguen mostrando con un aviso. */
  error: LunarError | null
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  hint?: string
  action?: { label: string; run: () => void }
}

export interface MovementsNav {
  /** Filtro que otra pantalla pide aplicar al abrir Movimientos (p. ej. «ver movimientos de esta categoría»). */
  categoryKey?: string
  status?: 'pending' | 'excluded'
  nonce: number
}

export interface AppState {
  booted: boolean
  native: boolean
  mode: DataMode
  tokenConfigured: boolean
  config: AppConfig
  data: DataState
  rules: Rule[]
  rulesNotice: string | null
  prefs: Preferences
  screen: Screen
  period: Period
  movementsNav: MovementsNav | null
  toasts: Toast[]
}

export const EMPTY_DATA: DataState = {
  status: 'idle',
  movements: [],
  categories: [],
  pages: new Map(),
  categoryPages: new Map(),
  fetchedAt: null,
  complete: true,
  notices: [],
  catalog: 'implicit',
  error: null,
}

type Listener = () => void

class Store<T> {
  private state: T
  private listeners = new Set<Listener>()

  constructor(initial: T) {
    this.state = initial
  }

  get = (): T => this.state

  set = (patch: Partial<T> | ((s: T) => Partial<T>)) => {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l()
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export const store = new Store<AppState>({
  booted: false,
  native: false,
  mode: 'notion',
  tokenConfigured: false,
  config: { version: 1, notion: {} },
  data: EMPTY_DATA,
  rules: [],
  rulesNotice: null,
  prefs: DEFAULT_PREFS,
  screen: 'dashboard',
  period: periodContaining('month', today()),
  movementsNav: null,
  toasts: [],
})

/** Suscripción a una parte del estado. El selector debe devolver referencias estables (partes del estado). */
export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}
