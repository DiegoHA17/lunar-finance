# Pagos periódicos

Gastos o ingresos que se repiten cada semana, mes o año (alquiler, suscripciones, nómina). Lunar Finance los registra
en Notion **al abrir o sincronizar** la aplicación; no hay ningún proceso en segundo plano y no funciona con la
aplicación cerrada.

## Uso

**Pagos periódicos** → **Nuevo pago periódico**: descripción, importe, tipo, categoría, método de pago, frecuencia,
fecha del primer pago y modo de registro.

| Modo | Qué ocurre con un pago vencido |
| --- | --- |
| Con confirmación (predeterminado) | Aparece en «Pendientes de registrar» hasta que lo registres u omitas. |
| Automático | Se registra solo al abrir o sincronizar. Las fechas anteriores al alta de la regla (o al último cambio de calendario) siempre piden confirmación. |

- **Calendario.** Las fechas se calculan desde la fecha de inicio: un pago el día 31 cae el 30 en abril, el 28 o 29
  en febrero y vuelve al 31 en marzo; uno anual el 29 de febrero cae el 28 en los años no bisiestos. Si llevas tiempo
  sin abrir la aplicación, se generan todos los periodos vencidos, cada uno con su fecha.
- **Pausar / reanudar.** Al reanudar se continúa desde hoy: los pagos del periodo en pausa no se recuperan.
- **Editar.** Los cambios de importe, categoría o descripción solo afectan a los pagos aún no registrados. Cambiar la
  frecuencia o la fecha exige que el nuevo calendario empiece después del último pago registrado u omitido.
- **Eliminar.** Borra la regla; los movimientos ya creados en Notion no se tocan.
- Lunar Finance nunca modifica ni borra movimientos existentes por un pago periódico.

## Requisito: propiedad «Pago periódico»

La primera vez, la pantalla propone añadir a la base de movimientos una propiedad de texto **«Pago periódico»**
(cambio no destructivo, con confirmación). Sin ella no se registra nada. En cada movimiento creado se escribe una
clave estable `lunar-rp:<regla>:<fecha>`; no la edites ni la copies a otros movimientos.

## Cómo se evitan los duplicados

1. **Notion es la fuente de verdad.** Antes de registrar se vuelve a leer la base de movimientos. Si ya existe un
   movimiento con la clave de esa ocurrencia, se da por registrada (aunque hayas cambiado su importe o descripción).
2. **Registro local previo al envío.** La ocurrencia se anota como «enviándose» en el disco antes de pedir a Notion
   que la cree. Si la respuesta no llega (corte de red, error 5xx) y en la siguiente lectura Notion no tiene la clave,
   la ocurrencia pasa a revisión manual con dos opciones: **Registrar de nuevo** o **Ya está en Notion**. Nunca se
   reintenta sola.
3. **Lo hecho no se repite.** Una ocurrencia registrada u omitida no se vuelve a generar, aunque borres el movimiento
   en Notion.
4. **Sin datos fiables, nada automático.** No se registra nada si la consulta a Notion está incompleta, si cambió la
   base de movimientos configurada o si ya hay un movimiento igual (fecha, importe, tipo y descripción) sin clave,
   por ejemplo uno introducido a mano: en ese caso se pide revisión.
5. **Exclusión.** Un cerrojo del sistema impide que dos ventanas o instancias de Lunar Finance del mismo equipo
   registren a la vez.

## Almacenamiento

`recurring.json`, junto a `rules.json` (en Windows, `%APPDATA%\com.lunar.finance\`), con copia anterior en
`recurring.json.bak`. Contiene las reglas y el registro de ocurrencias (registrada con el ID de la página, omitida o
enviándose). Se escribe de forma atómica y se fuerza a disco antes de sustituir el archivo. Si está dañado, no se
registra nada hasta resolverlo.

## Limitaciones

- Si usas Lunar Finance en **dos equipos** con pagos automáticos, cada uno tiene su propio registro local. La clave en
  Notion evita duplicados salvo que ambos registren el mismo pago casi a la vez; usa el modo automático en un solo
  equipo.
- **Registrar de nuevo** tras un envío sin respuesta es decisión tuya: compruébalo antes en Notion.
- Los pagos atrasados se registran con el importe y la categoría actuales de la regla.
