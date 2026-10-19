# Distribución — Lunar Finance 0.2.0

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
| Windows x64 | NSIS (por usuario, español) | `release/0.2.0/windows-x64/Lunar Finance_0.2.0_x64-setup.exe` | Generado y verificado |
| Linux x64 | `.deb`, `.AppImage`, `.rpm` | — | **No generado** (ver abajo) |
| macOS | `.app`, `.dmg` | — | **No generado** (requiere un Mac) |

Hashes y tamaños: `release/0.2.0/SHA256SUMS` y `release/0.2.0/MANIFEST.md`.

### Windows — verificado

- Requisitos: Windows 10 22H2 o 11 (x64). WebView2 viene con Windows 11; el instalador lo instala si falta. No
  necesita permisos de administrador.
- Metadatos del ejecutable y del instalador: producto «Lunar Finance», versión 0.2.0, editor y copyright
  «Diego Herrera Ayuso». Icono oficial con 10 resoluciones incrustado en ambos.
- Contenido del instalador (listado con 7-Zip): `lunar.exe` y los complementos estándar de NSIS. Sin archivos de
  configuración, tokens, bases de datos ni datos personales; sin rutas locales de compilación en el binario.
- Arranque: el ejecutable extraído del instalador abre «Lunar Finance» sin errores; comandos nativos operativos.
- El instalador no está firmado: SmartScreen mostrará un aviso («Más información» → «Ejecutar de todas formas»).
- Si tenías instalada la versión 0.1.0 («Lunar»), desinstálala desde Configuración → Aplicaciones: el nombre del
  producto cambió y se instala en una carpeta nueva. Tus ajustes y el token se conservan (mismo identificador).

### Linux — preparado, no compilado

La configuración está lista (`src-tauri/tauri.linux.conf.json`: `.deb`, `.AppImage`, `.rpm`; credenciales con Secret
Service), pero Tauri no permite compilar paquetes de Linux desde Windows. Docker Desktop está instalado en el equipo de
desarrollo, pero no se pudo usar en esta sesión, así que **no se ha compilado ni probado ningún paquete de Linux**.

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

## Pruebas (2026-10-19)

| Prueba | Resultado |
| --- | --- |
| TypeScript estricto y oxlint | Sin errores ni avisos |
| Vitest (dominio, servicios, PDF, CSV, IA, versión) | 191 pasan, 1 omitida (utilidad de PDF de muestra) |
| `cargo test` (Notion simulado, credenciales, Ollama simulado) | 64 pasan |
| Windows Credential Manager real (`--ignored keyring_roundtrip`) | Pasa |
| Ollama real (`--ignored real_ollama`, `gemma3:4b`) | Pasa |
| Notion real, solo lectura, con la configuración existente | Diagnóstico completo en verde; 23 movimientos y 15 categorías leídos sin campos vacíos |
| Compilación de producción Windows + instalador | Generado; metadatos, iconos, contenido y hash verificados |
| Arranque del ejecutable del instalador | Correcto |
| Escritura real en Notion | **No probada** (no se modifican datos reales durante las pruebas) |
| Instalación de Ollama y descarga de modelo reales | **No probadas** (requieren consentimiento; ya estaban instalados) |
| Paquetes de Linux y macOS | **No generados** |

## Pendiente

- Paquetes de Linux: compilarlos en Linux (o en un contenedor) con los pasos anteriores y probarlos.
- macOS: compilar en un Mac; firma y notarización si se distribuye.
- Firma de código del instalador de Windows.
- Eliminar movimientos desde la app: no implementado (se hace en Notion).
- En tu Notion conviven opciones «Gasto» y «Gasto » (y 7 categorías con espacio final) porque el atajo añade un
  espacio. Lunar Finance las lee correctamente y, al escribir, reutiliza la variante que ya usan tus movimientos; para
  limpiarlas, corrige el atajo para que no añada el espacio y unifica las opciones en Notion.
