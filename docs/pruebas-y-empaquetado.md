# Pruebas y empaquetado

## Pruebas automáticas

```bash
npm run check
```

Ejecuta, en orden: comprobación de tipos (TypeScript estricto), análisis estático (oxlint), pruebas de TypeScript
(Vitest) y pruebas de Rust (`cargo test`). Todas usan **datos sintéticos**; ninguna toca Notion real ni datos del
usuario.

| Área | Archivo | Qué cubre |
| --- | --- | --- |
| Dinero | `src/domain/money.test.ts` | Céntimos sin error de coma flotante, redondeo, formato español, entrada de importes, porcentajes |
| Periodos | `src/domain/periods.test.ts` | Semanas ISO, límites de mes/trimestre/año, años bisiestos, cambio de año, tramos |
| Estadísticas | `src/domain/stats.test.ts` | Sumas, balance, devoluciones, transferencias, excluidos, categorías (archivadas, desconocidas, sin categoría), comparación (también con periodo en curso) |
| Clasificación | `src/domain/classifier/classifier.test.ts` | Coincidencias normalizadas, prioridad, especificidad, ambigüedad, independencia del orden, archivadas, tipos, excepciones, pipeline de IA simulado |
| Categorías y movimientos | `src/domain/categories.test.ts` | Alias, duplicados de nombre, renombrado, archivadas, validación, duplicados de movimientos |
| CSV | `src/domain/csv.test.ts` | BOM, «;», coma decimal, inyección de fórmulas, consistencia con filtros y balance |
| Informes/PDF | `src/domain/report.test.ts` | Mismas cifras que el panel, paginación, cabecera repetida, totales no huérfanos, márgenes, emojis, PDF válido |
| Mapeo de Notion | `src/infra/mapping.test.ts` | Lectura/escritura por tipo de propiedad, relación, fórmulas, sincronía con `config.rs` |
| Servicios | `src/services/services.test.ts` | Integración contra el backend de demostración: carga, errores, conflictos, creación con duplicados, catálogo, clasificación en lote, migración |
| Cliente Notion (Rust) | `src-tauri/src/notion/*.rs` | Cabeceras, 401/403/404, 429 con `Retry-After`, 5xx, red caída, paginación, papelera, incompletos, conflictos, diagnóstico |
| Credenciales (Rust) | `src-tauri/src/credentials.rs`, `error.rs` | Formato del token, ausencia, redacción de tokens en errores |

Prueba manual contra Windows Credential Manager (crea y borra una entrada de prueba `com.lunar.finance.test`):

```bash
cd src-tauri && cargo test -- --ignored keyring_roundtrip
```

PDF de muestra con los datos de demostración, para revisarlos a ojo:

```bash
LUNAR_SAMPLE_PDF=./muestras npx vitest run src/test/samplePdf.test.ts
```

## Pruebas que requieren Notion real

No están automatizadas porque necesitan el token del usuario. Procedimiento manual:

1. Ajustes → Diagnóstico: todos los pasos en verde.
2. Movimientos: el número de movimientos coincide con el de la base de datos en Notion.
3. Duplica en Notion un movimiento de prueba y comprueba que se marca como posible duplicado.
4. Cambia la categoría de ese movimiento de prueba desde Lunar y comprueba el cambio en Notion; bórralo después
   desde Notion.

## Empaquetado para Windows

```bash
npm run tauri build
```

Genera `src-tauri/target/release/bundle/nsis/Lunar_0.1.0_x64-setup.exe`: instalador por usuario (sin permisos de
administrador), en español, con WebView2 incluido si falta. La primera vez, Tauri descarga sus herramientas de
NSIS desde su repositorio oficial.

El instalador **no está firmado** con un certificado de código: Windows SmartScreen mostrará un aviso («Windows
protegió su PC» → «Más información» → «Ejecutar de todas formas»). Para distribuirlo a terceros convendría
firmarlo.

### Verificación de la app instalada (2026-10-19)

Instalada con `Lunar_0.1.0_x64-setup.exe /S` e inspeccionada con la depuración remota de WebView2
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`):

- La bienvenida y el panel (modo demostración) se renderizan sin excepciones.
- IPC real con Rust: `credentials_status` → sin token; `config_get` → configuración vacía; `notion_query` sin
  configurar → error `config` explicado; token mal formado → `validation`; `store_read('../config')` y
  `open_notion_url('https://evil.example')` → rechazados; `export_save` con formato desconocido → rechazado.
- Las preferencias se guardan en `%APPDATA%\com.lunar.finance\preferences.json`; ningún archivo de la app contiene
  tokens.
- Un primer intento falló con pantalla en blanco por `freezePrototype` (ver ARCHITECTURE, D13); corregido y
  reverificado.

## Seguridad: comprobaciones realizadas

- El token se valida y se guarda en Windows Credential Manager; ningún comando IPC lo devuelve.
- Los mensajes de error se redactan (`ntn_…`, `secret_…`, `Bearer …` → `[oculto]`) en Rust antes de cruzar a la
  interfaz; hay pruebas para ello.
- Los registros de `reqwest`/`hyper` están limitados a avisos; Lunar solo registra recuentos y tamaños.
- La CSP de la ventana solo permite recursos propios e IPC: la interfaz no puede conectarse a Internet.
- La interfaz no tiene permisos de sistema de archivos; las exportaciones pasan por un diálogo nativo en Rust.
- La interfaz solo puede abrir enlaces de `notion.so`/`notion.com`.
- Los documentos locales permitidos son una lista cerrada (`rules`, `preferences`), con tamaño máximo y escritura
  atómica.
