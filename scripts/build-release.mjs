/**
 * Compilación de distribución: `npm run release`.
 * Igual que `tauri build`, pero sustituye las rutas locales (carpeta del proyecto, de Cargo y de rustup) por rutas
 * neutras dentro de los binarios, para no distribuir el nombre de usuario del equipo de compilación.
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup')
const remap = [
  [cargoHome, '/cargo'],
  [rustupHome, '/rustup'],
  [root, '/lunar-finance'],
].map(([from, to]) => `--remap-path-prefix=${from}=${to}`)

// CARGO_ENCODED_RUSTFLAGS (separador 0x1f) admite rutas con espacios, como «Lunar Finance».
const extra = (process.env.RUSTFLAGS ?? '').split(' ').filter(Boolean)
const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: [...extra, ...remap].join('\x1f') }
delete env.RUSTFLAGS
const args = ['tauri', 'build', ...process.argv.slice(2)]
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
