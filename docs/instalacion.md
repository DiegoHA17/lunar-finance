# Instalar Lunar Finance

Las descargas están en **[GitHub Releases](https://github.com/DiegoHA17/lunar-finance/releases/latest)**. Todos los
paquetes son para equipos de 64 bits x86 (Intel o AMD). Por ahora no hay versión para ARM ni para macOS.

| Sistema | Archivo de la versión 0.3.0 | Estado de las pruebas |
| --- | --- | --- |
| Windows 10 (22H2) y 11 | [`Lunar-Finance_0.3.0_x64-setup.exe`](https://github.com/DiegoHA17/lunar-finance/releases/download/v0.3.0/Lunar-Finance_0.3.0_x64-setup.exe) | Instalador comprobado; aplicación abierta en Windows 11 |
| Ubuntu 22.04+ y Debian 12+ | [`Lunar-Finance_0.3.0_amd64.deb`](https://github.com/DiegoHA17/lunar-finance/releases/download/v0.3.0/Lunar-Finance_0.3.0_amd64.deb) | Instalado y abierto en Ubuntu 22.04 (WSL 2) |
| Linux portable (AppImage) | [`Lunar-Finance_0.3.0_amd64.AppImage`](https://github.com/DiegoHA17/lunar-finance/releases/download/v0.3.0/Lunar-Finance_0.3.0_amd64.AppImage) | Abierto en Ubuntu 22.04 (WSL 2) |
| Fedora y openSUSE | [`Lunar-Finance-0.3.0-1.x86_64.rpm`](https://github.com/DiegoHA17/lunar-finance/releases/download/v0.3.0/Lunar-Finance-0.3.0-1.x86_64.rpm) | Paquete revisado (`rpm -K`, metadatos); **sin instalar en Fedora ni openSUSE** |

En Linux, las pruebas se hicieron en WSL 2, no en un escritorio Linux real.

## Windows

1. Descarga `Lunar-Finance_0.3.0_x64-setup.exe` y ábrelo.
2. El instalador no está firmado, así que Windows SmartScreen puede avisar de que es una aplicación desconocida.
   Pulsa **Más información → Ejecutar de todas formas**.
3. Se instala solo para tu usuario y no pide permisos de administrador. Si falta WebView2 (Windows 10), el instalador
   lo descarga.
4. Abre **Lunar Finance** desde el menú Inicio.

Para desinstalarlo: **Configuración → Aplicaciones → Lunar Finance → Desinstalar**.

## Ubuntu y Debian (`.deb`)

```bash
sudo apt install ./Lunar-Finance_0.3.0_amd64.deb
```

`apt` instala también las dependencias (WebKitGTK 4.1, GTK 3, OpenSSL 3 y D-Bus). Para desinstalarlo:

```bash
sudo apt remove lunar-finance
```

## AppImage (cualquier distribución)

```bash
chmod +x Lunar-Finance_0.3.0_amd64.AppImage
./Lunar-Finance_0.3.0_amd64.AppImage
```

Si no arranca, suele faltar FUSE 2: instala `libfuse2` (en Ubuntu 24.04 se llama `libfuse2t64`).

## Fedora y openSUSE (`.rpm`)

```bash
sudo dnf install ./Lunar-Finance-0.3.0-1.x86_64.rpm
```

En openSUSE, usa `sudo zypper install ./Lunar-Finance-0.3.0-1.x86_64.rpm`. Este paquete no se ha probado en esas
distribuciones; si falla, [abre una *issue*](https://github.com/DiegoHA17/lunar-finance/issues) con el mensaje de
error.

## Requisito en Linux: un llavero

El token de Notion se guarda en Secret Service: **GNOME Keyring** o **KWallet**. Los escritorios GNOME y KDE ya lo
incluyen. Sin llavero, Lunar Finance funciona en modo demostración, pero no puede guardar el token.

## Comprobar la descarga (opcional)

Cada versión incluye `SHA256SUMS.txt`, con el SHA-256 de cada archivo tal como se llama en la descarga. Para comprobar que el archivo no se ha dañado ni alterado:

- **Windows** (PowerShell):

  ```powershell
  Get-FileHash .\Lunar-Finance_0.3.0_x64-setup.exe -Algorithm SHA256
  ```

  Compara el resultado con la línea correspondiente de `SHA256SUMS.txt`.
- **Linux**, en la carpeta de la descarga:

  ```bash
  sha256sum -c SHA256SUMS.txt --ignore-missing
  ```

## Dónde guarda Lunar Finance sus datos

Los movimientos y categorías están **solo en tu Notion**. En el equipo se guardan la configuración (sin el token),
las reglas, los pagos periódicos y las preferencias:

| Sistema | Carpeta |
| --- | --- |
| Windows | `%APPDATA%\com.lunar.finance\` (registros en `%LOCALAPPDATA%\com.lunar.finance\logs`) |
| Linux | `~/.config/com.lunar.finance/` |

Al desinstalar, esta carpeta y el token se conservan. Si quieres borrarlos, elimina la carpeta y, desde **Ajustes →
Conexión con Notion → Eliminar token**, el token antes de desinstalar.

## Siguiente paso

[Conectar Lunar Finance con Notion](configuracion-notion.md). Si quieres probar la aplicación sin conectar nada, elige
**Ver demostración** en la primera pantalla.
