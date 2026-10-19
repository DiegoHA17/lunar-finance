/**
 * Genera todos los recursos de icono de Lunar a partir del logotipo original (assets/brand/lunar-logo-original.webp).
 * El original nunca se modifica.
 *
 * Uso (sharp no es una dependencia del proyecto; se instala solo para ejecutar este script):
 *   npm install --no-save sharp@0.34
 *   node scripts/generate-brand-icons.mjs
 *   npx tauri icon assets/brand/lunar-logo-1024.png   # PNG/ICNS de Tauri (luego este script vuelve a escribir icon.ico y 32x32.png)
 *   node scripts/generate-brand-icons.mjs --ico-only
 *
 * Decisiones:
 *   - Transparencia real conservada: sin fondo añadido (se lee bien sobre barras de tareas claras y oscuras).
 *   - Sin deformación: recorte al contenido (alfa > 8) y centrado en un lienzo cuadrado transparente.
 *   - Tamaños ≤ 48 px: la misma imagen sin margen, reducida en dos pasos y con enfoque leve (más nítida, mismo dibujo).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGINAL = join(root, 'assets/brand/lunar-logo-original.webp')
const BRAND = join(root, 'assets/brand')
const ICONS = join(root, 'src-tauri/icons')
const UI = join(root, 'src/assets/brand')
const PUBLIC = join(root, 'public')
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

async function contentBox(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= 8) continue
    const p = (i - 3) / 4
    const x = p % info.width
    const y = (p / info.width) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Lienzo cuadrado transparente con el logotipo centrado; `margin` es la fracción del lado libre en cada borde. */
async function square(size, margin) {
  const inner = Math.round(size * (1 - 2 * margin))
  const logo = await sharp(ORIGINAL).extract(await contentBox(ORIGINAL)).resize(inner, inner, { fit: 'contain', background: transparent, kernel: 'lanczos3' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } }).composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer()
}

/** Variante para tamaños pequeños: sin margen, reducción en dos pasos y enfoque leve. */
async function small(tight, s) {
  const mid = await sharp(tight).resize(s * 4, s * 4, { kernel: 'lanczos3' }).png().toBuffer()
  return sharp(mid).resize(s, s, { kernel: 'lanczos3' }).sharpen({ sigma: s <= 24 ? 0.6 : 0.4 }).png({ compressionLevel: 9 }).toBuffer()
}

/** .ico con entradas PNG de 32 bits (Windows Vista+ y NSIS 3). */
function buildIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(([s, png], i) => {
    const o = 6 + i * 16
    header[o] = s >= 256 ? 0 : s
    header[o + 1] = s >= 256 ? 0 : s
    header.writeUInt16LE(1, o + 4)
    header.writeUInt16LE(32, o + 6)
    header.writeUInt32LE(png.length, o + 8)
    header.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((e) => e[1])])
}

const icoOnly = process.argv.includes('--ico-only')
for (const d of [BRAND, ICONS, UI, PUBLIC]) mkdirSync(d, { recursive: true })

const master = await square(1024, 0.04)
const tight = await square(1024, 0)
const resized = (s) => sharp(master).resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()

if (!icoOnly) {
  writeFileSync(join(BRAND, 'lunar-logo-1024.png'), master)
  writeFileSync(join(BRAND, 'lunar-logo-small-1024.png'), tight)
  // Interfaz: navegación (se muestra a 28 px; 64 px para pantallas de alta densidad) y bienvenida (112 px → 256 px).
  writeFileSync(join(UI, 'lunar-logo-64.png'), await small(tight, 64))
  writeFileSync(join(UI, 'lunar-logo-256.png'), await resized(256))
  writeFileSync(join(PUBLIC, 'favicon.png'), await small(tight, 48))
}

const ico = []
for (const s of [16, 20, 24, 32, 40, 48]) ico.push([s, await small(tight, s)])
for (const s of [64, 96, 128, 256]) ico.push([s, await resized(s)])
writeFileSync(join(ICONS, 'icon.ico'), buildIco(ico))
writeFileSync(join(ICONS, '32x32.png'), await small(tight, 32))
console.log(`Recursos generados${icoOnly ? ' (solo icon.ico y 32x32.png)' : ''}.`)
