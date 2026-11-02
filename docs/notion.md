# Integración con Notion

## Versión de la API

Lunar usa **`Notion-Version: 2026-03-11`**, la vigente a 2026-10-19 (verificada en
<https://developers.notion.com/reference/versioning>). Se basa en el modelo de **fuentes de datos** introducido en
`2025-09-03`:

- Una *base de datos* es un contenedor; su esquema y sus filas pertenecen a una o varias *fuentes de datos*.
- Las consultas, el esquema y la creación de páginas usan el `data_source_id`, no el `database_id`.
- `2026-03-11` renombra `archived` → `in_trash` (Lunar lee los tres nombres por compatibilidad y descarta las
  páginas en la papelera).

| Operación | Endpoint |
| --- | --- |
| Comprobar el token | `GET /v1/users/me` |
| Fuentes compartidas con la integración | `POST /v1/search` con `filter: { property: "object", value: "data_source" }` |
| Resolver un enlace de base de datos | `GET /v1/data_sources/{id}` y, si da 404, `GET /v1/databases/{id}` → `data_sources[]` |
| Esquema | `GET /v1/data_sources/{id}` |
| Leer movimientos | `POST /v1/data_sources/{id}/query` (100 por página, `start_cursor`, orden por `created_time`) |
| Crear | `POST /v1/pages` con `parent: { type: "data_source_id", data_source_id }` |
| Actualizar | `GET /v1/pages/{id}` (comprobaciones) + `PATCH /v1/pages/{id}` |
| Añadir propiedades (migraciones opcionales) | `PATCH /v1/data_sources/{id}` (solo altas) |
| Crear «Categorías» | `POST /v1/databases` con `initial_data_source.properties` |

## Permisos necesarios

La integración (interna) necesita las capacidades **Leer contenido**, **Actualizar contenido** e **Insertar
contenido**, y la base de datos debe estar **compartida** con ella (menú `···` → Conexiones). El error histórico
`404 object_not_found` con la integración «Atajo iPhone» es exactamente la falta de este último paso: Notion
responde 404 (no 403) cuando el recurso existe pero no se ha compartido.

## Diagnóstico

Ajustes → Diagnóstico ejecuta, sin escribir nada:

1. **Token guardado** — hay un secreto en el Administrador de credenciales.
2. **Autenticación** — `GET /v1/users/me` (distingue token inválido/revocado: 401).
3. **Bases de datos compartidas** — cuántas fuentes ve la integración (0 ⇒ no se ha compartido nada).
4. **Acceso a Movimientos** — la fuente configurada existe y es accesible (404 ⇒ no compartida o ID erróneo).
5. **Esquema de Movimientos** — cada campo asignado existe y tiene un tipo compatible; avisa de renombrados.
6. **Lectura de Movimientos** — consulta de 1 registro (distingue «vacía» de «error»).
7. Lo mismo para **Categorías**, si está configurada.

## Mapeo de propiedades

Las propiedades se guardan por **ID** (estable ante renombrados) junto con su nombre y tipo. Campos de
movimientos:

| Campo | Tipos admitidos | Obligatorio |
| --- | --- | --- |
| Descripción | title, rich_text | sí |
| Fecha | date (o created_time, solo lectura) | sí |
| Cantidad | number (o formula, solo lectura) | sí |
| Tipo | select, status, rich_text | sí |
| Categoría | select, rich_text, relation | sí |
| Método de pago | select, rich_text, multi_select (solo lectura) | no |
| Origen de la clasificación | select, rich_text | no |
| Pago periódico | rich_text | no (necesaria para registrar pagos periódicos) |

Los valores de «Tipo» se asignan a gasto, ingreso, devolución o transferencia en Ajustes. Un valor sin asignar deja
el movimiento **fuera de los totales** con el motivo visible: nunca se adivina.

## Lectura

- Paginación completa con `has_more`/`next_cursor`; se detecta un cursor repetido o ausente (error de paginación) y
  un bucle de más de 101 páginas.
- Deduplicación por ID de página (Notion puede repetir filas si los datos cambian durante la paginación).
- Si Notion devuelve `request_status: incomplete` (límite de 10 000 filas por consulta), se avisa en la interfaz y
  en los informes.
- Un error **nunca** se convierte en una lista vacía: la interfaz distingue «sin registros» de «error al
  consultar». Si había datos previos, se siguen mostrando con un aviso y la hora de la última lectura.

## Escritura y control de concurrencia

Antes de cada `PATCH`, la capa nativa:

1. lee la página y comprueba que pertenece a la fuente de datos del rol (movimientos/categorías);
2. rechaza la página si está en la papelera;
3. compara los **valores esperados** de las propiedades que se van a cambiar con los actuales; si difieren,
   devuelve «conflicto» y no escribe (`last_edited_time` solo tiene precisión de minutos y no basta);
4. comprueba que el tipo de cada valor coincide con el esquema real.

Solo se envían las propiedades que cambian. Los textos se trocean en bloques de 2 000 caracteres (límite de Notion)
y se rechazan comas en las opciones de selección.

## Límites y errores

| Situación | Comportamiento |
| --- | --- |
| 429 / 529 | Espera lo que indique `Retry-After` (máx. 30 s) y reintenta hasta 4 veces, también en escrituras (no se procesaron). |
| 500/502/503/504 | Reintento con espera exponencial solo en lecturas; en escrituras se informa (podría haberse guardado). |
| Sin red / tiempo agotado | Reintento en lecturas; mensaje «No se pudo conectar con Notion». |
| 401 / 403 / 404 / 400 validation_error / 409 | Mensaje específico con la acción a realizar (ver README). |

## Pruebas

Las pruebas de Rust (`cargo test`) simulan la API con `mockito`: cabeceras, paginación, deduplicación, papelera,
resultados incompletos, 401/403/404, 429 con `Retry-After`, 5xx en lecturas y escrituras, red caída, conflictos,
tipos incorrectos y páginas de otra fuente. **No hay pruebas automáticas contra Notion real**: requieren el token
del usuario y se hacen con el diagnóstico de la aplicación.

## Estado de la conexión real

- **Lectura con Notion real:** verificada el 2026-10-19 con el diagnóstico completo en verde y la lectura de
  movimientos y categorías.
- **Escritura con Notion real:** no se ha probado de forma controlada. Las pruebas no modifican datos reales: la
  escritura (incluidos los pagos periódicos) se ha probado con la API simulada y con el backend de demostración.

Guía para usuarios: [configuracion-notion.md](configuracion-notion.md).
