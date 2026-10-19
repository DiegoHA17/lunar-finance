# Inteligencia artificial local (Ollama)

Opcional y desactivada por defecto. Lunar funciona igual sin Ollama, sin modelo o con el servicio detenido: en ese
caso solo se usan las reglas y la clasificación manual. Nunca se envían datos a servicios remotos.

## Estados (Ajustes → Inteligencia artificial)

| Estado | Detección | Acción |
| --- | --- | --- |
| No instalado | Sin `ollama.exe` / `ollama app.exe` en `%LOCALAPPDATA%\Programs\Ollama` ni en el `PATH`, y el servicio no responde | **Instalar Ollama**: abre la página oficial `https://ollama.com/download/windows` (instalador por usuario, sin administrador). Después, **Comprobar**. |
| Detenido | Instalado, pero `GET /api/version` no responde | **Iniciar Ollama**: abre la aplicación oficial ya instalada (`ollama app.exe`, sin consola ni argumentos) y espera a que el servicio responda (máx. 20 s). |
| Sin modelo | Servicio en marcha sin modelos de texto adecuados | **Descargar modelo**: muestra modelo, tamaño y espacio libre; pide confirmación. |
| Descargando | `POST /api/pull` en curso | Progreso **real** (bytes que informa Ollama; si aún no hay cifras, actividad sin porcentaje) y **Cancelar**. |
| Cancelado o fallido | — | **Reanudar** (Ollama continúa desde donde se quedó). |
| Disponible | Servicio en marcha y modelo adecuado instalado | Elección de modelo y casilla «Proponer categorías con IA». |
| Error | El servicio responde con error | Mensaje breve y **Reintentar**. |

Lunar no instala ni actualiza Ollama ni los modelos por su cuenta, no borra modelos y no descarga dos veces un
modelo ya instalado (se comprueba `GET /api/tags` antes de cada descarga).

## Elección del modelo

- Se consultan los modelos instalados (`GET /api/tags`) y se descartan los de *embeddings* o sin capacidad
  `completion`. No se asume ningún nombre concreto (`gemma3:latest`, etc.).
- Si hay un modelo adecuado instalado, se usa (preferencia: el elegido por el usuario; si no, un Gemma 3; si no,
  otro adecuado).
- Si no hay ninguno, se propone descargar del catálogo oficial de Gemma 3 (verificado el 2026-10-19):

| Modelo | Descarga | Memoria orientativa | Cuándo se recomienda |
| --- | --- | --- | --- |
| `gemma3:1b` | 806 MB | ≥ 4 GB | Equipos con poca memoria o sin datos del equipo |
| `gemma3:4b` | 3,4 GB | ≥ 8 GB | Opción por defecto si hay memoria y disco |
| `gemma3:12b` | 8,2 GB | ≥ 16 GB (se recomienda solo con ≥ 24 GB) | Equipos sobrados |

La recomendación usa la RAM total y el espacio libre de la carpeta de modelos (`OLLAMA_MODELS` o
`%USERPROFILE%\.ollama\models`) con un 20 % de margen. En el equipo de desarrollo (13,9 GB de RAM, 71 GB libres)
ya estaba instalado `gemma3:4b`, que se reutiliza sin descargar nada.

## Clasificación

1. Las reglas deterministas resuelven primero.
2. En la revisión de pendientes, **Proponer con IA** consulta al modelo solo los movimientos que las reglas no
   resolvieron, uno a uno, con progreso y cancelación.
3. El modelo solo puede elegir una categoría **activa y compatible** de una lista cerrada (salida estructurada con
   esquema JSON y `enum`) o «NINGUNA». La respuesta se valida en Rust y otra vez en la interfaz.
4. Criterio de confianza: se marca automáticamente solo si el modelo declara ≥ 0,85 **y** no contradice tu
   historial (categoría mayoritaria de descripciones con la misma palabra significativa). Si lo contradice, se
   muestra sin marcar con «Tu historial: …». La confianza que declara el modelo no es fiable por sí sola.
5. Nada se escribe hasta pulsar **Aplicar**. El origen queda registrado como `IA` si existe la propiedad de origen.
6. Tras corregir una categoría a mano se puede crear una regla para casos futuros.

Errores: respuesta inválida, categoría inexistente o tiempo agotado (90 s) se informan y el movimiento sigue
pendiente; si Ollama deja de responder, el lote se detiene.

## Organización de categorías (Categorías → Revisar organización)

- **Posibles duplicados**: por nombre (plurales, erratas) y, opcionalmente, sinónimos con IA («Comida» y
  «Alimentación»). Acción disponible: archivar una de ellas (con confirmación; conserva el histórico).
- **No catalogadas**: nombres usados en movimientos que no están en el catálogo. Añadir como alias de una
  existente (la IA puede sugerir cuál) o crear la categoría.
- **Reglas sugeridas**: descripciones repetidas que ya clasificas siempre igual y que ninguna regla cubre
  (≥ 3 movimientos, ≥ 80 % en la misma categoría).

La IA no crea categorías, no fusiona, no archiva y no cambia relaciones de Notion por su cuenta.

## Seguridad

- Solo `http://127.0.0.1:11434` (API local oficial). Sin alternativa remota si Ollama falla.
- Nombres de modelo validados (`[a-z0-9._:/-]`, ≤ 100 caracteres).
- La única ejecución local es abrir `ollama app.exe` de la instalación oficial, a petición del usuario.
- El modelo no ejecuta acciones: solo devuelve una categoría de la lista, que pasa por las mismas validaciones que
  una elección manual.

## Pruebas

- Simuladas (Rust, `mockito`): versión y modelos, servicio detenido, modelo ausente, respuesta válida, «NINGUNA»,
  categoría inventada, JSON inválido, confianza fuera de rango, tiempo agotado, descarga con progreso real, error
  de descarga, descarga interrumpida, cancelación, revisión de duplicados.
- Simuladas (TypeScript): estados, elección y recomendación de modelo, filtrado de modelos, progreso agregado,
  solo pendientes sin regla, categorías inexistentes/archivadas/incompatibles, baja confianza, contradicción con
  el historial, errores sin romper el lote, Ollama caído, cancelación, funcionamiento sin IA, duplicados y reglas
  sugeridas.
- Reales (`cargo test -- --ignored real_ollama`, con Ollama en marcha y el modelo instalado): Ollama 0.40.6 con
  `gemma3:4b` clasificó «Billete tren Renfe Madrid-Toledo» como Transporte y detectó «Alimentación/Comida» como
  duplicado. En la app compilada, «Proponer con IA» generó 11 propuestas en 40 s.
- No probado en este equipo: la instalación de Ollama y la descarga de un modelo reales (requieren tu
  consentimiento y Ollama ya estaba instalado con un modelo adecuado), ni «Iniciar Ollama» (el servicio ya estaba
  en marcha).
