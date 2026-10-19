# Marca e iconos

## Logotipo oficial

`assets/brand/lunar-logo-original.webp` es el logotipo oficial de Lunar tal como se entregó: luna azul noche,
barras de crecimiento verde salvia y detalles orbitales. **No se modifica nunca**; todos los demás recursos se
generan a partir de él.

Inspección del original (2026-10-19):

| Propiedad | Valor |
| --- | --- |
| Formato | WebP (VP8X) con perfil ICC, espacio sRGB |
| Dimensiones | 1278 × 1230 px |
| Transparencia | Real: canal alfa, las cuatro esquinas con alfa 0, 58 % de píxeles transparentes |
| Fondo | Ninguno (sin fondo negro opaco) |
| Dibujo | Prácticamente opaco (alfa 224–255) con bordes suavizados y un halo muy tenue (alfa < 32) |
| Contenido útil | 1159 × 1084 px (recorte por alfa > 8) |

## Recursos generados

| Archivo | Uso | Cómo se obtiene |
| --- | --- | --- |
| `assets/brand/lunar-logo-1024.png` | Maestro para Tauri y tamaños ≥ 64 px | Recorte al contenido, centrado en lienzo cuadrado transparente de 1024 px con margen del 4 %, sin deformar |
| `assets/brand/lunar-logo-small-1024.png` | Base de la variante para tamaños pequeños | Igual, sin margen |
| `src-tauri/icons/icon.ico` | Icono de Windows: ejecutable, ventana, barra de tareas, accesos directos, instalador y desinstalador | 10 entradas PNG de 32 bits: 16, 20, 24, 32, 40 y 48 px (variante pequeña) y 64, 96, 128 y 256 px (maestro) |
| `src-tauri/icons/32x32.png` | Icono de 32 px de Tauri | Variante pequeña |
| `src-tauri/icons/{64x64,128x128,128x128@2x,icon}.png`, `icon.icns`, `Square*Logo.png`, `StoreLogo.png` | Resto del conjunto de Tauri (macOS y Microsoft Store no se usan en la v1, se conservan por completitud) | `npx tauri icon assets/brand/lunar-logo-1024.png` |
| `src/assets/brand/lunar-logo-64.png` | Logotipo de la barra lateral (se muestra a 28 px) | Variante pequeña a 64 px |
| `src/assets/brand/lunar-logo-256.png` | Bienvenida (112 px) y pantalla de carga (72 px) | Maestro a 256 px |
| `public/favicon.png` | Favicon de la vista web (desarrollo en navegador) | Variante pequeña a 48 px |

### Variante para tamaños pequeños

A 16–48 px los detalles finos (estrella, órbitas) se empastan. La variante pequeña **no redibuja el logotipo**:
usa la misma imagen sin margen (ocupa todo el lienzo), reducida en dos pasos (a 4× y luego al tamaño final) con
un enfoque leve. Resultado: la luna y las barras se reconocen mejor a 16, 24 y 32 px.

### Transparencia y fondos

Se conserva la transparencia en todos los recursos. Comprobado sobre fondo claro, azul noche (`#0e1421`), barra de
tareas oscura (`#202020`) y barra clara (`#f3f3f3`): el filo crema interior y los arcos salvia mantienen el
contorno legible, así que no hace falta una variante con fondo.

## Regenerar

`sharp` no es dependencia del proyecto; se instala solo para el script, sin tocar `package.json`:

```bash
npm install --no-save sharp@0.34
```

```bash
node scripts/generate-brand-icons.mjs
```

```bash
npx tauri icon assets/brand/lunar-logo-1024.png
```

```bash
node scripts/generate-brand-icons.mjs --ico-only
```

El último paso vuelve a escribir `icon.ico` y `32x32.png` con la variante pequeña (`tauri icon` genera un `.ico`
de 6 tamaños sin ella). Después, borra `src-tauri/icons/android` y `src-tauri/icons/ios` si aparecen.

## Configuración

`src-tauri/tauri.conf.json`:

- `bundle.icon`: lista de iconos de Tauri; el `.ico` se incrusta en `lunar.exe`.
- `bundle.windows.nsis.installerIcon: "icons/icon.ico"`: sin esta opción el instalador mostraba el icono genérico
  de NSIS (detectado al comprobar el artefacto).

## Verificación (2026-10-19)

- `lunar.exe` y `Lunar_0.1.0_x64-setup.exe` contienen las 10 entradas exactas del `.ico` (comparación byte a byte);
  el desinstalador incluye las de 16, 20 y 24 px.
- Icono extraído por Windows de ambos ejecutables: logotipo de Lunar.
- App instalada: icono correcto en la barra de título (16 px), en la barra de tareas y en la barra lateral.
- Accesos directos del escritorio y del menú Inicio: apuntan a `lunar.exe` y Windows los resuelve con el
  logotipo de Lunar. Si el escritorio sigue mostrando un icono antiguo o genérico tras actualizar, es la caché de
  Explorer: se refresca con F5 en el escritorio o al reiniciar la sesión.
