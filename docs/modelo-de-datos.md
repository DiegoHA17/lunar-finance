# Modelo de datos

## Movimiento

| Campo | Tipo | Origen en Notion | Notas |
| --- | --- | --- | --- |
| `id` | string | ID de página | Identificador estable. Se usa para deduplicar y actualizar. |
| `description` | string | Descripción (título) | Vacía ⇒ aviso «Sin descripción» (no bloquea). |
| `date` | `AAAA-MM-DD` \| null | Fecha | Se toma la fecha de calendario tal cual (sin conversión horaria). Sin fecha ⇒ **excluido**. |
| `amountCents` | entero \| null | Cantidad | Céntimos, valor absoluto. Sin importe ⇒ **excluido**. Más de 2 decimales ⇒ se redondea y se avisa. Negativo ⇒ se usa el valor absoluto y se avisa. |
| `kind` | gasto \| ingreso \| devolución \| transferencia \| null | Tipo | Según la asignación de valores en Ajustes. Desconocido ⇒ **excluido**. |
| `categoryLink` | nombre \| ID \| null | Categoría | Tal como está en Notion. |
| `categoryId` | string \| null | — | Categoría del catálogo resuelta por ID, nombre o alias. |
| `paymentMethod` | string \| null | Método de pago | |
| `origin` | regla \| manual \| IA \| desconocido | Origen de la clasificación (opcional) | «Desconocido» se trata como manual: nunca se reclasifica. |
| `issues` | lista | — | Incidencias con mensaje y si bloquean los totales. |

### Importes

- Toda la aritmética se hace con **céntimos enteros** (`Number.isSafeInteger`).
- La única conversión desde coma flotante es `toCents`: redondea sobre la representación decimal de 15 cifras
  (así `0,1 + 0,2` es 30 céntimos y `1,005` es 101), con redondeo «mitad hacia fuera del cero».
- Al escribir en Notion se envía `céntimos / 100`.
- Moneda única: euro. Formato español `1.234,56 €` (agrupación también en cifras de 4 dígitos para alinear columnas).

### Tipos de movimiento

| Tipo | Efecto |
| --- | --- |
| Gasto | Suma al gasto de su categoría. |
| Devolución | Resta del gasto de su categoría (se clasifica con categorías de gasto). |
| Ingreso | Suma a los ingresos de su categoría. |
| Transferencia | Entre cuentas propias: **no** cuenta como gasto ni como ingreso, no lleva categoría. |

### Fórmulas (únicas, en `src/domain/stats.ts`)

```
gasto neto = Σ gastos − Σ devoluciones
balance    = Σ ingresos − gasto neto
```

El balance **no es el saldo bancario**: es el resultado de los movimientos registrados en el periodo.

### Incidencias

| Código | Bloquea | Significado |
| --- | --- | --- |
| `missing_date` | sí | Sin fecha válida |
| `missing_amount` | sí | Sin importe o ilegible |
| `missing_kind` / `unknown_kind` | sí | Sin tipo o valor de tipo no asignado |
| `excess_decimals` | no | Más de dos decimales |
| `negative_amount` | no | Importe negativo en Notion |
| `unknown_category` | no | La categoría no está en el catálogo (se agrupa por su nombre como «no catalogada») |
| `kind_mismatch` | no | Categoría de ingresos en un gasto o viceversa |
| `possible_duplicate` | no | Otro movimiento con la misma fecha, importe, tipo, descripción y método |
| `missing_description` | no | Sin descripción |

Los movimientos excluidos aparecen en Movimientos («Fuera de los totales»), en el aviso del panel y al final de los
informes con su motivo. Los posibles duplicados se señalan pero **nunca se eliminan**.

## Categoría

| Campo | Propiedad en «Categorías» | Notas |
| --- | --- | --- |
| `id` | ID de página | Identificador estable. |
| `name` | Nombre (título) | Único según la normalización (sin acentos, mayúsculas ni signos). Sin comas (limitación de Notion). |
| `kind` | Tipo: Gasto \| Ingreso | |
| `status` | Estado: Activa \| Archivada | Las archivadas no admiten movimientos nuevos, pero siguen en el histórico y los informes. |
| `color` | Color (texto) | Clave de la paleta de Lunar. |
| `icon` | Icono (texto) | Nombre de icono de Lunar. |
| `description` | Descripción | |
| `aliases` | Alias (texto separado por comas) | Nombres alternativos y nombres anteriores. |

### Vínculo movimiento → categoría

Según el tipo real de la propiedad «Categoría» de la base de datos de movimientos:

- **select / texto** (lo que escribe hoy el atajo): se resuelve por nombre normalizado o alias. Renombrar una
  categoría guarda el nombre anterior como alias, así los movimientos históricos siguen asociados sin reescribirlos.
- **relation**: se resuelve por ID de página.

Sin catálogo en Notion, Lunar deduce **categorías implícitas** de los valores existentes (solo lectura) para no
perder la agrupación hasta que se cree el catálogo.

### Estrategia de migración (no destructiva)

1. **Crear «Categorías»** (pantalla Categorías): base de datos nueva; se dan de alta las categorías ya usadas y las
   sugeridas que el usuario marque. Los movimientos **no se modifican** y el atajo sigue funcionando.
2. **Propiedad «Origen clasificación»** (Ajustes → Mejoras opcionales): alta de una selección (Regla, Manual, IA).
   Plan visible y confirmación explícita; no toca las propiedades existentes.
3. **Relación con «Categorías»** (futuro, ver ROADMAP): requeriría que el atajo escriba la relación. Mientras tanto
   el vínculo por nombre + alias es suficiente y no exige cambiar el atajo.

Nunca se elimina ni se modifica una propiedad existente, ni se borra una categoría asociada a movimientos.

## Periodos

Intervalos cerrados `[inicio, fin]` de fechas de calendario: semana ISO (lunes a domingo, puede cruzar el año),
mes, trimestre, año y personalizado (máx. 20 años). El periodo anterior es el del mismo tipo (o de la misma
duración si es personalizado). Si el periodo actual está en curso, la comparación usa **lo transcurrido frente al
mismo número de días del anterior** (comparar medio mes con un mes completo sería engañoso). No se muestran
comparaciones ni porcentajes cuando el periodo anterior no tiene datos o la base es cero.
