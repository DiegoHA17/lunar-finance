# Licencias y créditos

Lunar Finance reúne material con condiciones distintas. La licencia MIT cubre el código propio; **no** se extiende
automáticamente al resto.

| Material | Autor | Condiciones |
| --- | --- | --- |
| Código fuente de Lunar Finance (`src/`, `src-tauri/`, `scripts/`) y documentación | Diego Herrera Ayuso | [MIT](../LICENSE) |
| Dependencias de terceros (npm y Rust) | Sus autores | Su propia licencia (ver abajo) |
| Fuente IBM Plex Sans (incluida en la aplicación) | IBM | SIL Open Font License 1.1 |
| Iconos de la interfaz (`lucide-react`) | Lucide Contributors | ISC |
| Logotipo, icono y nombre «Lunar Finance» | Proyecto Lunar Finance (aportado por Diego Herrera Ayuso) | Identidad del proyecto: no forman parte de la licencia MIT (ver abajo) |
| Vídeo de presentación | Diego Herrera Ayuso | Se publica para mostrar el proyecto; no está bajo MIT |
| Música del vídeo: 'To Nights', de Infraction | Infraction (InAudio) | Atribución obligatoria; condiciones de InAudio |
| Herramienta de grabación: Recordly v1.4.0 | webadderall | AGPL-3.0 (solo la herramienta) |
| Documentación de los atajos de iPhone y JSON de ejemplo | Diego Herrera Ayuso | MIT, como el resto de la documentación |

## Dependencias de terceros

Revisado el 2026-11-02 a partir de `package-lock.json` y `cargo metadata`:

- **npm (incluidas en la aplicación):** React, React DOM, pdf-lib, pako, lucide-react, `@tauri-apps/*` e IBM Plex Sans.
  Licencias MIT, ISC, 0BSD, MIT/Apache-2.0, MIT + Zlib (pako) y OFL-1.1 (la fuente).
- **Rust:** la gran mayoría MIT o Apache-2.0 (a elegir). También aparecen BSD-3-Clause, Zlib, ISC, Unicode-3.0
  (datos de ICU4X) y MPL-2.0 (`cssparser`, `selectors`, `dtoa-short`, `option-ext`, `colored`).

Todas son compatibles con publicar el código propio bajo MIT. La MPL-2.0 es copyleft **por archivo**: solo obliga a
compartir los cambios en esos archivos. Lunar Finance no los modifica.

Las dependencias conservan su licencia. Quien redistribuya los instaladores debe respetar sus avisos de copyright.
Los instaladores actuales no incluyen todavía un archivo con esos avisos (ver «Pendiente» en
[distribucion.md](distribucion.md)).

## Logotipo y nombre

El logotipo (`assets/brand/`, `src/assets/brand/`, `src-tauri/icons/`, `public/favicon.png`) y el nombre «Lunar
Finance» identifican este proyecto. Puedes usarlos para referirte a él o enlazarlo. Si publicas una versión
modificada, usa otro nombre y otro icono para que nadie la confunda con la original.

## Vídeo de presentación

- Grabado y montado principalmente con **[Recordly v1.4.0](https://github.com/webadderallorg/Recordly/releases/tag/v1.4.0)**,
  de webadderall. Recordly es software libre bajo AGPL-3.0. Esa licencia se aplica a la herramienta, no a los vídeos
  que se graban con ella.
- **Música:** 'To Nights', de Infraction. InAudio la ofrece con licencia CC BY 3.0, con atribución obligatoria y
  enlace en la descripción. **No es de dominio público**, y la licencia MIT del código no se aplica a la música.

Atribución exigida por InAudio, que debe acompañar al vídeo allí donde se publique:

> Music from #InAudio: https://inaudio.org/
>
> Música: 'To Nights' por Infraction (https://inaudio.org/track/to-nights-pop/)
