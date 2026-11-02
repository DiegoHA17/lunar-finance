# Seguridad

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/DiegoHA17/lunar-finance/releases/latest) recibe
correcciones.

## Cómo informar de una vulnerabilidad

No abras una *issue* pública. Usa el aviso privado de GitHub: pestaña **Security → Report a vulnerability** de este
repositorio. Incluye los pasos para reproducirla, la versión afectada y el sistema operativo.

**No incluyas nunca un token de Notion real, enlaces a tus bases de datos ni datos financieros.** Si hace falta un
ejemplo, usa datos ficticios.

## Cómo protege Lunar Finance tus datos

- **Sin servidor propio.** Los movimientos y categorías viven en tu Notion. Lunar Finance no envía datos a ningún
  otro servicio.
- **Token en el almacén seguro del sistema.** Se guarda en el Administrador de credenciales de Windows, o en Secret
  Service (GNOME Keyring o KWallet) en Linux. Solo lo usa la capa nativa en Rust: una vez guardado, la interfaz no puede
  leerlo, y se oculta en los errores y registros.
- **Archivos locales sin secretos.** La configuración, las reglas, los pagos periódicos y las preferencias se guardan
  en la carpeta de la aplicación (`com.lunar.finance`) con IDs y nombres de propiedades, nunca con el token.
- **IA solo local.** La IA opcional usa Ollama en `127.0.0.1`. No hay alternativa remota.
- **Interfaz aislada.** CSP estricta, sin acceso de la interfaz al sistema de archivos ni a la red.
- **Escrituras prudentes.** Antes de modificar un movimiento comprueba que las propiedades que va a cambiar
  siguen como las leyó; si no, no escribe. Nunca borra movimientos.

## Atajos de iPhone

Un atajo que llama a la API de Notion lleva el token **dentro del propio archivo**: cualquiera que reciba el atajo
puede leerlo. Por eso este repositorio no publica los archivos `.shortcut` originales. Consulta las recomendaciones
de [docs/atajos-iphone.md](docs/atajos-iphone.md#seguridad).

## Si has expuesto un token

1. Abre <https://www.notion.so/profile/integrations>, elige la integración y **regenera el secreto**. El anterior deja
   de funcionar.
2. Guarda el nuevo en Lunar Finance (Ajustes → Conexión con Notion) y en los atajos que lo usen.
3. Borrar el token del último commit no basta si ya estaba en el historial de Git o en una captura publicada: hay que
   regenerarlo siempre.
