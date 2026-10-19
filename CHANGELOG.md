# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [0.2.0] — 2026-10-19

### Corregido
- Al escribir en Notion se reutiliza la variante exacta que ya usan tus movimientos (p. ej. «Gasto » con espacio final del atajo) en lugar de crear opciones duplicadas.
- Los binarios distribuidos ya no contienen rutas locales de compilación (nombre de usuario).
- Versiones desincronizadas (package.json 0.0.0, Tauri y Cargo 0.1.0, «Acerca de» fijo).
- Gráficas: las etiquetas del eje no coincidían con sus líneas (p. ej. «1,3 mil €» para 1.250 €; «13 €» para 12,5 €). Escala única 1-2-5 compartida por el panel y el PDF.
- Comparación con el periodo anterior: ya no se muestra si el historial no cubre todo ese periodo (evita cifras como «+241 %» frente a un año con solo unos meses de datos).
- PDF: la línea de comparación y los motivos de exclusión ya no se cortan con «…».
- Las barras de categoría de la pantalla y del PDF representan lo mismo (parte del total).
- La gráfica de la pantalla dejaba de adaptarse al tamaño tras alternar «Ver como tabla».
- El instalador NSIS mostraba el icono genérico de NSIS: se configura `installerIcon`.

### Cambiado
- Nombre oficial **Lunar Finance** en la ventana, la interfaz, los informes, los archivos exportados, el instalador y la documentación. Editor: Diego Herrera Ayuso.
- Versión con fuente única (package.json) para la interfaz, Tauri, el instalador y los metadatos del PDF.
- «Acerca de» con nombre, autor y versión real. Logotipo oficial en la cabecera de los PDF.
- Mensajes de credenciales neutros respecto al sistema operativo; almacén seguro por plataforma (Windows, Linux Secret Service, macOS Llavero).
- PDF: orden título → totales → gráfica → categorías → movimientos; sin bloque de notas ni explicaciones; solo avisos que afectan a la validez (datos de demostración, consulta incompleta).
- Vista previa de Informes con la misma estructura que el PDF (incluida la gráfica).
- Interfaz más sobria: fuera descripciones redundantes, textos de ayuda internos (dónde se guardan reglas o configuración), ejemplos y explicaciones repetidas; mensajes y estados vacíos más breves.
- Icono oficial de Lunar (luna azul noche, barras salvia y órbitas) en el ejecutable, la ventana, la barra de tareas, los accesos directos, el instalador y el desinstalador; `.ico` con 10 resoluciones y variante nítida para tamaños pequeños; logotipo en la barra lateral, la bienvenida y la pantalla de carga.

### Añadido
- Configuración de empaquetado para Linux (.deb, .AppImage, .rpm) y macOS (.app, .dmg); no compilados en esta versión.
- `npm run release` (compilación sin rutas locales) y `npm run release:manifest` (carpeta release/<versión>, SHA256SUMS y manifiesto).
- docs/distribucion.md: compilación, artefactos, requisitos por plataforma, pruebas y pendientes.
- IA local opcional con Ollama (ver docs/ia.md): detección de instalación, servicio, versión y modelos; instalación guiada desde la página oficial; inicio de la app oficial; descarga de modelo con progreso real, cancelación y reanudación; clasificación de pendientes con validación y criterio de confianza; revisión de organización de categorías (duplicados, no catalogadas, reglas sugeridas).
- `assets/brand/` con el logotipo original intacto y los maestros derivados; `scripts/generate-brand-icons.mjs`; docs/marca-e-iconos.md.

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
