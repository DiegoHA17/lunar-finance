/**
 * Reúne los artefactos de distribución de la versión actual en release/<versión>/<plataforma>/ y genera
 * SHA256SUMS, manifest.json y MANIFEST.md. No sobrescribe un artefacto existente con contenido distinto: si ya
 * existe con otro hash, se detiene (hay que borrarlo a mano a propósito).
 *
 * Uso: node scripts/make-release-manifest.mjs   (después de `npm run release` en cada plataforma)
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundle = join(root, 'src-tauri', 'target', 'release', 'bundle')
const outRoot = join(root, 'release', version)

// Formato → plataforma. Solo se recogen artefactos de la versión actual.
const KINDS = [
  { dir: 'nsis', ext: '-setup.exe', platform: 'windows-x64', format: 'NSIS (instalador por usuario)' },
  { dir: 'msi', ext: '.msi', platform: 'windows-x64', format: 'MSI' },
  { dir: 'deb', ext: '.deb', platform: 'linux-x64', format: 'Debian/Ubuntu (.deb)' },
  { dir: 'rpm', ext: '.rpm', platform: 'linux-x64', format: 'Fedora/openSUSE (.rpm)' },
  { dir: 'appimage', ext: '.AppImage', platform: 'linux-x64', format: 'AppImage' },
  { dir: 'dmg', ext: '.dmg', platform: 'macos', format: 'Imagen de disco (.dmg)' },
]

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

for (const k of KINDS) {
  const dir = join(bundle, k.dir)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(k.ext) || !f.includes(`_${version}_`)) continue
    const src = join(dir, f)
    const dest = join(outRoot, k.platform, f)
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest) && sha256(dest) !== sha256(src)) {
      console.error(`Ya existe ${relative(root, dest)} con otro contenido; no se sobrescribe.`)
      process.exit(1)
    }
    copyFileSync(src, dest)
  }
}

// Manifiesto de todo lo que haya en release/<versión> (incluidos artefactos copiados desde otras plataformas).
const entries = []
for (const platform of existsSync(outRoot) ? readdirSync(outRoot) : []) {
  const pdir = join(outRoot, platform)
  if (!statSync(pdir).isDirectory()) continue
  for (const f of readdirSync(pdir)) {
    const p = join(pdir, f)
    const kind = KINDS.find((k) => f.endsWith(k.ext))
    if (!kind) continue
    entries.push({ name: 'Lunar Finance', version, platform, format: kind.format, file: `${platform}/${f}`, bytes: statSync(p).size, sha256: sha256(p) })
  }
}
if (entries.length === 0) {
  console.error('No hay artefactos de la versión', version)
  process.exit(1)
}
entries.sort((a, b) => a.file.localeCompare(b.file))
writeFileSync(join(outRoot, 'manifest.json'), `${JSON.stringify({ name: 'Lunar Finance', version, generated: new Date().toISOString(), artifacts: entries }, null, 2)}\n`)
writeFileSync(join(outRoot, 'SHA256SUMS'), entries.map((e) => `${e.sha256}  ${e.file}`).join('\n') + '\n')
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`
writeFileSync(
  join(outRoot, 'MANIFEST.md'),
  [`# Lunar Finance ${version} — artefactos`, '', '| Plataforma | Formato | Archivo | Tamaño | SHA-256 |', '| --- | --- | --- | --- | --- |', ...entries.map((e) => `| ${e.platform} | ${e.format} | \`${basename(e.file)}\` | ${mb(e.bytes)} | \`${e.sha256}\` |`), ''].join('\n'),
)
for (const e of entries) console.log(`${e.platform}  ${basename(e.file)}  ${mb(e.bytes)}  ${e.sha256}`)
