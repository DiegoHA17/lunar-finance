# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Cambiado
- Icono oficial de Lunar (luna azul noche, barras salvia y órbitas) en el ejecutable, la ventana, la barra de
  tareas, los accesos directos, el instalador y el desinstalador. Sustituye al icono provisional.
- `.ico` de Windows con 10 resoluciones (16–256 px) y variante nítida para tamaños pequeños, sin redibujar el logotipo.
- El logotipo aparece en la barra lateral, la bienvenida y la pantalla de carga; favicon en PNG.

### Corregido
- El instalador NSIS mostraba el icono genérico de NSIS: se configura `installerIcon`.

### Añadido
- `assets/brand/` con el logotipo original intacto y los maestros derivados; `scripts/generate-brand-icons.mjs`
  para regenerar todos los iconos; documentación en `docs/marca-e-iconos.md`.

### Eliminado
- Recursos provisionales `assets/app-icon.svg` y `public/favicon.svg`.

## [0.1.0] — 2026-10-19

Primera entrega funcional.

### Añadido
- Aplicación de escritorio para Windows con Tauri 2, React 19, TypeScript y Tailwind CSS 4.
- Capa nativa en Rust: cliente de la API de Notion `2026-03-11` (fuentes de datos) con paginación, deduplicación,
  reintentos (`Retry-After`), clasificación de errores en español y control de concurrencia por valores esperados.
- Token en Windows Credential Manager; redacción de tokens en errores y registros.
- Diagnóstico de conexión paso a paso (token, permisos, identificador, esquema, lectura).
- Mapeo de propiedades por ID con propuesta automática y asignación de valores de «Tipo».
- Dominio financiero en céntimos enteros: gastos, ingresos, devoluciones y transferencias; incidencias que
  excluyen de los totales con motivo visible; posibles duplicados.
- Catálogo de categorías en Notion creado por la app; alias, archivo/reactivación, nombres únicos normalizados;
  categorías implícitas mientras no exista el catálogo.
- Motor de reglas determinista (prioridad, especificidad, ambigüedad, condiciones, excepciones), revisión en lote
  de propuestas y creación de reglas a partir de correcciones.
- Pipeline de clasificación preparado para un proveedor de IA opcional (sin implementar).
- Panel de inicio con fase lunar del periodo, cifras, comparación con el periodo anterior (mismo tramo si está en
  curso), evolución, gasto por categoría y últimos movimientos.
- Informes de semana, mes, trimestre, año e intervalo personalizado; PDF local con paginación controlada; CSV
  para hojas de cálculo en español con protección contra inyección de fórmulas.
- Modo demostración con datos ficticios marcados en toda la interfaz y en los informes.
- Migración opcional y no destructiva: propiedad «Origen clasificación».
- Temas claro y oscuro, navegación por teclado, movimiento reducido, diseño adaptable hasta 900 px.
- Instalador NSIS por usuario en español.
- Documentación: README, ARCHITECTURE, ROADMAP, integración con Notion, modelo de datos, clasificación, pruebas y
  empaquetado.
