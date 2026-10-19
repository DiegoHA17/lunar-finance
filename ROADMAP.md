# Roadmap de Lunar

Estados: ✅ hecho y verificado · 🟡 hecho, pendiente de verificar con datos reales · ⏳ pendiente · ⛔ requiere al usuario

## Fase 0 — Inspección y diseño técnico ✅

- ✅ Inspección del entorno (ARCHITECTURE §1): carpeta vacía, Node 22, VS 2022 C++, WebView2; Rust instalado.
- ✅ Arquitectura: Tauri 2 + React 19 + TypeScript + Tailwind 4; Rust para red, token y archivos.
- ✅ API de Notion verificada: `2026-03-11`, modelo de fuentes de datos.
- ✅ Modelo de dominio, estrategia de credenciales y de acceso a Notion documentados.

## Fase 1 — Esqueleto de escritorio y diseño visual ✅

- ✅ Sistema visual «Lunar» (claro/oscuro, IBM Plex Sans local, fase lunar del periodo, movimiento reducido).
- ✅ Seis pantallas: Inicio, Movimientos, Categorías, Reglas, Informes, Ajustes; bienvenida inicial.
- ✅ Estados de carga, vacío y error diferenciados; avisos con acción.
- ✅ Modo demostración con datos ficticios marcados en la interfaz, los avisos y los informes.
- ✅ Revisado en navegador a 1280 px y 900 px, temas claro y oscuro.

## Fase 2 — Integración real con Notion 🟡 / ⛔

- ✅ Cliente con reintentos y clasificación de errores; paginación, deduplicación, papelera, incompletos.
- ✅ Diagnóstico paso a paso (token, permisos, ID, esquema, lectura).
- ✅ Mapeo por ID de propiedad con propuesta automática; valores de «Tipo» configurables.
- ✅ Escritura con control de concurrencia por valores esperados.
- ✅ Probado contra la API simulada (mockito) y el backend de demostración.
- ⛔ **Prueba con tu Notion**: necesita que guardes el token y compartas la base de datos (README → Conectar con
  Notion). Hasta entonces la integración real no se declara verificada.

## Fase 3 — Categorías y reglas ✅ (🟡 en Notion real)

- ✅ Catálogo en Notion creado por la app (asistente con vista previa), categorías implícitas mientras no exista.
- ✅ Crear, editar, alias, archivar/reactivar; nombres únicos normalizados; archivadas visibles en el histórico.
- ✅ Motor de reglas determinista con prioridad, especificidad, ambigüedad, condiciones y excepciones.
- ✅ Revisión en lote de propuestas; reglas a partir de correcciones; conflictos e impacto visibles.
- ✅ Migración opcional «Origen clasificación» (plan + confirmación).

## Fase 4 — Dashboard y estadísticas ✅

- ✅ Totales, balance, devoluciones, transferencias, excluidos; agrupación por categoría.
- ✅ Comparación con el periodo anterior (mismo tramo si el periodo está en curso; nada si no hay datos).
- ✅ Evolución por día/semana/mes con tooltip y vista de tabla.

## Fase 5 — Informes ✅

- ✅ Semana, mes, trimestre, año y personalizado; resumen ejecutivo o detallado.
- ✅ PDF local (pdf-lib) con paginación controlada, cabeceras repetidas, totales no huérfanos y pie «Página X de N».
- ✅ CSV para Excel en español con protección contra inyección de fórmulas.
- ✅ Consistencia panel = informe = PDF = CSV cubierta por pruebas.

## Fase 6 — Seguridad, pruebas y empaquetado ✅

- ✅ Token en Windows Credential Manager; redacción en errores; CSP estricta; sin permisos de archivos en la interfaz.
- ✅ TypeScript estricto, oxlint sin avisos, pruebas de TypeScript y de Rust.
- ✅ Instalador NSIS por usuario (ver docs/pruebas-y-empaquetado.md).

## Siguientes pasos

- ⛔ Conectar tu Notion y ejecutar el diagnóstico.
- ⏳ Relación «Categoría» → base de datos «Categorías» (requiere cambiar el atajo del iPhone para escribirla).
- ⏳ Sincronizar las reglas en Notion (para compartirlas entre equipos).
- ⏳ Importar/exportar reglas en JSON desde la interfaz.
- ⏳ Firma de código del instalador.

## Fase futura — Ollama ⏳

No forma parte de la primera entrega. Plan:

1. `OllamaProvider` en Rust (HTTP local a `127.0.0.1:11434`, sin descargar modelos), detrás de un ajuste
   desactivado por defecto.
2. Prompt cerrado con la lista de categorías activas compatibles; respuesta JSON validada por
   `validateSuggestion`; siempre con confirmación.
3. **Prueba de mejora real**: con un conjunto etiquetado de descripciones sintéticas, medir qué porcentaje de
   pendientes sin regla acierta la IA (precisión por encima del 90 % con confianza alta) frente a dejarlos
   pendientes. Si no mejora, no se activa.

## Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| La base de datos no está compartida con la integración (`404 object_not_found` previo) | Sin datos reales | Diagnóstico paso a paso, lista de fuentes accesibles e instrucciones de compartir |
| El esquema real difiere de las propiedades esperadas | Mapeo incorrecto | Mapeo configurable por ID, validación de tipos, propuesta automática por nombre |
| Límite de ~3 peticiones/s | Clasificaciones en lote lentas | Escrituras secuenciales con progreso; reintentos con `Retry-After` |
| Límite de 10 000 resultados por consulta | Historial truncado | Se detecta `request_status: incomplete` y se avisa |
| Notion guarda importes en coma flotante | Errores de redondeo | Conversión única a céntimos con validación |
| El atajo escribe la categoría como texto/selección | Categorías sin catálogo | Resolución por nombre normalizado y alias; categorías implícitas |
| Instalador sin firmar | Aviso de SmartScreen | Documentado; firma pendiente |
