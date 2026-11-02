# Atajo «Registrar Gasto manual»

Apunta un gasto en tu base de datos de Notion desde el iPhone, escribiendo la descripción, el importe y la categoría,
y eligiendo el tipo y el método de pago.

> **Estado:** el archivo `.shortcut` original no se publica porque puede contener un token. No se ha comprobado su
> lista completa de acciones. Esta guía explica cómo montar **un atajo equivalente** a partir de la petición que sí se
> ha comprobado (ver [atajos-iphone.md](../atajos-iphone.md)).

## Requisitos

- Un iPhone con la app **Atajos** de Apple.
- La base de datos de gastos preparada como se explica en [configuracion-notion.md](../configuracion-notion.md#2-preparar-la-base-de-datos-de-gastos).
- Una integración de Notion **solo para los atajos**, compartida con esa base de datos, con la capacidad «Insertar
  contenido» y su token (`ntn_…`).
- El ID de tu base de datos: los 32 caracteres del enlace antes de `?v=`.

## Configuración

Cómo montar un atajo equivalente:

1. **Pedir los datos.** Usa acciones **Pedir entrada** para la descripción, el importe y la categoría, y **Elegir de
   la lista** para el tipo (`Gasto`, `Ingreso`…) y el método de pago (`Tarjeta`, `Efectivo`, `Bizum`…).
2. **Fecha.** Obtén la fecha actual con formato ISO 8601, por ejemplo `2026-10-18T19:32:00+02:00`.
3. **Cuerpo.** Construye un **Texto** con el JSON de [`crear-gasto.json`](crear-gasto.json) y sustituye los valores
   de ejemplo por las variables de los pasos anteriores.
4. **Petición.** Añade **Obtener contenido de URL** con esta configuración:
   - URL: `https://api.notion.com/v1/pages`
   - Método: `POST`
   - Cabeceras:
     - `Authorization`: `Bearer TU_TOKEN_DE_NOTION`
     - `Notion-Version`: `2022-06-28`
     - `Content-Type`: `application/json`
   - Cuerpo de la solicitud: **Archivo**, con el texto del paso 3.
5. Opcional: muestra una notificación con el resultado.

## Propiedades que escribe

| Propiedad | Tipo | Ejemplo ficticio |
| --- | --- | --- |
| Descripción | Título | `Compra de ejemplo` |
| Fecha | Fecha | `2026-10-18T19:32:00+02:00` |
| Categoría | Selección | `Ocio` |
| Tipo | Selección | `Gasto` |
| Cantidad | Número | `12.5` |
| Método de Pago | Selección | `Tarjeta` |

Los nombres deben coincidir **exactamente** con los de tu base de datos, con mayúsculas y tildes. Si en Notion se
llaman de otra forma, cámbialos en el JSON.

## Solución de problemas

| Respuesta de Notion | Causa probable |
| --- | --- |
| `401 unauthorized` | Token mal copiado o regenerado. Falta el prefijo `Bearer ` |
| `404 object_not_found` | La base de datos no está compartida con la integración del atajo, o el ID es de una vista enlazada |
| `400 validation_error` sobre «Cantidad» | El importe va entre comillas o con coma decimal (`12,5`). En JSON debe ser `12.5`, sin comillas |
| `400 validation_error` sobre otra propiedad | El nombre o el tipo de la propiedad no coincide con la base de datos |
| `400` mencionando `data source` | La base de datos tiene varias fuentes de datos. Con la versión `2022-06-28` no se puede crear en ella |

Si el movimiento se crea pero Lunar Finance lo deja «fuera de los totales», revisa que «Tipo» tenga un valor asignado
en **Ajustes** y que la fecha y el importe no estén vacíos.

## Seguridad

- El token queda guardado dentro del atajo: no compartas tu copia personal.
- Comparte la integración del atajo **solo** con la base de datos de gastos.
- Más recomendaciones en [atajos-iphone.md](../atajos-iphone.md#seguridad).
