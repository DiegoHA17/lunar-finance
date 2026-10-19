import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_AUTHOR, APP_NAME, APP_VERSION } from './app-info'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('identidad y versión', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string }
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string; productName: string; bundle: { publisher: string } }

  it('la versión tiene una única fuente (package.json) y Cargo está sincronizado', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(tauri.version).toBe('../package.json')
    expect(read('src-tauri/Cargo.toml')).toMatch(new RegExp(`^version = "${pkg.version.replace(/\./g, '\\.')}"`, 'm'))
  })

  it('nombre y autor coinciden con los metadatos del instalador', () => {
    expect(APP_NAME).toBe('Lunar Finance')
    expect(tauri.productName).toBe(APP_NAME)
    expect(tauri.bundle.publisher).toBe(APP_AUTHOR)
  })
})
