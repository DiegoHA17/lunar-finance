# Distribución — Lunar Finance 0.3.0

## Desarrollo

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run dev` abre solo la interfaz en el navegador (modo demostración, sin Notion ni Ollama).

## Compilar

```bash
npm run check
```

```bash
npm run release
```

```bash
npm run release:manifest
```

- `npm run check`: tipos, lint, pruebas de TypeScript y de Rust.
- `npm run release`: igual que `tauri build`, pero elimina de los binarios las rutas locales de compilación (nombre
  de usuario) con `--remap-path-prefix`.
- `npm run release:manifest`: copia los artefactos de la versión actual a `release/<versión>/<plataforma>/` y genera
  `SHA256SUMS`, `manifest.json` y `MANIFEST.md`. No sobrescribe un artefacto con contenido distinto.

La versión tiene una única fuente: `package.json`. Tauri la lee (`"version": "../package.json"`), Vite la inyecta en la
interfaz («Acerca de», metadatos del PDF) y una prueba comprueba que `src-tauri/Cargo.toml` coincide.

## Artefactos

| Plataforma | Formato | Ruta | Estado |
| --- | --- | --- | --- |
| Windows x64 | NSIS (por usuario, español) | `release/0.3.0/windows-x64/Lunar Finance_0.3.0_x64-setup.exe` | Generado y verificado |
| Linux x64 | Debian/Ubuntu `.deb` | `release/0.3.0/linux-x64/Lunar Finance_0.3.0_amd64.deb` | Generado y verificado |
| Linux x64 | AppImage | `release/0.3.0/linux-x64/Lunar Finance_0.3.0_amd64.AppImage` | Generado y verificado |
| Linux x64 | Fedora/openSUSE `.rpm` | `release/0.3.0/linux-x64/Lunar Finance-0.3.0-1.x86_64.rpm` | Generado; metadatos verificados, sin instalar |
| macOS | `.app`, `.dmg` | — | **No generado** (requiere un Mac) |

Hashes y tamaños: `release/0.3.0/SHA256SUMS` y `release/0.3.0/MANIFEST.md`. Los artefactos anteriores se conservan en
`release/0.2.1/` (sin estilo Vintage ni pagos periódicos) y `release/0.2.0/` (sin la revisión global de categorías).

### Correspondencia entre binarios, versiones y código (2026-11-02)

| Versión | Etiqueta | Comprobación |
| --- | --- | --- |
| 0.3.0 | `v0.3.0` (`510d3a7`) | Fuente de Linux = código de la etiqueta (`162feec` + parche de versión dan el mismo árbol, salvo dos documentos). Interfaz del instalador de Windows: recompilada desde la etiqueta, mismos archivos JS, CSS, fuentes e imágenes (`index.html` solo difiere en finales de línea). Versión 0.3.0 en el `.exe`, el `.deb`, el `.rpm` y el binario de la AppImage. |
| 0.2.1 | `v0.2.1` (`8fb7271`) | Versión 0.2.1 en el `.exe`, el `.deb`, el `.rpm` y el binario de la AppImage. Procedencia según el registro de compilación de esta página. |
| 0.2.0 | `v0.2.0` (`5e300ac`) | Versión 0.2.0 en los cuatro paquetes. Procedencia según el registro de compilación de esta página. |
| 0.1.0 | `v0.1.0` (`c57f358`) | **Sin instaladores publicados.** El `Lunar_0.1.0_x64-setup.exe` local se generó unas ocho horas después del commit, con cambios de 0.2.0 (icono nuevo), y no corresponde de forma fiable a esta versión. |

Los binarios no son reproducibles bit a bit, así que la correspondencia completa del código Rust no puede demostrarse
recompilando. Los SHA-256 publicados son los de los archivos generados en cada compilación.

### Windows — verificado

- Requisitos: Windows 10 22H2 o 11 (x64). WebView2 viene con Windows 11; el instalador lo instala si falta. No
  necesita permisos de administrador.
- Metadatos del ejecutable y del instalador: producto «Lunar Finance», versión 0.3.0, editor y copyright
  «Diego Herrera Ayuso». Icono oficial con 10 resoluciones incrustado en ambos.
- Contenido del instalador (listado con 7-Zip): `lunar.exe` y los complementos estándar de NSIS. Sin archivos de
  configuración, tokens, bases de datos ni datos personales; sin rutas locales de compilación en el binario.
- Arranque: el ejecutable abre la ventana «Lunar Finance» sin errores (0.3.0, 2026-11-02); en 0.2.0 se comprobó además el
  ejecutable extraído del instalador y los comandos nativos.
- El instalador no está firmado: SmartScreen mostrará un aviso («Más información» → «Ejecutar de todas formas»).
- Si tenías instalada la versión 0.1.0 («Lunar»), desinstálala desde Configuración → Aplicaciones: el nombre del
  producto cambió y se instala en una carpeta nueva. Tus ajustes y el token se conservan (mismo identificador).

### Linux — compilado y verificado (0.3.0: 2026-11-02)

> Los identificadores de commit se actualizaron el 2026-11-02 al sustituir el correo de autor del historial antes de
> publicarlo. El contenido de cada commit no cambió (mismo árbol). Correspondencia: `056438d` → `c57f358` (v0.1.0),
> `06ee513` → `5e300ac` (v0.2.0), `3eb60f3` → `91014a6`, `2573c86` → `8fb7271` (v0.2.1), `d9cb2d3` → `162feec` y
> `1a53ea0` → `510d3a7` (v0.3.0).

0.3.0 compilado desde el commit `162feec` más el cambio de versión a 0.3.0 (0.2.1, desde `91014a6` más el cambio de versión; 0.2.0, desde `5e300ac`), en una distribución WSL 2 dedicada («LunarBuild», Ubuntu 22.04.5 LTS, imagen
oficial Ubuntu Base verificada por SHA-256), con Node 22.17.1, Rust 1.99.1 y WebKitGTK 4.1 2.50.4. Configuración:
`src-tauri/tauri.linux.conf.json` (credenciales con Secret Service).

Comprobaciones:

- `.deb`: paquete `lunar-finance` 0.3.0, `amd64`, mantenedor Diego Herrera Ayuso; `.desktop` «Lunar Finance» válido
  (`desktop-file-validate`); iconos de 32, 128 y 256 px; binario sin rutas locales y sin bibliotecas sin resolver;
  se instala con `apt` en Ubuntu 22.04 y abre la ventana «Lunar Finance» (WSLg).
- AppImage: se extrae correctamente, contiene `.desktop` e icono, y abre la ventana «Lunar Finance».
- `.rpm`: `lunar-finance` 0.3.0-1, `x86_64`, dependencias y archivos correctos, `rpm -K` OK. No se ha instalado en
  Fedora/openSUSE.
- Observaciones menores (no impiden instalar): el `.deb` repite dos dependencias (Tauri añade las suyas a las
  configuradas); el icono HiDPI se instala en `hicolor/256x256@2`; el `.rpm` de 0.3.0 declara licencia `UNLICENSED` porque se compiló antes de publicar el proyecto con licencia MIT (`Cargo.toml` ya declara `MIT` para las próximas compilaciones);
  `make-release-manifest.mjs` no recoge el `.rpm` automáticamente porque su nombre usa `-<versión>-` (se copia a mano).

Para generarlos en Ubuntu 22.04+ / Debian 12+:

```bash
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev patchelf
```

```bash
npm ci && npm run release && npm run release:manifest
```

Requisitos para ejecutar: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libssl3`, `libdbus-1-3` y un servicio de llavero
(GNOME Keyring o KWallet) para guardar el token. En Linux, «Iniciar Ollama» no está disponible (Ollama se ejecuta como
servicio del sistema) y la recomendación de modelo no conoce el espacio libre, así que propone el modelo ligero.

### macOS — no compilado

Requiere un Mac con Xcode Command Line Tools y Rust (`rustup`). En ese equipo: `npm ci && npm run release` genera
`.app` y `.dmg` (`src-tauri/tauri.macos.conf.json`, macOS 11+). Sin firma ni notarización de Apple, Gatekeeper
bloqueará la apertura (clic derecho → Abrir). «Iniciar Ollama» y la medición de recursos no están implementadas en
macOS.

## Configuración

- **Notion**: Ajustes → Conexión con Notion (token de una integración interna, compartir la base de datos, elegir
  base de datos y revisar el mapeo). Detalle en [notion.md](notion.md). No hay variables de entorno obligatorias.
- **Ollama** (opcional): Ajustes → Inteligencia artificial. Detalle en [ia.md](ia.md).
- Variables solo para desarrollo: `LUNAR_NOTION_BASE_URL` (API simulada, solo en compilaciones de depuración),
  `LUNAR_SAMPLE_PDF` (PDF de muestra), `LUNAR_OLLAMA_MODEL` (prueba real de Ollama).

## Automatización con MacroDroid (Android) — no incluida

Lunar Finance no recibe notificaciones del móvil. El flujo «notificación bancaria → extracción → Notion» es externo y
requiere configurarlo en MacroDroid:

1. Disparador: notificación de la app del banco.
2. Extraer importe, comercio y fecha del texto de la notificación (expresiones regulares en MacroDroid).
3. Crear la página en la base de datos «Transacciones» con la API de Notion (petición HTTP con el token de la
   integración, `POST /v1/pages`, `Notion-Version: 2026-03-11`), dejando la categoría vacía.
4. Para evitar duplicados si la notificación se procesa dos veces, consultar antes (`POST /v1/data_sources/{id}/query`)
   si ya existe un movimiento con la misma fecha, importe y descripción.

Lunar Finance completa el resto: marca como «posible duplicado» los movimientos idénticos, los clasifica con reglas o
IA en la revisión de pendientes y los incluye en estadísticas e informes. **La automatización en sí no está
desarrollada ni probada.**

## Pruebas (0.3.0, 2026-11-02)

| Prueba | Resultado |
| --- | --- |
| TypeScript estricto y oxlint | Sin errores ni avisos |
| Vitest (dominio, servicios, PDF, CSV, IA, pagos periódicos, versión) | 284 pasan, 1 omitida (utilidad de PDF de muestra), en Windows y en Linux |
| `cargo test` (Notion simulado, credenciales, Ollama simulado, cerrojo de pagos periódicos) | 67 pasan, en Windows y en Linux |
| Windows Credential Manager real (`--ignored keyring_roundtrip`) | Pasa (2026-10-19; no repetida) |
| Ollama real (`--ignored real_ollama`, `gemma3:4b`) | Pasa (2026-10-19; no repetida) |
| Notion real, solo lectura, con la configuración existente | Diagnóstico completo en verde; 23 movimientos y 15 categorías leídos sin campos vacíos (2026-10-19; no repetida) |
| Compilación de producción Windows + instalador | Generado; metadatos, iconos, contenido y hash verificados |
| Arranque del ejecutable del instalador | Correcto |
| Escritura real en Notion (incluidos los pagos periódicos) | **No probada** (no se modifican datos reales durante las pruebas; probada contra el backend de demostración) |
| Instalación de Ollama y descarga de modelo reales | **No probadas** (requieren consentimiento; ya estaban instalados) |
| Paquetes de Linux (`.deb`, AppImage, `.rpm`) | Generados; metadatos, contenido, iconos y hashes verificados; `.deb` instalado y AppImage ejecutado en Ubuntu 22.04 (WSL) |
| Paquetes de macOS | **No generados** (requiere un Mac) |

## Pendiente

- Linux: probar el `.rpm` en Fedora/openSUSE y los paquetes en un escritorio Linux real (aquí se probaron en WSL).
- macOS: compilar en un Mac; firma y notarización si se distribuye.
- Firma de código del instalador de Windows.
- Incluir en los instaladores un archivo con los avisos de licencia de las dependencias (ver [licencias.md](licencias.md)).
- Eliminar movimientos desde la app: no implementado (se hace en Notion).
- En tu Notion conviven opciones «Gasto» y «Gasto » (y 7 categorías con espacio final) porque el atajo añade un
  espacio. Lunar Finance las lee correctamente y, al escribir, reutiliza la variante que ya usan tus movimientos; para
  limpiarlas, corrige el atajo para que no añada el espacio y unifica las opciones en Notion.
