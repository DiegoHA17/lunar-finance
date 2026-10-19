/// <reference types="vite/client" />

declare global {
  /** Versión de package.json, inyectada en compilación (vite.config.ts). */
  const __APP_VERSION__: string
}

export {}
