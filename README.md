# Lunar

Aplicación de escritorio para Windows que organiza tus finanzas personales a partir de tu base de datos de
Notion: clasifica los gastos con reglas propias, muestra estadísticas por periodo y genera informes en PDF y CSV.

- **Notion es la única fuente de datos.** Lunar no tiene servidor ni base de datos propia: lee y escribe en tu
  base de datos de gastos (la que alimenta el atajo «Gasto» del iPhone).
- **El token no sale del sistema.** Se guarda en el Administrador de credenciales de Windows y solo lo usa la capa
  nativa (Rust). La interfaz nunca lo ve.
- **Las cifras son exactas.** Importes en céntimos enteros; el panel, los informes, el PDF y el CSV usan las mismas
  fórmulas.

Documentación técnica: [ARCHITECTURE.md](ARCHITECTURE.md) · [Integración con Notion](docs/notion.md) ·
[Modelo de datos](docs/modelo-de-datos.md) · [Categorías y reglas](docs/clasificacion.md) ·
[Pruebas y empaquetado](docs/pruebas-y-empaquetado.md) · [Marca e iconos](docs/marca-e-iconos.md) · [Roadmap](ROADMAP.md) · [Cambios](CHANGELOG.md)

## Instalar (usuario)

1. Ejecuta `Lunar_0.1.0_x64-setup.exe` (en `src-tauri/target/release/bundle/nsis/` tras compilar).
   Se instala para tu usuario, sin permisos de administrador.
2. Abre Lunar. Puedes **explorar con datos de demostración** (claramente marcados) o **conectar con Notion**.

Requisito: Windows 10/11 con WebView2 (incluido en Windows 11; el instalador lo descarga si falta).

## Conectar con Notion

1. **Crea una integración interna** en <https://www.notion.so/profile/integrations> (por ejemplo, «Lunar») en el
   espacio de trabajo donde está tu base de datos de gastos.
2. En **Capacidades**, activa «Leer contenido», «Actualizar contenido» e «Insertar contenido».
3. Copia el **Internal Integration Secret** (empieza por `ntn_`).
4. **Comparte la base de datos con la integración**: abre la base de datos en Notion → menú `···` (arriba a la
   derecha) → **Conexiones** → busca la integración y confirma.
   > Sin este paso Notion responde `404 object_not_found` aunque el token sea correcto. Es la causa del error que
   > se produjo con la integración «Atajo iPhone».
5. En Lunar: **Ajustes → Conexión con Notion** → pega el secreto → **Guardar token**.
6. **Ajustes → Base de datos de movimientos** → «Ver bases de datos compartidas» (o pega el enlace de la base de
   datos) → revisa la asignación de propiedades (Lunar la propone sola) y qué significa cada valor de «Tipo» →
   **Guardar y leer datos**.
7. **Ajustes → Diagnóstico** comprueba paso a paso token, permisos, identificador, esquema y lectura.
8. Opcional: **Categorías → Crear catálogo en Notion** crea la base de datos «Categorías» (comparte antes con la
   integración la página donde quieras crearla).

## Uso diario

| Pantalla | Para qué |
| --- | --- |
| Inicio | Gasto neto, ingresos, balance y movimientos del periodo; evolución; gasto por categoría; últimos movimientos. La luna junto al título indica cuánto ha transcurrido del periodo. |
| Movimientos | Buscar y filtrar, corregir categorías (y crear una regla a partir de la corrección), editar, crear y exportar a CSV. «Clasificar N sin categoría» revisa las propuestas de tus reglas antes de aplicarlas. |
| Categorías | Catálogo con importes por periodo: crear, editar, alias, archivar y reactivar. |
| Reglas | Reglas deterministas con prioridad, condiciones y excepciones; muestra conflictos e impacto. |
| Informes | Semana, mes, trimestre, año o intervalo personalizado; resumen ejecutivo o detallado; PDF y CSV. |
| Ajustes | Token, base de datos, mapeo, diagnóstico, mejoras opcionales del esquema, tema y modo demostración. |

## Desarrollo

Requisitos: Node.js 22+, Rust estable (MSVC) y Visual Studio 2022 con «Desarrollo para el escritorio con C++».

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run dev` abre solo la interfaz en el navegador (http://localhost:1420), siempre en modo demostración: sin
la capa nativa no hay acceso a Notion ni al token.

| Comando | Qué hace |
| --- | --- |
| `npm test` | Pruebas de TypeScript (dominio, servicios, PDF, CSV) |
| `npm run typecheck` | Comprobación de tipos (modo estricto) |
| `npm run lint` | Análisis estático (oxlint) |
| `npm run check` | Todo lo anterior + `cargo test` |
| `npm run tauri build` | Aplicación de release + instalador NSIS |

Más detalle en [docs/pruebas-y-empaquetado.md](docs/pruebas-y-empaquetado.md).

## Dónde se guarda cada cosa

| Dato | Lugar |
| --- | --- |
| Movimientos y categorías | Solo en tu Notion |
| Token de la integración | Administrador de credenciales de Windows (`com.lunar.finance` / `notion-token`) |
| Configuración (IDs y mapeo, sin secretos) | `%APPDATA%\com.lunar.finance\config.json` |
| Reglas de clasificación | `%APPDATA%\com.lunar.finance\rules.json` (copia anterior en `rules.json.bak`) |
| Preferencias (tema, periodo) | `%APPDATA%\com.lunar.finance\preferences.json` |
| Registro de la aplicación | `%LOCALAPPDATA%\com.lunar.finance\logs` (sin token ni datos financieros) |

## Resolución de problemas

| Mensaje | Causa y solución |
| --- | --- |
| «Notion no encuentra el recurso o no está compartido con la integración» (404) | La base de datos no está compartida con la integración, o el enlace es de una vista enlazada. Compártela (paso 4) y vuelve a elegirla. |
| «Notion ha rechazado el token» (401) | Token mal copiado o revocado. Copia de nuevo el secreto y guárdalo. |
| «La integración no tiene permiso» (403) | Faltan capacidades de la integración (paso 2). |
| «La propiedad … ya no existe» / «es de tipo …» | Se ha renombrado o cambiado una propiedad. Ajustes → Base de datos de movimientos → revisar el mapeo. |
| «El movimiento ha cambiado en Notion desde la última actualización» | Alguien (o el atajo) lo editó a la vez. Actualiza y repite el cambio: Lunar nunca sobrescribe a ciegas. |
| «Se ha alcanzado el límite de peticiones de Notion» | Notion permite ~3 peticiones por segundo. Lunar reintenta solo; si persiste, espera un minuto. |
| «No se pudo conectar con Notion» | Sin Internet. Los datos mostrados no se han modificado. |
| Movimientos «fuera de los totales» | Les falta fecha o importe, o su «Tipo» no está asignado (Ajustes → valores de «Tipo»). |
| «No se pudo guardar el archivo» | El PDF/CSV está abierto en otro programa o la carpeta no permite escribir. |
