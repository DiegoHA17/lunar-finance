# Atajo «Registrar Gasto con Tarjeta»

Este atajo está pensado para registrar en Notion los pagos con tarjeta mediante una **automatización** de la app
Atajos, sin tener que abrir nada al pagar.

> **Estado:** el archivo `.shortcut` original no se publica: puede contener un token y no se ha podido auditar.
> **No se ha verificado:**
>
> - qué dispara la automatización;
> - qué datos del pago recibe;
> - si usa algún tipo de IA;
> - qué acciones contiene.
>
> Esta guía describe solo lo comprobado y lo que necesitas para montar algo equivalente.

## Lo que se sabe

- Registra el movimiento con la misma petición a la API de Notion que el atajo manual (ver
  [atajos-iphone.md](../atajos-iphone.md#lo-que-se-ha-comprobado)) y las mismas propiedades.
- Está asociado a una automatización de pagos con tarjeta en el iPhone.
- El método de pago esperado es `Tarjeta`.

## Requisitos

- Un iPhone con la app **Atajos** y la tarjeta configurada en el iPhone.
- Lo mismo que el atajo manual: base de datos preparada, integración propia del atajo con «Insertar contenido»,
  token e ID de la base de datos.

## Configuración

1. Monta el cuerpo y la petición como en [Registrar Gasto manual](registrar-gasto-manual.md#configuración), pasos 2-4.
2. Rellena `Cantidad` y `Descripción` con los datos del pago que reciba el atajo. Fija `Método de Pago` en `Tarjeta`
   y `Tipo` en `Gasto`.
3. En la pestaña **Automatización** de la app Atajos, crea una automatización personal que ejecute el atajo. Los
   disparadores disponibles dependen de la versión de iOS y de tu tarjeta; elige el que corresponda a tus pagos.
4. Prueba primero con una **base de datos de ejemplo** y comprueba cada propiedad antes de usarla con la real.

## Propiedades que escribe

Las mismas que el atajo manual: Descripción, Fecha, Categoría, Tipo, Cantidad y Método de Pago. Si la automatización
no conoce la categoría, puedes dejarla vacía. Lunar Finance la propondrá después con tus reglas o con la IA local
(Movimientos → **Clasificar N sin categoría**).

## Solución de problemas

- Los errores de Notion son los mismos que en el atajo manual (ver la
  [tabla](registrar-gasto-manual.md#solución-de-problemas)). El más habitual en esta automatización es que el importe
  llegue con coma decimal o con el símbolo `€`, y Notion rechace el número.
- **Movimientos repetidos.** Si la automatización se ejecuta dos veces para el mismo pago, Notion tendrá dos
  movimientos. Lunar Finance los marca como **posible duplicado**, pero no los borra: elimina el sobrante en Notion.
- **La automatización no se ejecuta.** Revisa en la app Atajos que esté activada y si pide confirmación antes de
  ejecutarse.

## Seguridad

- El token va dentro del atajo, y la automatización se ejecuta sin preguntar: usa una integración que solo pueda
  insertar en tu base de gastos.
- No compartas este atajo. Antes de publicar una versión, sigue los pasos de
  [atajos-iphone.md](../atajos-iphone.md#seguridad).
