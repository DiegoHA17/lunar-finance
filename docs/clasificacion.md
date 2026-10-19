# Categorías y reglas de clasificación

## Principios

1. **Las reglas proponen; el usuario decide.** Solo se proponen categorías para movimientos **sin categoría**. La
   aplicación en lote siempre pasa por una vista previa («Clasificar N sin categoría») y se puede desmarcar
   cualquier propuesta.
2. **Nunca se reescribe el histórico en silencio.** Crear o cambiar una regla no modifica movimientos ya
   clasificados; el editor de reglas muestra cuántos coincidirían y avisa de que no se cambiarán.
3. **La ausencia de información no se rellena.** Sin coincidencia o con coincidencia ambigua, el movimiento queda
   pendiente con el motivo.

## Estructura de una regla

| Campo | Valores |
| --- | --- |
| Campo analizado | Descripción o Método de pago |
| Coincidencia | contiene · contiene la palabra · empieza por · es exactamente |
| Texto | Hasta 100 caracteres |
| Categoría de destino | Categoría activa del catálogo |
| Prioridad | Entero 0–1000 (por defecto 50) |
| Activa | Sí / No |
| Condiciones | Tipo (gasto, ingreso, devolución), importe mínimo/máximo, método de pago |
| Excepciones | Textos que, si aparecen, anulan la regla |
| Distinguir acentos | Por defecto no («cafe» = «café») |

Las reglas se guardan en `%APPDATA%\com.lunar.finance\rules.json` (la versión anterior queda en `rules.json.bak`).
No son datos financieros y no duplican nada de Notion; trasladarlas a Notion es una mejora futura.

## Normalización

Antes de comparar: Unicode NFD, sin marcas diacríticas (salvo «distinguir acentos»), minúsculas en español y
espacios colapsados. «palabra» compara secuencias de palabras completas (letras y números), de modo que «bar»
coincide con «Bar Manolo» pero no con «Barcelona».

## Orden y resolución de conflictos

Entre las reglas activas que coinciden **y cuya categoría se puede asignar** (existe, está activa y es compatible
con el tipo del movimiento):

1. mayor **prioridad**;
2. mayor **especificidad**: tipo de coincidencia (exacta > palabra > empieza por > contiene), longitud del texto,
   número de condiciones;
3. si las mejores empatan en prioridad y especificidad **y apuntan a categorías distintas**, el resultado es
   **ambiguo**: el movimiento queda pendiente con el motivo «Varias reglas con la misma prioridad proponen
   categorías distintas».

El resultado no depende del orden en que estén guardadas las reglas (está cubierto por pruebas). La pantalla
Reglas muestra el orden de evaluación y avisa de contradicciones y duplicados.

Si una regla apunta a una categoría archivada o incompatible, se ignora para ese movimiento y se explica en el
motivo.

## Aprender de las correcciones

Al corregir la categoría de un movimiento, el aviso ofrece **«Crear una regla para casos así»**: abre el editor
con la primera palabra significativa de la descripción (sin números, fechas ni palabras vacías como «compra»,
«pago», «tarjeta») y la categoría elegida. El usuario la revisa antes de guardarla; la regla queda marcada como
«creada al corregir».

## Origen de cada clasificación

Con la propiedad opcional «Origen clasificación» (Ajustes → Mejoras opcionales), Lunar escribe `Regla`, `Manual`
o `IA` junto a la categoría. Sin ella, el origen es «desconocido» y se trata como manual.

## Diseño preparado para un proveedor de IA (Ollama)

`ClassificationPipeline` (`src/domain/classifier/pipeline.ts`) encadena:

1. reglas (síncronas, deterministas);
2. si no hay propuesta clara y hay un `ClassificationProvider` de IA habilitado, se le pide una sugerencia
   `{categoryId, confidence, reason}`;
3. `validateSuggestion` comprueba que la categoría existe, está activa y es compatible; si no, se descarta;
4. toda propuesta de IA **requiere confirmación** (el umbral de confianza solo ordena y resalta);
5. si el proveedor falla o no está instalado, se sigue con el resultado de las reglas sin bloquear nada.

El proveedor nunca escribe en Notion ni modifica el esquema: solo devuelve una sugerencia que pasa por las mismas
validaciones que una elección manual. La implementación de Ollama (llamada local a `127.0.0.1:11434` desde Rust)
está fuera de la v1; ver ROADMAP.

## Categorías sugeridas

Gastos: Alimentación, Restaurantes, Ocio, Ropa, Transporte, Vivienda, Suscripciones, Salud, Estudios, Viajes,
Otros. Ingresos: Nómina, Becas, Devoluciones, Otros ingresos. **No se imponen**: al crear el catálogo se marcan por
defecto solo las que ya usas; las sugeridas se añaden si las eliges.

Nota: «Devoluciones» como categoría de ingresos es para reembolsos que prefieras tratar como ingreso. Para una
devolución de una compra concreta, usa el tipo **Devolución** con la categoría del gasto original: así resta del
gasto de esa categoría.
