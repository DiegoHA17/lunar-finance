//! Conversión de los objetos JSON de Notion (versión 2026-03-11) a los tipos normalizados.

use super::types::*;
use crate::error::{AppError, AppResult, ErrorCode};
use serde_json::Value;
use std::collections::BTreeMap;

fn plain_text(arr: &Value) -> String {
    arr.as_array()
        .map(|items| items.iter().filter_map(|t| t.get("plain_text").and_then(Value::as_str)).collect::<String>())
        .unwrap_or_default()
}

fn option_name(v: &Value) -> Option<String> {
    v.get("name").and_then(Value::as_str).map(str::to_string)
}

fn parse_date(v: &Value) -> Option<DateValue> {
    let start = v.get("start")?.as_str()?.to_string();
    let end = v.get("end").and_then(Value::as_str).map(str::to_string);
    Some(DateValue { start, end })
}

pub fn parse_prop(prop: &Value) -> PropValue {
    let kind = prop.get("type").and_then(Value::as_str).unwrap_or("");
    let inner = prop.get(kind).unwrap_or(&Value::Null);
    match kind {
        "title" => PropValue::Title(plain_text(inner)),
        "rich_text" => PropValue::RichText(plain_text(inner)),
        "number" => PropValue::Number(inner.as_f64()),
        "select" => PropValue::Select(option_name(inner)),
        "status" => PropValue::Status(option_name(inner)),
        "multi_select" => PropValue::MultiSelect(inner.as_array().map(|a| a.iter().filter_map(option_name).collect()).unwrap_or_default()),
        "date" => PropValue::Date(if inner.is_null() { None } else { parse_date(inner) }),
        "relation" => PropValue::Relation(
            inner
                .as_array()
                .map(|a| a.iter().filter_map(|r| r.get("id").and_then(Value::as_str).map(str::to_string)).collect())
                .unwrap_or_default(),
        ),
        "checkbox" => PropValue::Checkbox(inner.as_bool().unwrap_or(false)),
        "created_time" => PropValue::CreatedTime(inner.as_str().unwrap_or_default().to_string()),
        "last_edited_time" => PropValue::LastEditedTime(inner.as_str().unwrap_or_default().to_string()),
        "url" | "email" | "phone_number" => PropValue::Url(inner.as_str().map(str::to_string)),
        "formula" => {
            let ftype = inner.get("type").and_then(Value::as_str).unwrap_or("");
            let fval = inner.get(ftype).unwrap_or(&Value::Null);
            match ftype {
                "number" => PropValue::Number(fval.as_f64()),
                "string" => PropValue::RichText(fval.as_str().unwrap_or_default().to_string()),
                "date" => PropValue::Date(if fval.is_null() { None } else { parse_date(fval) }),
                "boolean" => PropValue::Checkbox(fval.as_bool().unwrap_or(false)),
                other => PropValue::Unsupported(format!("formula:{other}")),
            }
        }
        other => PropValue::Unsupported(other.to_string()),
    }
}

fn is_in_trash(page: &Value) -> bool {
    ["in_trash", "archived", "is_archived"].iter().any(|k| page.get(*k).and_then(Value::as_bool).unwrap_or(false))
}

/// Devuelve `None` si la página está en la papelera.
pub fn parse_page(page: &Value) -> AppResult<Option<PageDto>> {
    if is_in_trash(page) {
        return Ok(None);
    }
    let id = page
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new(ErrorCode::Schema, "Notion devolvió una página sin identificador."))?
        .to_string();
    let mut properties = BTreeMap::new();
    if let Some(props) = page.get("properties").and_then(Value::as_object) {
        for (name, prop) in props {
            let pid = prop.get("id").and_then(Value::as_str).unwrap_or(name).to_string();
            properties.insert(pid, PropEntry { name: name.clone(), value: parse_prop(prop) });
        }
    }
    Ok(Some(PageDto {
        id,
        url: page.get("url").and_then(Value::as_str).map(str::to_string),
        created_time: page.get("created_time").and_then(Value::as_str).unwrap_or_default().to_string(),
        last_edited_time: page.get("last_edited_time").and_then(Value::as_str).unwrap_or_default().to_string(),
        properties,
    }))
}

/// ID de la fuente de datos (o, en su defecto, de la base de datos) a la que pertenece una página.
pub fn page_parent_ids(page: &Value) -> (Option<String>, Option<String>) {
    let parent = page.get("parent").unwrap_or(&Value::Null);
    let ds = parent.get("data_source_id").and_then(Value::as_str).map(str::to_string);
    let db = parent.get("database_id").and_then(Value::as_str).map(str::to_string);
    (ds, db)
}

pub fn parse_schema(ds: &Value) -> AppResult<SchemaDto> {
    if ds.get("object").and_then(Value::as_str) != Some("data_source") {
        return Err(AppError::new(ErrorCode::Schema, "La respuesta de Notion no es una fuente de datos."));
    }
    let id = ds.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let mut properties = Vec::new();
    if let Some(props) = ds.get("properties").and_then(Value::as_object) {
        for (name, p) in props {
            let kind = p.get("type").and_then(Value::as_str).unwrap_or("").to_string();
            let inner = p.get(&kind).unwrap_or(&Value::Null);
            let options = match kind.as_str() {
                "select" | "status" | "multi_select" => inner
                    .get("options")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(option_name).collect())
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let relation_data_source_id =
                if kind == "relation" { inner.get("data_source_id").and_then(Value::as_str).map(str::to_string) } else { None };
            properties.push(SchemaProperty {
                id: p.get("id").and_then(Value::as_str).unwrap_or(name).to_string(),
                name: name.clone(),
                kind,
                options,
                relation_data_source_id,
                formula_type: None,
            });
        }
    }
    properties.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let parent = ds.get("parent").unwrap_or(&Value::Null);
    let db_parent = ds.get("database_parent").unwrap_or(&Value::Null);
    Ok(SchemaDto {
        id,
        title: plain_text(ds.get("title").unwrap_or(&Value::Null)),
        database_id: parent.get("database_id").and_then(Value::as_str).map(str::to_string),
        parent_page_id: db_parent.get("page_id").and_then(Value::as_str).map(str::to_string),
        url: ds.get("url").and_then(Value::as_str).map(str::to_string),
        properties,
    })
}

pub fn parse_source_summary(ds: &Value) -> Option<SourceSummary> {
    if ds.get("object").and_then(Value::as_str) != Some("data_source") || is_in_trash(ds) {
        return None;
    }
    Some(SourceSummary {
        id: ds.get("id")?.as_str()?.to_string(),
        title: {
            let t = plain_text(ds.get("title").unwrap_or(&Value::Null));
            if t.is_empty() { "(sin título)".to_string() } else { t }
        },
        database_id: ds.get("parent").and_then(|p| p.get("database_id")).and_then(Value::as_str).map(str::to_string),
        url: ds.get("url").and_then(Value::as_str).map(str::to_string),
    })
}

#[cfg(test)]
pub mod fixtures {
    use serde_json::{Value, json};

    pub fn rt(text: &str) -> Value {
        json!([{ "type": "text", "text": { "content": text }, "plain_text": text }])
    }

    /// Página de movimiento con las propiedades del atajo «Gasto».
    pub fn movement_page(id: &str, desc: &str, amount: Option<f64>, category: Option<&str>) -> Value {
        json!({
            "object": "page",
            "id": id,
            "created_time": "2026-10-01T10:00:00.000Z",
            "last_edited_time": "2026-10-01T10:05:00.000Z",
            "in_trash": false,
            "url": format!("https://www.notion.so/{id}"),
            "parent": { "type": "data_source_id", "data_source_id": "ds-mov", "database_id": "db-mov" },
            "properties": {
                "Descripción": { "id": "title", "type": "title", "title": rt(desc) },
                "Fecha": { "id": "f%3Ae", "type": "date", "date": { "start": "2026-10-01", "end": null, "time_zone": null } },
                "Categoría": { "id": "c%3At", "type": "select", "select": category.map(|c| json!({ "id": "x", "name": c, "color": "blue" })) },
                "Tipo": { "id": "t%3Ap", "type": "select", "select": { "id": "y", "name": "Gasto", "color": "red" } },
                "Cantidad": { "id": "q%3Aa", "type": "number", "number": amount },
                "Método de Pago": { "id": "m%3Ap", "type": "select", "select": { "id": "z", "name": "Tarjeta", "color": "gray" } }
            }
        })
    }

    pub fn movements_schema() -> Value {
        json!({
            "object": "data_source",
            "id": "ds-mov",
            "title": rt("Gastos"),
            "parent": { "type": "database_id", "database_id": "db-mov" },
            "database_parent": { "type": "page_id", "page_id": "page-parent" },
            "properties": {
                "Descripción": { "id": "title", "name": "Descripción", "type": "title", "title": {} },
                "Fecha": { "id": "f%3Ae", "name": "Fecha", "type": "date", "date": {} },
                "Categoría": { "id": "c%3At", "name": "Categoría", "type": "select", "select": { "options": [
                    { "id": "1", "name": "Ocio", "color": "blue" }, { "id": "2", "name": "Alimentación", "color": "green" } ] } },
                "Tipo": { "id": "t%3Ap", "name": "Tipo", "type": "select", "select": { "options": [
                    { "id": "3", "name": "Gasto", "color": "red" }, { "id": "4", "name": "Ingreso", "color": "green" } ] } },
                "Cantidad": { "id": "q%3Aa", "name": "Cantidad", "type": "number", "number": { "format": "euro" } },
                "Método de Pago": { "id": "m%3Ap", "name": "Método de Pago", "type": "select", "select": { "options": [] } }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_movement_page_keyed_by_property_id() {
        let page = parse_page(&movement_page("p1", "Mercadona", Some(23.45), Some("Alimentación"))).unwrap().unwrap();
        assert_eq!(page.id, "p1");
        assert_eq!(page.properties["title"].value, PropValue::Title("Mercadona".into()));
        assert_eq!(page.properties["title"].name, "Descripción");
        assert_eq!(page.properties["q%3Aa"].value, PropValue::Number(Some(23.45)));
        assert_eq!(page.properties["c%3At"].value, PropValue::Select(Some("Alimentación".into())));
        assert_eq!(
            page.properties["f%3Ae"].value,
            PropValue::Date(Some(DateValue { start: "2026-10-01".into(), end: None }))
        );
    }

    #[test]
    fn empty_values_are_absent_not_invented() {
        let page = parse_page(&movement_page("p2", "", None, None)).unwrap().unwrap();
        assert_eq!(page.properties["q%3Aa"].value, PropValue::Number(None));
        assert_eq!(page.properties["c%3At"].value, PropValue::Select(None));
        assert_eq!(page.properties["title"].value, PropValue::Title(String::new()));
    }

    #[test]
    fn skips_pages_in_trash() {
        let mut p = movement_page("p3", "x", Some(1.0), None);
        p["in_trash"] = json!(true);
        assert!(parse_page(&p).unwrap().is_none());
        let mut p = movement_page("p4", "x", Some(1.0), None);
        p.as_object_mut().unwrap().remove("in_trash");
        p["archived"] = json!(true);
        assert!(parse_page(&p).unwrap().is_none());
    }

    #[test]
    fn parses_formulas_relations_and_unsupported() {
        assert_eq!(parse_prop(&json!({ "type": "formula", "formula": { "type": "number", "number": -4.2 } })), PropValue::Number(Some(-4.2)));
        assert_eq!(parse_prop(&json!({ "type": "relation", "relation": [{ "id": "a" }, { "id": "b" }], "has_more": false })),
            PropValue::Relation(vec!["a".into(), "b".into()]));
        assert_eq!(parse_prop(&json!({ "type": "people", "people": [] })), PropValue::Unsupported("people".into()));
        assert_eq!(parse_prop(&json!({ "type": "multi_select", "multi_select": [{ "name": "A" }] })), PropValue::MultiSelect(vec!["A".into()]));
    }

    #[test]
    fn parses_schema_with_options_and_parents() {
        let s = parse_schema(&movements_schema()).unwrap();
        assert_eq!(s.title, "Gastos");
        assert_eq!(s.database_id.as_deref(), Some("db-mov"));
        assert_eq!(s.parent_page_id.as_deref(), Some("page-parent"));
        let cat = s.properties.iter().find(|p| p.name == "Categoría").unwrap();
        assert_eq!(cat.kind, "select");
        assert_eq!(cat.options, vec!["Ocio", "Alimentación"]);
        assert!(parse_schema(&json!({ "object": "database" })).is_err());
    }
}
