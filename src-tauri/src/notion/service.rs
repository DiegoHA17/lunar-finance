//! Operaciones de alto nivel sobre Notion. Todas reciben el ID de la fuente de datos del rol configurado y
//! verifican que las páginas que tocan le pertenecen.

use super::client::NotionClient;
use super::normalize::{page_parent_ids, parse_page, parse_prop, parse_schema, parse_source_summary};
use super::types::*;
use crate::config::{normalize_notion_id, same_id};
use crate::error::{AppError, AppResult, ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

pub const PAGE_SIZE: u32 = 100;
/// Tope de seguridad: 10 000 resultados (límite de Notion) / 100 por página.
const MAX_PAGES: usize = 101;

fn now_rfc3339() -> String {
    // Sin dependencias de fechas: segundos UNIX → RFC 3339 en UTC.
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Algoritmo civil_from_days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

fn require_id(raw: &str, what: &str) -> AppResult<String> {
    normalize_notion_id(raw).ok_or_else(|| AppError::validation(format!("El identificador de {what} no es válido.")))
}

pub async fn retrieve_schema(client: &NotionClient, data_source_id: &str) -> AppResult<SchemaDto> {
    let id = require_id(data_source_id, "la fuente de datos")?;
    let v = client.get(&format!("/v1/data_sources/{id}")).await?;
    parse_schema(&v)
}

/// Resuelve lo que el usuario haya pegado (URL o ID de base de datos o de fuente de datos) a fuentes de datos.
pub async fn resolve_sources(client: &NotionClient, raw: &str) -> AppResult<Vec<SourceSummary>> {
    let id = require_id(raw, "la base de datos")?;
    match client.get(&format!("/v1/data_sources/{id}")).await {
        Ok(ds) => return Ok(parse_source_summary(&ds).into_iter().collect()),
        Err(e) if e.code == ErrorCode::NotFound => {}
        Err(e) => return Err(e),
    }
    // No es una fuente de datos accesible: probar como base de datos (contenedor de fuentes).
    let db = client.get(&format!("/v1/databases/{id}")).await.map_err(|e| {
        if e.code == ErrorCode::NotFound {
            AppError::new(ErrorCode::NotFound, "La integración no puede ver esa base de datos.")
                .hint("Abre la base de datos en Notion → «···» → Conexiones → añade tu integración y vuelve a intentarlo. Si ya está añadida, comprueba que el enlace es de la base de datos (no de una vista enlazada).")
                .detail(e.detail.unwrap_or_default())
        } else {
            e
        }
    })?;
    let mut out = Vec::new();
    for ds in db.get("data_sources").and_then(Value::as_array).cloned().unwrap_or_default() {
        if let Some(ds_id) = ds.get("id").and_then(Value::as_str) {
            out.push(SourceSummary {
                id: ds_id.to_string(),
                title: ds.get("name").and_then(Value::as_str).unwrap_or("(sin título)").to_string(),
                database_id: Some(id.clone()),
                url: db.get("url").and_then(Value::as_str).map(str::to_string),
            });
        }
    }
    if out.is_empty() {
        return Err(AppError::new(ErrorCode::Schema, "La base de datos no contiene fuentes de datos accesibles."));
    }
    Ok(out)
}

/// Fuentes de datos compartidas con la integración.
pub async fn list_sources(client: &NotionClient) -> AppResult<Vec<SourceSummary>> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..20 {
        let mut body = json!({ "filter": { "property": "object", "value": "data_source" }, "page_size": PAGE_SIZE });
        if let Some(c) = &cursor {
            body["start_cursor"] = json!(c);
        }
        let v = client.post_read("/v1/search", &body).await?;
        for r in v.get("results").and_then(Value::as_array).cloned().unwrap_or_default() {
            if let Some(s) = parse_source_summary(&r) {
                out.push(s);
            }
        }
        if v.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
        cursor = v.get("next_cursor").and_then(Value::as_str).map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// Lee todas las páginas de una fuente de datos, paginando y deduplicando por ID.
pub async fn query_all(client: &NotionClient, data_source_id: &str) -> AppResult<QueryResult> {
    let id = require_id(data_source_id, "la fuente de datos")?;
    let mut pages = Vec::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    let mut complete = true;
    let mut incomplete_reason = None;
    let mut skipped_in_trash = 0;
    let mut duplicates_removed = 0;

    for iteration in 0.. {
        if iteration >= MAX_PAGES {
            return Err(AppError::new(ErrorCode::Server, "La paginación de Notion no terminó (demasiadas páginas de resultados)."));
        }
        let mut body = json!({
            "page_size": PAGE_SIZE,
            "sorts": [{ "timestamp": "created_time", "direction": "ascending" }]
        });
        if let Some(c) = &cursor {
            body["start_cursor"] = json!(c);
        }
        let v = client.post_read(&format!("/v1/data_sources/{id}/query"), &body).await?;
        let results = v.get("results").and_then(Value::as_array).ok_or_else(|| {
            AppError::new(ErrorCode::Server, "Notion devolvió una respuesta de consulta sin resultados.").detail("Falta el campo «results».")
        })?;
        for r in results {
            if r.get("object").and_then(Value::as_str) != Some("page") {
                continue;
            }
            match parse_page(r)? {
                None => skipped_in_trash += 1,
                Some(p) => {
                    if seen.insert(p.id.clone()) {
                        pages.push(p);
                    } else {
                        duplicates_removed += 1;
                    }
                }
            }
        }
        if let Some(status) = v.get("request_status")
            && status.get("type").and_then(Value::as_str) == Some("incomplete")
        {
            complete = false;
            incomplete_reason = status.get("incomplete_reason").and_then(Value::as_str).map(str::to_string);
        }
        let has_more = v.get("has_more").and_then(Value::as_bool).unwrap_or(false);
        if !has_more {
            break;
        }
        let next = v.get("next_cursor").and_then(Value::as_str).map(str::to_string);
        match next {
            None => {
                return Err(AppError::new(ErrorCode::Server, "Error de paginación: Notion indicó más resultados sin cursor."));
            }
            Some(c) => {
                if !cursors.insert(c.clone()) {
                    return Err(AppError::new(ErrorCode::Server, "Error de paginación: Notion repitió un cursor."));
                }
                cursor = Some(c);
            }
        }
    }
    Ok(QueryResult { pages, fetched_at: now_rfc3339(), complete, incomplete_reason, skipped_in_trash, duplicates_removed })
}

fn properties_payload(writes: &BTreeMap<String, PropWrite>) -> AppResult<Value> {
    if writes.is_empty() {
        return Err(AppError::validation("No hay cambios que guardar."));
    }
    let mut props = serde_json::Map::new();
    for (prop_id, w) in writes {
        props.insert(prop_id.clone(), w.to_notion()?);
    }
    Ok(Value::Object(props))
}

/// Comprueba que los tipos que se van a escribir coinciden con el esquema real.
fn check_write_types(schema: &SchemaDto, writes: &BTreeMap<String, PropWrite>) -> AppResult<()> {
    for (prop_id, w) in writes {
        let Some(p) = schema.properties.iter().find(|p| &p.id == prop_id) else {
            return Err(AppError::new(ErrorCode::Schema, format!("La propiedad «{prop_id}» ya no existe en «{}».", schema.title))
                .hint("Ejecuta el diagnóstico en Ajustes y revisa el mapeo de propiedades."));
        };
        if p.kind != w.type_name() {
            return Err(AppError::new(
                ErrorCode::Schema,
                format!("La propiedad «{}» es de tipo «{}», no «{}».", p.name, p.kind, w.type_name()),
            )
            .hint("Ejecuta el diagnóstico en Ajustes y revisa el mapeo de propiedades."));
        }
    }
    Ok(())
}

pub async fn create_page(client: &NotionClient, data_source_id: &str, writes: &BTreeMap<String, PropWrite>) -> AppResult<PageDto> {
    let id = require_id(data_source_id, "la fuente de datos")?;
    let schema = retrieve_schema(client, &id).await?;
    check_write_types(&schema, writes)?;
    let body = json!({
        "parent": { "type": "data_source_id", "data_source_id": id },
        "properties": properties_payload(writes)?
    });
    let v = client.post_write("/v1/pages", &body).await?;
    parse_page(&v)?.ok_or_else(|| AppError::internal("Notion creó la página en la papelera."))
}

/// Actualiza una página comprobando antes:
/// 1. que pertenece a la fuente de datos del rol;
/// 2. que no está en la papelera;
/// 3. que las propiedades que se van a cambiar siguen teniendo el valor que la interfaz vio (`expected`).
pub async fn update_page_checked(
    client: &NotionClient,
    data_source_id: &str,
    database_id: Option<&str>,
    page_id: &str,
    expected: &BTreeMap<String, PropValue>,
    writes: &BTreeMap<String, PropWrite>,
) -> AppResult<PageDto> {
    let ds_id = require_id(data_source_id, "la fuente de datos")?;
    let pid = require_id(page_id, "la página")?;
    let current = client.get(&format!("/v1/pages/{pid}")).await?;

    let (parent_ds, parent_db) = page_parent_ids(&current);
    let belongs = match (&parent_ds, &parent_db) {
        (Some(ds), _) => same_id(ds, &ds_id),
        (None, Some(db)) => database_id.map(|d| same_id(db, d)).unwrap_or(false),
        _ => false,
    };
    if !belongs {
        return Err(AppError::validation("La página no pertenece a la fuente de datos configurada; no se ha modificado."));
    }
    let Some(page) = parse_page(&current)? else {
        return Err(AppError::new(ErrorCode::Conflict, "La página está en la papelera de Notion; no se ha modificado.")
            .hint("Actualiza los datos para ver el estado actual."));
    };
    for (prop_id, expected_value) in expected {
        let actual = page
            .properties
            .get(prop_id)
            .map(|e| &e.value)
            .ok_or_else(|| AppError::new(ErrorCode::Schema, format!("La propiedad «{prop_id}» no existe en la página.")))?;
        if !values_equivalent(actual, expected_value) {
            return Err(AppError::new(ErrorCode::Conflict, "El movimiento ha cambiado en Notion desde la última actualización; no se ha sobrescrito.")
                .hint("Actualiza los datos, revisa el cambio y vuelve a intentarlo.")
                .detail(format!("Propiedad {prop_id}: esperado {expected_value:?}, actual {actual:?}")));
        }
    }
    let schema = retrieve_schema(client, &ds_id).await?;
    check_write_types(&schema, writes)?;
    let body = json!({ "properties": properties_payload(writes)? });
    let v = client.patch(&format!("/v1/pages/{pid}"), &body).await?;
    parse_page(&v)?.ok_or_else(|| AppError::internal("La página quedó en la papelera tras actualizarla."))
}

/// Igualdad tolerante: los números se comparan con tolerancia de coma flotante y los IDs de relación sin guiones.
fn values_equivalent(a: &PropValue, b: &PropValue) -> bool {
    match (a, b) {
        (PropValue::Number(Some(x)), PropValue::Number(Some(y))) => (x - y).abs() < 1e-9,
        (PropValue::Relation(x), PropValue::Relation(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(p, q)| same_id(p, q))
        }
        _ => a == b,
    }
}

/// Añade propiedades nuevas a una fuente de datos. Nunca modifica ni elimina las existentes.
pub async fn add_properties(client: &NotionClient, data_source_id: &str, specs: &BTreeMap<String, PropertySpec>) -> AppResult<SchemaDto> {
    let id = require_id(data_source_id, "la fuente de datos")?;
    if specs.is_empty() {
        return Err(AppError::validation("No hay propiedades que añadir."));
    }
    let schema = retrieve_schema(client, &id).await?;
    let mut props = serde_json::Map::new();
    for (name, spec) in specs {
        let clean = name.trim();
        if clean.is_empty() {
            return Err(AppError::validation("El nombre de la propiedad está vacío."));
        }
        if matches!(spec, PropertySpec::Title) {
            return Err(AppError::validation("No se puede añadir otra propiedad de título."));
        }
        if schema.properties.iter().any(|p| p.name.eq_ignore_ascii_case(clean)) {
            return Err(AppError::validation(format!("Ya existe una propiedad llamada «{clean}»; no se ha modificado nada.")));
        }
        props.insert(clean.to_string(), spec.to_notion()?);
    }
    let v = client.patch(&format!("/v1/data_sources/{id}"), &json!({ "properties": props })).await?;
    parse_schema(&v)
}

/// Esquema de la base de datos «Categorías» que crea Lunar.
pub fn categories_schema_payload() -> Value {
    json!({
        "Nombre": { "title": {} },
        "Tipo": { "select": { "options": [ { "name": "Gasto", "color": "red" }, { "name": "Ingreso", "color": "green" } ] } },
        "Estado": { "select": { "options": [ { "name": "Activa", "color": "blue" }, { "name": "Archivada", "color": "gray" } ] } },
        "Color": { "rich_text": {} },
        "Icono": { "rich_text": {} },
        "Descripción": { "rich_text": {} },
        "Alias": { "rich_text": {} }
    })
}

/// Crea la base de datos de categorías dentro de una página compartida con la integración.
pub async fn create_categories_database(client: &NotionClient, parent_page_id: &str, title: &str) -> AppResult<SchemaDto> {
    let parent = require_id(parent_page_id, "la página contenedora")?;
    let body = json!({
        "parent": { "type": "page_id", "page_id": parent },
        "title": [{ "type": "text", "text": { "content": title } }],
        "icon": { "type": "emoji", "emoji": "🌙" },
        "initial_data_source": { "properties": categories_schema_payload() }
    });
    let db = client.post_write("/v1/databases", &body).await.map_err(|e| match e.code {
        ErrorCode::NotFound | ErrorCode::Forbidden => AppError::new(e.code, "La integración no puede crear contenido en esa página.")
            .hint("Comparte con la integración la página donde quieres crear «Categorías» (página → «···» → Conexiones) y comprueba que tiene la capacidad «Insertar contenido».")
            .detail(e.detail.unwrap_or_default()),
        _ => e,
    })?;
    let ds_id = db
        .get("data_sources")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|d| d.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new(ErrorCode::Schema, "Notion creó la base de datos pero no devolvió su fuente de datos."))?
        .to_string();
    retrieve_schema(client, &ds_id).await
}

/// Lee una página suelta de la fuente indicada (para reconciliar tras un error).
#[allow(dead_code)]
pub async fn retrieve_page(client: &NotionClient, page_id: &str) -> AppResult<Option<PageDto>> {
    let pid = require_id(page_id, "la página")?;
    let v = client.get(&format!("/v1/pages/{pid}")).await?;
    parse_page(&v)
}

/// Valor actual de una propiedad en una respuesta cruda (usado en pruebas).
#[allow(dead_code)]
pub fn raw_prop_value(page: &Value, name: &str) -> Option<PropValue> {
    page.get("properties")?.get(name).map(parse_prop)
}

#[cfg(test)]
mod tests {
    use super::super::client::{NotionClient, RetryPolicy, build_http};
    use super::super::normalize::fixtures::*;
    use super::*;
    use mockito::{Matcher, Server};
    use std::time::Duration;

    const DS: &str = "0123456789abcdef0123456789abcdef";

    fn client(server: &Server) -> NotionClient {
        NotionClient::new(build_http(), &server.url(), "ntn_testtoken1234567890".into()).with_policy(RetryPolicy {
            max_retries: 2,
            base_delay: Duration::from_millis(1),
            max_wait: Duration::from_secs(1),
        })
    }

    fn schema_for(ds: &str) -> Value {
        let mut s = movements_schema();
        s["id"] = json!(ds);
        s
    }

    fn page_in(ds: &str, id: &str, desc: &str, amount: f64, category: Option<&str>) -> Value {
        let mut p = movement_page(id, desc, Some(amount), category);
        p["parent"] = json!({ "type": "data_source_id", "data_source_id": ds, "database_id": "db" });
        p
    }

    #[tokio::test]
    async fn paginates_and_deduplicates() {
        let mut server = Server::new_async().await;
        let path = format!("/v1/data_sources/{DS}/query");
        let p1 = json!({ "object": "list", "results": [page_in(DS, "a", "A", 1.0, None), page_in(DS, "b", "B", 2.0, None)],
            "has_more": true, "next_cursor": "c2" });
        let p2 = json!({ "object": "list", "results": [page_in(DS, "b", "B", 2.0, None), page_in(DS, "c", "C", 3.0, None)],
            "has_more": false, "next_cursor": null });
        let m2 = server
            .mock("POST", path.as_str())
            .match_body(Matcher::PartialJson(json!({ "start_cursor": "c2" })))
            .with_body(p2.to_string())
            .create_async()
            .await;
        let m1 = server.mock("POST", path.as_str()).with_body(p1.to_string()).create_async().await;
        let r = query_all(&client(&server), DS).await.unwrap();
        assert_eq!(r.pages.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c"]);
        assert_eq!(r.duplicates_removed, 1);
        assert!(r.complete);
        m1.assert_async().await;
        m2.assert_async().await;
    }

    #[tokio::test]
    async fn empty_database_is_an_empty_list_not_an_error() {
        let mut server = Server::new_async().await;
        let path = format!("/v1/data_sources/{DS}/query");
        let _m = server.mock("POST", path.as_str()).with_body(r#"{"object":"list","results":[],"has_more":false,"next_cursor":null}"#).create_async().await;
        let r = query_all(&client(&server), DS).await.unwrap();
        assert!(r.pages.is_empty());
    }

    #[tokio::test]
    async fn query_errors_are_not_converted_to_empty_lists() {
        let mut server = Server::new_async().await;
        let path = format!("/v1/data_sources/{DS}/query");
        let _m = server
            .mock("POST", path.as_str())
            .with_status(404)
            .with_body(r#"{"code":"object_not_found","message":"Could not find data source"}"#)
            .create_async()
            .await;
        let err = query_all(&client(&server), DS).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[tokio::test]
    async fn detects_broken_pagination() {
        let mut server = Server::new_async().await;
        let path = format!("/v1/data_sources/{DS}/query");
        let _m = server
            .mock("POST", path.as_str())
            .with_body(json!({ "results": [], "has_more": true, "next_cursor": "same" }).to_string())
            .create_async()
            .await;
        let err = query_all(&client(&server), DS).await.unwrap_err();
        assert!(err.message.contains("paginación"));

        let mut server = Server::new_async().await;
        let _m = server
            .mock("POST", path.as_str())
            .with_body(json!({ "results": [], "has_more": true, "next_cursor": null }).to_string())
            .create_async()
            .await;
        assert!(query_all(&client(&server), DS).await.is_err());
    }

    #[tokio::test]
    async fn flags_incomplete_results() {
        let mut server = Server::new_async().await;
        let path = format!("/v1/data_sources/{DS}/query");
        let _m = server
            .mock("POST", path.as_str())
            .with_body(json!({ "results": [page_in(DS, "a", "A", 1.0, None)], "has_more": false, "next_cursor": null,
                "request_status": { "type": "incomplete", "incomplete_reason": "query_result_limit_reached" } }).to_string())
            .create_async()
            .await;
        let r = query_all(&client(&server), DS).await.unwrap();
        assert!(!r.complete);
        assert_eq!(r.incomplete_reason.as_deref(), Some("query_result_limit_reached"));
    }

    #[tokio::test]
    async fn update_checks_ownership_conflicts_and_types() {
        let mut server = Server::new_async().await;
        let pid = "fedcba9876543210fedcba9876543210";
        let page_path = format!("/v1/pages/{pid}");
        let ds_path = format!("/v1/data_sources/{DS}");
        let _get = server.mock("GET", page_path.as_str()).with_body(page_in(DS, pid, "Mercadona", 10.0, None).to_string()).create_async().await;
        let _schema = server.mock("GET", ds_path.as_str()).with_body(schema_for(DS).to_string()).create_async().await;
        let patch = server
            .mock("PATCH", page_path.as_str())
            .match_body(Matcher::PartialJson(json!({ "properties": { "c%3At": { "select": { "name": "Alimentación" } } } })))
            .with_body(page_in(DS, pid, "Mercadona", 10.0, Some("Alimentación")).to_string())
            .expect(1)
            .create_async()
            .await;
        let c = client(&server);

        let mut expected = BTreeMap::new();
        expected.insert("c%3At".to_string(), PropValue::Select(None));
        let mut writes = BTreeMap::new();
        writes.insert("c%3At".to_string(), PropWrite::Select(Some("Alimentación".into())));
        let updated = update_page_checked(&c, DS, None, pid, &expected, &writes).await.unwrap();
        assert_eq!(updated.properties["c%3At"].value, PropValue::Select(Some("Alimentación".into())));
        patch.assert_async().await;

        // Conflicto: la interfaz cree que tenía «Ocio» pero en Notion está vacía.
        let mut stale = BTreeMap::new();
        stale.insert("c%3At".to_string(), PropValue::Select(Some("Ocio".into())));
        let err = update_page_checked(&c, DS, None, pid, &stale, &writes).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Conflict);

        // Tipo incorrecto: escribir texto en una propiedad select.
        let mut bad = BTreeMap::new();
        bad.insert("c%3At".to_string(), PropWrite::RichText("x".into()));
        let err = update_page_checked(&c, DS, None, pid, &BTreeMap::new(), &bad).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Schema);

        // Otra fuente de datos: se rechaza.
        let other = "11111111111111111111111111111111";
        let err = update_page_checked(&c, other, None, pid, &BTreeMap::new(), &writes).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
    }

    #[tokio::test]
    async fn add_properties_never_overwrites_existing_ones() {
        let mut server = Server::new_async().await;
        let ds_path = format!("/v1/data_sources/{DS}");
        let _schema = server.mock("GET", ds_path.as_str()).with_body(schema_for(DS).to_string()).create_async().await;
        let patch = server.mock("PATCH", ds_path.as_str()).expect(0).create_async().await;
        let mut specs = BTreeMap::new();
        specs.insert("categoría".to_string(), PropertySpec::RichText);
        let err = add_properties(&client(&server), DS, &specs).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
        patch.assert_async().await;
    }

    #[tokio::test]
    async fn resolves_database_ids_to_data_sources() {
        let mut server = Server::new_async().await;
        let db = "abcdefabcdefabcdefabcdefabcdefab";
        let _ds404 = server
            .mock("GET", format!("/v1/data_sources/{db}").as_str())
            .with_status(404)
            .with_body(r#"{"code":"object_not_found","message":"nope"}"#)
            .create_async()
            .await;
        let _db = server
            .mock("GET", format!("/v1/databases/{db}").as_str())
            .with_body(json!({ "object": "database", "id": db, "data_sources": [{ "id": DS, "name": "Gastos" }] }).to_string())
            .create_async()
            .await;
        let r = resolve_sources(&client(&server), &format!("https://www.notion.so/ws/Gastos-{db}?v=1")).await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].id, DS);
        assert_eq!(r[0].title, "Gastos");
    }

    #[tokio::test]
    async fn unshared_database_explains_how_to_share_it() {
        let mut server = Server::new_async().await;
        let db = "abcdefabcdefabcdefabcdefabcdefab";
        for path in [format!("/v1/data_sources/{db}"), format!("/v1/databases/{db}")] {
            server
                .mock("GET", path.as_str())
                .with_status(404)
                .with_body(r#"{"code":"object_not_found","message":"Could not find database with ID. Make sure the relevant pages and databases are shared with your integration."}"#)
                .create_async()
                .await;
        }
        let err = resolve_sources(&client(&server), db).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(err.hint.unwrap().contains("Conexiones"));
    }

    #[test]
    fn rfc3339_timestamp_has_expected_shape() {
        let t = now_rfc3339();
        assert_eq!(t.len(), 20);
        assert!(t.ends_with('Z'));
        assert!(t.starts_with("20"));
    }
}
