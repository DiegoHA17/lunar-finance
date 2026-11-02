# Conectar Lunar Finance con Notion

Guía paso a paso para quien nunca ha creado una integración de Notion. Se tarda unos 10 minutos.

> En esta guía, todos los nombres, importes, enlaces e identificadores son **ficticios**. No copies ni compartas
> nunca tu token real.

## 1. Qué es Notion y por qué lo usa Lunar Finance

[Notion](https://www.notion.so) es una aplicación de notas y bases de datos. Muchas personas apuntan allí sus gastos
porque es flexible y se puede usar desde el móvil.

Lunar Finance usa **tu base de datos de Notion como único almacén**. No tiene servidor ni base de datos propia: lee
tus movimientos, los ordena y calcula estadísticas e informes. Solo escribe en Notion cuando tú se lo pides, o con los pagos periódicos que configures como automáticos.

Para hablar con Notion necesita una **integración**: un acceso con permisos limitados que tú creas y que solo ve las
páginas que compartes con él.

## 2. Preparar la base de datos de gastos

Si ya tienes una, sáltate este paso: Lunar Finance se adapta a tus nombres de propiedades. Si empiezas de cero, crea
una base de datos de página completa en Notion (`/database` → **Base de datos: página completa**) con estas
propiedades:

| Propiedad (nombre sugerido) | Tipo en Notion | ¿Obligatoria? | Para qué sirve |
| --- | --- | --- | --- |
| Descripción | Título | Sí | Concepto o comercio («Supermercado», «Nómina»). |
| Fecha | Fecha | Sí | Día del movimiento. |
| Cantidad | Número | Sí | Importe en euros, **siempre positivo**. El sentido lo da «Tipo». |
| Tipo | Selección | Sí | `Gasto`, `Ingreso`, `Devolución` o `Transferencia`. |
| Categoría | Selección | Sí | «Alimentación», «Transporte»… |
| Método de Pago | Selección | No | «Tarjeta», «Efectivo», «Bizum»… |

Detalles que comprueba la aplicación:

- **Los nombres no tienen que coincidir.** Lunar Finance propone la asignación y puedes corregirla. Reconoce, por
  ejemplo, «Importe» o «Monto» para la cantidad.
- **Tipos admitidos**, además de los de la tabla:
  - Descripción: texto.
  - Fecha: «Fecha de creación» (solo lectura).
  - Cantidad: fórmula (solo lectura).
  - Tipo: estado o texto.
  - Categoría: texto o relación con una base «Categorías».
  - Método de pago: texto o selección múltiple (esta última, solo lectura).
- **Los valores de «Tipo» pueden llamarse de otra forma.** En Ajustes indicas qué significa cada uno. Un valor sin
  asignar deja el movimiento fuera de los totales, con el motivo visible: la aplicación nunca lo adivina.
- **Un importe negativo** se lee como positivo y se marca con un aviso.
- **Propiedades opcionales que la aplicación puede añadir por ti**, siempre con confirmación y sin tocar las
  existentes:
  - «Origen clasificación» (selección): registra si la categoría la puso una regla, la IA o tú.
  - «Pago periódico» (texto): necesaria para los [pagos periódicos](pagos-periodicos.md).

Movimiento de ejemplo: `Supermercado` · `14/10/2026` · `42,80` · `Gasto` · `Alimentación` · `Tarjeta`.

## 3. Crear la integración

1. Abre <https://www.notion.so/profile/integrations> con tu cuenta.
2. Pulsa **Nueva integración**.
3. Ponle un nombre, por ejemplo «Lunar Finance». Elige el **espacio de trabajo** donde está tu base de datos y el tipo
   **Interna**.
4. En **Capacidades**, activa **Leer contenido**, **Actualizar contenido** e **Insertar contenido**.
5. Guarda.

La interfaz de Notion cambia de vez en cuando; si algún botón tiene otro nombre, busca las mismas opciones.

## 4. Copiar el token

En la página de la integración, copia el **Internal Integration Secret**: un texto largo que empieza por `ntn_`.

Trátalo como una contraseña:

- no lo pegues en chats, capturas, *issues* ni documentos;
- quien lo tenga puede leer y modificar todo lo que compartas con la integración;
- si se expone, regénéralo (ver [SECURITY.md](../SECURITY.md)).

## 5. Dar acceso a la base de datos

Una integración nueva no ve nada hasta que le das acceso.

1. Abre tu base de datos de gastos en Notion.
2. Pulsa el menú **···** (arriba a la derecha) → **Conexiones**.
3. Busca la integración por su nombre y confírmalo.

Si vas a crear el catálogo de categorías desde la aplicación, comparte también la **página** donde quieres que se
cree.

> Sin este paso Notion responde **404 «object_not_found»** aunque el token sea correcto. Es el error más habitual.

## 6. Identificar la base de datos correcta

Lunar Finance te ofrece dos formas de elegirla:

- **Ver bases de datos compartidas.** Lista las que ve la integración. Si solo has compartido una, solo verás esa.
- **Pegar el enlace.** En Notion, abre la base de datos como página completa → **···** → **Copiar enlace**. Tiene esta
  forma (ficticia):

  ```text
  https://www.notion.so/miespacio/Gastos-0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210
  ```

  El identificador son los 32 caracteres que van antes de `?v=`. Usa el enlace de la **base de datos original**, no
  el de una *vista enlazada* dentro de otra página: ese apunta a otro sitio y Notion devuelve 404.

## 7. Configurar Lunar Finance

1. Abre Lunar Finance y pulsa **Conectar con Notion**. Si ya habías entrado, ve a **Ajustes**.
2. En **Conexión con Notion**, pega el token y pulsa **Guardar token**. Se guarda en el almacén seguro del sistema:
   el Administrador de credenciales en Windows, o GNOME Keyring o KWallet en Linux. No se escribe en ningún archivo.
3. En **Base de datos de movimientos**, pulsa **Ver bases de datos compartidas** y elige la tuya. También puedes pegar
   el enlace y pulsar **Usar este enlace**.
4. Revisa la **asignación de propiedades** que propone la aplicación.
5. Indica qué significa cada valor de **Tipo**: gasto, ingreso, devolución o transferencia.
6. Pulsa **Guardar y leer datos**.

## 8. Comprobar que funciona

**Ajustes → Diagnóstico → Ejecutar diagnóstico** comprueba, sin escribir nada, estos pasos:

1. que hay un token guardado;
2. que Notion lo acepta;
3. qué bases de datos ve la integración;
4. que la base elegida es accesible;
5. que cada propiedad asignada existe y tiene un tipo compatible;
6. que se puede leer un movimiento.

Si todo sale en verde verás **Conexión correcta**, y en **Inicio** aparecerán tus movimientos.

## 9. Errores frecuentes

| Mensaje en Lunar Finance | Causa | Solución |
| --- | --- | --- |
| «Notion no encuentra el recurso o no está compartido con la integración» (404) | La base de datos no está compartida, o el enlace es de una vista enlazada | Repite el [paso 5](#5-dar-acceso-a-la-base-de-datos) y elige la base original |
| «Notion ha rechazado el token» (401) | Token mal copiado, de otra integración o regenerado | Cópialo de nuevo (paso 4) y vuelve a guardarlo |
| «La integración no tiene permiso» (403) | Faltan capacidades | Activa las tres del paso 3 |
| La lista de bases compartidas está vacía | No has compartido nada con esta integración, o está en otro espacio de trabajo | Paso 5; comprueba el espacio de trabajo de la integración |
| «La propiedad … ya no existe» o «es de tipo …» | Has renombrado o cambiado una propiedad | Ajustes → Base de datos de movimientos → **Cambiar o revisar el mapeo** |
| Movimientos «fuera de los totales» | Les falta fecha o importe, o su «Tipo» no está asignado | Complétalos en Notion o asigna el valor de «Tipo» en Ajustes |
| «El movimiento ha cambiado en Notion desde la última actualización» | Se editó en Notion (o desde un atajo) a la vez | Actualiza y repite el cambio. Lunar Finance nunca sobrescribe a ciegas |
| «Se ha alcanzado el límite de peticiones de Notion» | Notion admite unas 3 peticiones por segundo | La aplicación reintenta sola; si persiste, espera un minuto |
| «No se pudo conectar con Notion» | Sin Internet | Tus datos no se han modificado; vuelve a intentarlo |
| No se puede guardar el token (Linux) | No hay llavero disponible | Instala o activa GNOME Keyring o KWallet |

Detalles técnicos (versión de la API, endpoints, reintentos y concurrencia): [notion.md](notion.md).
