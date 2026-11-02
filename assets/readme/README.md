# Recursos visuales del README

Todas las imágenes del README principal están en esta carpeta. Para cambiar la estética basta con sustituir estos
archivos o editar sus colores, sin tocar el texto del README.

| Archivo | Uso en el README | Origen |
| --- | --- | --- |
| `descargas/*.svg` | Botones de descarga de la cabecera | SVG propios, editables a mano (colores de la aplicación) |
| `inicio-claro.png`, `inicio-oscuro.png` | Captura principal; GitHub muestra una u otra según tu tema | Pantalla Inicio, modo demostración, 1440 × 900 |
| `movimientos.png`, `categorias.png`, `pagos-periodicos.png`, `informes.png` | Galería de capturas | Modo demostración, tema oscuro, 1440 × 900 |
| `pdf-clasico.png`, `pdf-vintage.png` | Comparativa de estilos del informe | Primera página del PDF de octubre exportado desde la aplicación (demostración) |
| `portada-video.png` | Portada del vídeo de presentación | `Portada_LinkedIn.png` del paquete de lanzamiento V9, sin modificar |

El logotipo de la cabecera es `assets/brand/lunar-logo-1024.png` (ver [marca e iconos](../../docs/marca-e-iconos.md)).

## Paleta

Son los colores de la aplicación (`src/index.css`):

| Uso | Claro | Oscuro |
| --- | --- | --- |
| Azul noche (botones) | `#1f2e4a` | `#0e1421` (fondo) |
| Acento | `#46698a` | `#9db8d4` |
| Positivo / salvia | `#2f6b57` | `#7cc2a3` |
| Verde salvia de la flecha de descarga | `#b9cf9f` | — |

## Cómo se generaron las capturas

1. `npm run dev`. Sin la capa nativa, la interfaz arranca en modo demostración.
2. Ventana de 1440 × 900 y periodo **octubre de 2026**.
3. Para **Pagos periódicos**, añade la propiedad de demostración y crea cuatro reglas ficticias: Alquiler, Spotify,
   Gimnasio y Seguro del coche.
4. Los PDF se exportan desde **Informes → Exportar PDF** en cada estilo, y se rasteriza la primera página.
5. Las imágenes se optimizan a 256 colores, sin metadatos.

No uses nunca datos reales en las capturas.
