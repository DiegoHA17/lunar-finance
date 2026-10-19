# Arquitectura de Lunar

Lunar es una aplicación de escritorio para Windows que usa **Notion como única fuente persistente** de los
movimientos y las categorías. No hay servidor propio, ni base de datos local, ni servicios externos aparte de la
API oficial de Notion.

## 1. Inspección del entorno (Fase 0, 2026-10-19)

| Elemento | Estado encontrado | Decisión |
| --- | --- | --- |
| Carpeta del proyecto | Vacía, sin repositorio | Proyecto nuevo, `git init` |
| Node.js / npm | 22.17.1 / 10.9.2 | Se usa npm |
| Rust | No instalado | Instalado `rustup` (stable 1.99, MSVC) con winget |
| Visual Studio 2022 (C++ y Windows SDK 10.0.26100) | Presente | Necesario para compilar Tauri en MSVC |
| WebView2 | 155.x | Tauri lo usa como motor de la interfaz |
| Ollama | 0.40.6 instalado | Fuera del alcance de la v1 (ver §9) |
| BERITH | Proyecto Electron independiente en `Desktop/EstudioApp` | Solo referencia estética; no se comparte código ni dependencias |

## 2. Pila tecnológica

| Capa | Tecnología | Motivo |
| --- | --- | --- |
| Escritorio | **Tauri 2** | Binario pequeño, WebView2 del sistema, capa nativa en Rust para secretos y red |
| Interfaz | **React 19 + TypeScript** | Tipado estricto del dominio, ecosistema maduro |
| Estilos | **Tailwind CSS 4** + tokens CSS propios | Utilidades + variables de tema (claro/oscuro) |
| Iconos | `lucide-react` | Conjunto coherente, *tree-shakable* |
| PDF | `pdf-lib` (local) | Control total de la paginación; sin servidores ni navegadores *headless* |
| Pruebas | Vitest (TS) y `cargo test` + `mockito` (Rust) | Pruebas rápidas sin red real |
| HTTP | `reqwest` (TLS nativo de Windows) | Solo se usa desde Rust |
| Credenciales | `keyring` → Windows Credential Manager | Protegido por DPAPI; sin criptografía propia |

No se usan: SQLite, Firebase/Supabase, librerías de gráficos (los gráficos son SVG propios, ligeros y accesibles),
enrutadores (6 pantallas se resuelven con estado) ni gestores de estado globales externos.

## 3. Capas y dependencias

```
┌──────────────────────────────── WebView (TypeScript) ───────────────────────────────┐
│  ui/  screens/        ← componentes React (no conocen Notion ni Tauri)              │
│        │                                                                            │
│  state/ (AppStore)    ← carga, caché en memoria, estados de carga/error             │
│        │                                                                            │
│  services/            ← casos de uso: movimientos, categorías, reglas,              │
│        │                clasificación, estadísticas, informes, ajustes              │
│        ├── domain/    ← lógica pura: dinero, periodos, clasificador, estadísticas,  │
│        │                informes, CSV, maquetación PDF (sin E/S, 100 % testeable)   │
│        └── infra/     ← backend: TauriBackend (invoke) | DemoBackend (datos ficticios)│
│                          + mapeo PageDto ⇄ dominio                                   │
└────────────────────────────────────────┬────────────────────────────────────────────┘
                                         │ IPC de Tauri (comandos acotados)
┌────────────────────────────────────────┴──────────── Rust (src-tauri) ──────────────┐
│  commands.rs   ← única superficie expuesta a la interfaz                            │
│  credentials   ← token en Windows Credential Manager (nunca vuelve a la interfaz)   │
│  config        ← JSON de configuración sin secretos (%APPDATA%\com.lunar.finance)   │
│  store         ← documentos JSON locales permitidos (reglas, preferencias)          │
│  notion/       ← cliente HTTP, reintentos, clasificación de errores, normalización, │
│                  diagnóstico                                                        │
│  export        ← diálogo «Guardar como» y escritura del PDF/CSV                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Reglas de dependencia:

- `domain/` no importa nada de React, Tauri ni `infra/`.
- Solo `src/infra/tauri.ts` importa `@tauri-apps/*`.
- Los componentes de `screens/` y `ui/` llaman a `state/` y `services/`, nunca a `infra/` directamente.
- Rust no expone comandos genéricos «haz esta petición a Notion»: cada comando opera sobre un **rol**
  configurado (`movements` o `categories`) y verifica que la página pertenece a esa fuente de datos.

### Servicios

| Servicio pedido | Módulo |
| --- | --- |
| Movimientos | `src/services/movements.ts` (+ validación en `domain/movements.ts`) |
| Categorías | `src/services/categories.ts` (+ reglas de catálogo en `domain/categories.ts`) |
| Reglas | `src/services/rules.ts` (+ motor en `domain/classifier/rules.ts`) |
| Clasificación | `src/services/classification.ts` (+ `domain/classifier/pipeline.ts`) |
| Estadísticas | `src/domain/stats.ts` (única implementación de las fórmulas) |
| Informes | `src/domain/report.ts`, `domain/pdf/layout.ts`, `infra/pdfRender.ts`, `domain/csv.ts`, `services/reports.ts` |
| Notion | `src-tauri/src/notion/*` (red) + `src/infra/mapping.ts` (traducción al dominio) + `services/sync.ts` (carga) |
| Credenciales | `src-tauri/src/credentials.rs` |
| Configuración | `src-tauri/src/config.rs` (+ `store.rs` para reglas y preferencias) |
| Migraciones opcionales | `src/services/migration.ts` |

`src/state/` (estado global mínimo con `useSyncExternalStore` y acciones) orquesta los servicios para la interfaz.
`src/infra/demo.ts` implementa el mismo contrato `Backend` en memoria para el modo demostración y las pruebas de
integración.

## 4. Integración con Notion

- Versión de API: **`2026-03-11`** (vigente a 2026-10-19). Modelo de *data sources* (introducido en 2025-09-03):
  la base de datos es un contenedor y el esquema y las filas pertenecen a sus fuentes de datos.
- El usuario puede pegar la URL de la base de datos; Lunar resuelve `database_id → data_sources[]` y también
  ofrece la lista de fuentes compartidas con la integración (`POST /v1/search`, filtro `data_source`).
- Las propiedades se referencian por **ID de propiedad** (estable aunque se renombre en Notion), guardando
  también el nombre para mostrarlo.
- Lectura: `POST /v1/data_sources/{id}/query`, paginada con `start_cursor` (100 por página), deduplicada por ID
  de página, excluyendo las páginas en la papelera. Si Notion devuelve `request_status: incomplete` se avisa.
- Escritura: `POST /v1/pages` y `PATCH /v1/pages/{id}`. Antes de actualizar, Rust lee la página, comprueba que
  pertenece a la fuente del rol y compara los **valores esperados** de las propiedades que se van a cambiar
  (control de concurrencia optimista; `last_edited_time` solo tiene precisión de minutos).
- Errores: se clasifican (`sin_conexion`, `token_invalido`, `sin_permisos`, `no_encontrado`, `esquema`,
  `limite_api`, `conflicto`, `servidor`) con un mensaje y una acción sugerida en español.
- Límites: ≈3 peticiones/s; 429/529 respetan `Retry-After`; los 5xx solo se reintentan en lecturas.

Detalles en [docs/notion.md](docs/notion.md).

## 5. Credenciales

- El token se introduce una vez en Ajustes, viaja por IPC a Rust y se guarda en Windows Credential Manager
  (servicio `com.lunar.finance`, cuenta `notion-token`). El sistema lo protege con DPAPI.
- Ningún comando devuelve el token. La interfaz solo sabe si existe.
- No se escribe en `localStorage`, en JSON, en logs ni en mensajes de error (se redacta cualquier `ntn_…`/`secret_…`).

## 6. Dominio y exactitud financiera

- Importes en **céntimos enteros** (`number` entero seguro). Notion guarda `number` en coma flotante; la
  conversión se hace una sola vez (`toCents`) y marca los valores con más de 2 decimales.
- Tipos de movimiento: `gasto`, `ingreso`, `devolución` (resta del gasto de su categoría) y `transferencia`
  (excluida de ingresos y gastos). Los valores de la propiedad «Tipo» se mapean en Ajustes.
- **Balance del periodo = ingresos − (gastos − devoluciones)**. No es el saldo bancario y la interfaz lo dice.
- Un movimiento con datos inválidos (sin fecha, importe ilegible, tipo desconocido) **no se suma**: aparece en
  «Requieren revisión» con el motivo. Un movimiento sin categoría sí se suma, bajo «Sin categoría».
- Las estadísticas se calculan en un único módulo (`domain/stats.ts`). Dashboard, informes, PDF y CSV
  consumen el mismo resultado.

Detalles en [docs/modelo-de-datos.md](docs/modelo-de-datos.md).

## 7. Categorías

- Base de datos de Notion propia («Categorías»), creada por Lunar bajo demanda: Nombre, Tipo, Color, Icono,
  Estado, Descripción, Alias. El identificador es el ID de página de Notion.
- El vínculo movimiento → categoría admite tres modos según el tipo real de la propiedad «Categoría»:
  `select`/`rich_text` (por nombre normalizado o alias) o `relation` (por ID de página).
- Renombrar una categoría guarda el nombre anterior como alias para que los movimientos históricos sigan
  resolviéndose sin reescribirlos.
- No se borran categorías: se archivan. Las archivadas siguen apareciendo en el histórico y en los informes,
  pero no se pueden asignar a operaciones nuevas.

## 8. Clasificación

- Motor de reglas determinista (`domain/classifier/`). Las reglas se guardan en `rules.json` local
  (no son datos financieros; se pueden exportar/importar). Ver [docs/clasificacion.md](docs/clasificacion.md).
- Orden total de evaluación: prioridad ↓, especificidad ↓, fecha de creación ↑, ID ↑. Si las mejores reglas
  empatan en prioridad y apuntan a categorías distintas, el resultado es **ambiguo** y el movimiento queda
  pendiente con el motivo.
- Las reglas solo **proponen** categorías para movimientos sin categoría. Aplicarlas es una acción explícita con
  vista previa. Nunca se reescriben movimientos ya clasificados de forma silenciosa.

## 9. Diseño preparado para Ollama (no implementado en la v1)

`ClassificationPipeline` encadena proveedores con la interfaz `ClassificationProvider`. Hoy solo existe el
proveedor de reglas. Un futuro `OllamaProvider` (llamado desde Rust a `http://127.0.0.1:11434`) solo podrá
devolver una propuesta `{categoryId, confianza, motivo}` que el pipeline valida (categoría existente, activa y
compatible con el tipo) y que siempre requiere confirmación por debajo del umbral. El origen de cada
clasificación (`regla`, `ia`, `manual`) se registra cuando la propiedad de origen está configurada.

## 10. Decisiones registradas

| # | Decisión | Alternativas descartadas |
| --- | --- | --- |
| D1 | Lógica de dominio en TypeScript, red y secretos en Rust | Todo en Rust: duplicaría modelos y haría el dominio más lento de iterar y probar con la interfaz |
| D2 | Reglas en JSON local | Base de datos de reglas en Notion: más llamadas a la API y más esquema que mantener en la v1 |
| D3 | PDF con `pdf-lib` y maquetación propia | `window.print` (sin control de saltos), Typst/headless Chrome (pesados) |
| D4 | Gráficos SVG propios | Recharts/Chart.js (+100 KB, accesibilidad limitada) |
| D5 | Propiedades por ID | Por nombre: un renombrado en Notion rompería el mapeo |
| D6 | Control de concurrencia por valores esperados | `last_edited_time` (precisión de minutos) |
| D7 | `keyring` 3 (windows-native) | `keyring` 4 (API reestructurada, recién publicada); DPAPI manual (innecesario) |
| D8 | Vínculo de categoría por nombre + alias mientras el atajo escriba texto/selección | Migrar ya a relación: obligaría a cambiar el atajo del iPhone |
| D9 | Comparación «hasta hoy» si el periodo está en curso | Comparar con el periodo anterior completo (engañoso a mitad de mes) |
| D10 | Escrituras en lote secuenciales con progreso | Paralelas: chocarían con el límite de ~3 peticiones/s |
| D11 | Muestras de color de categoría como identidad secundaria; gráficos de una sola serie | Paleta categórica de 12+ tonos (no distinguibles con daltonismo) |
| D12 | Instalador NSIS por usuario | MSI (requiere WiX y permisos de administrador) |
| D13 | `freezePrototype: false` | `true` rompía la carga en la app empaquetada (una dependencia asigna `toString` en prototipos). La CSP sin red, el IPC acotado y el token fuera de la interfaz son las defensas principales |
| D14 | Icono oficial con transparencia, sin fondo, y variante pequeña derivada de la misma imagen (ver docs/marca-e-iconos.md) | Fondo cuadrado (innecesario: legible sobre barras claras y oscuras); redibujar una versión simplificada (alteraría la identidad) |
| D15 | Iconos generados con `sharp` instalado con `--no-save` desde un script del repositorio | Añadir `sharp` como dependencia de desarrollo (solo se usa al cambiar el logotipo) |
