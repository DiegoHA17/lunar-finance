# Atajos de iPhone

Además de la aplicación de escritorio, uso dos atajos de la app **Atajos** de Apple para apuntar gastos en Notion
desde el iPhone. Lunar Finance lee después esos movimientos como cualquier otro.

| Atajo | Para qué | Guía |
| --- | --- | --- |
| **Registrar Gasto manual** | Apuntar un gasto escribiendo los datos | [registrar-gasto-manual.md](atajos/registrar-gasto-manual.md) |
| **Registrar Gasto con Tarjeta** | Registrar en Notion los pagos con tarjeta mediante una automatización | [registrar-gasto-tarjeta.md](atajos/registrar-gasto-tarjeta.md) |

## Estado

- **Los atajos importables (`.shortcut`) no se publican.** Los originales pueden contener el token de Notion. No se ha
  podido auditar su interior de forma fiable: son archivos firmados por Apple. Se publicarán cuando exista una
  versión saneada, comprobada en un iPhone, que pida el token al importarla.
- **Lo que sí se publica:** guías para montar un atajo equivalente y un [JSON de ejemplo](atajos/crear-gasto.json)
  con datos ficticios.
- **Lo que no se ha verificado:**
  - qué acciones exactas usa cada atajo;
  - qué dispara la automatización de pagos;
  - si hay más peticiones de red, aparte de la que se describe aquí.

## Lo que se ha comprobado

Una captura de la acción **Obtener contenido de URL** muestra una petición a la API de Notion con estas
características:

- Método y dirección: `POST https://api.notion.com/v1/pages`.
- Cabecera `Notion-Version: 2022-06-28`.
- Destino: la base de datos de gastos (`parent.database_id`).
- Cuerpo JSON con las propiedades de la tabla siguiente.

| Propiedad | Tipo en Notion | Origen del valor en la captura |
| --- | --- | --- |
| Descripción | Título | Variable de texto «Respuesta» |
| Fecha | Fecha (ISO 8601, con hora) | Fecha con formato ISO 8601 (la acción que la genera no consta) |
| Categoría | Selección | «Entrada proporcionada» |
| Tipo | Selección | «Ítem seleccionado» |
| Cantidad | Número (sin comillas) | «Entrada proporcionada» |
| Método de Pago | Selección | «Ítem seleccionado» |

La captura no indica a cuál de los dos atajos pertenece. Las mismas propiedades sirven para Lunar Finance (ver
[configuracion-notion.md](configuracion-notion.md)).

En los datos reales apareció «Gasto » con un espacio al final, escrito por un atajo. Lunar Finance lo reconoce y, al
escribir, reutiliza la misma variante para no duplicar opciones. Aun así, conviene que el atajo no añada espacios.

## Compatibilidad con Lunar Finance

- El atajo usa la versión `2022-06-28` de la API y Lunar Finance la `2026-03-11`. Las dos trabajan sobre la misma base
  de datos, que es el caso habitual: una base creada a mano tiene una sola fuente de datos. Con varias fuentes de
  datos, Notion no admite crear páginas con `database_id` en versiones antiguas de la API.
- Usa **una integración distinta** para los atajos y otra para Lunar Finance. Así puedes revocar una sin romper la
  otra.

## Seguridad

- **El token viaja dentro del atajo.** Cualquiera que reciba el archivo, o un enlace de iCloud al atajo, puede leerlo.
  No compartas tu atajo personal.
- **Integración con el mínimo permiso.** Para crear movimientos basta en principio con «Insertar contenido».
  Compártela solo con la base de datos de gastos.
- **Para compartir un atajo:** sustituye el token y el ID de la base de datos por **preguntas de importación** (en los
  detalles del atajo). Así cada persona introduce los suyos. Antes de publicarlo, comprueba en un iPhone que el
  archivo exportado no conserva ningún valor tuyo.
- **No publiques capturas** donde se vea `Bearer ntn_…`, aunque sea parcialmente, ni enlaces a tu espacio de Notion.
- **Si un token se ha visto en una captura o en un archivo compartido, regénéralo** (ver [SECURITY.md](../SECURITY.md)).
