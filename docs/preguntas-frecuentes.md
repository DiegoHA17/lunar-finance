# Preguntas frecuentes

### ¿Necesito Notion para usar Lunar Finance?

Para ver tus datos, sí: Notion es el único sitio donde se guardan los movimientos. Para probar la aplicación, no: en la
primera pantalla elige **Ver demostración**. Verás datos ficticios, marcados como tales en toda la interfaz y en los
informes.

### ¿Es gratis?

Sí. Es un proyecto de código abierto con licencia [MIT](../LICENSE). Notion tiene un plan gratuito suficiente para una
base de datos de gastos, y Ollama también es gratuito.

### ¿Mis datos salen de mi equipo?

Solo hacia Notion, que es donde ya están. Lunar Finance no tiene servidor propio, no usa analíticas y la IA funciona
en tu equipo con Ollama. Los informes PDF y CSV se generan en local.

### ¿Dónde se guarda el token de Notion?

En el almacén seguro del sistema: el Administrador de credenciales en Windows, o GNOME Keyring o KWallet en Linux.
No se escribe en ningún archivo, y una vez guardado la parte visual de la aplicación ya no puede leerlo.

### ¿Puede Lunar Finance borrar o estropear mis movimientos?

No borra movimientos. Solo escribe cuando tú se lo pides: al crear o editar un movimiento, al aplicar una categoría o al
registrar un pago periódico (solo los que configures como automáticos se registran sin preguntar). Antes de modificar
un movimiento comprueba que las propiedades que va a cambiar siguen como las leyó; si alguien las ha cambiado en
Notion, no escribe y te avisa.

### ¿Hay versión para macOS, Android o iPhone?

No. La aplicación es para Windows y Linux de 64 bits. La configuración para compilar en macOS existe, pero no se ha
compilado ni probado. En el iPhone puedes apuntar gastos con los [atajos](atajos-iphone.md), y Lunar Finance los lee
después.

### ¿Por qué Windows dice que la aplicación es desconocida?

Porque el instalador no está firmado con un certificado de código. Pulsa **Más información → Ejecutar de todas
formas**. Si quieres asegurarte de que el archivo es el original, compara su SHA-256 con `SHA256SUMS.txt` (ver
[instalacion.md](instalacion.md#comprobar-la-descarga-opcional)).

### ¿Funciona sin Internet?

Necesita conexión para leer tus movimientos: no guarda una copia local de ellos. Si la conexión se corta mientras la
usas, sigue mostrando los datos ya leídos con un aviso y la hora de la última lectura. El modo demostración y la IA
local funcionan sin Internet.

### ¿Tengo que usar la IA?

No. Es opcional y está desactivada por defecto. Sin ella, la clasificación usa tus reglas y tus correcciones.

### ¿Qué es el estilo Vintage de los informes?

Un tema alternativo para el PDF, inspirado en los libros de contabilidad impresos: papel marfil, tinta sepia y
títulos a máquina. Muestra las mismas cifras y páginas que el estilo Clásico. Se elige en **Informes → Estilo del
informe**.

### Algo no funciona

Revisa **Ajustes → Diagnóstico** y la tabla de errores de [configuracion-notion.md](configuracion-notion.md#9-errores-frecuentes).
Si sigue fallando, [abre una *issue*](https://github.com/DiegoHA17/lunar-finance/issues) sin incluir tokens, enlaces
a tu Notion ni datos financieros reales.
