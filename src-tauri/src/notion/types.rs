//! Tipos normalizados que se intercambian con la interfaz. Son genéricos (por tipo de propiedad de Notion);
//! la interpretación de dominio (qué propiedad es el importe, etc.) se hace en TypeScript con el mapeo configurado.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const MAX_TEXT_CHUNK: usize = 2000;
pub const MAX_TEXT_TOTAL: usize = 2000 * 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DateValue {
    pub start: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
}

/// Valor de una propiedad leída de Notion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum PropValue {
    Title(String),
    RichText(String),
    Number(Option<f64>),
    Select(Option<String>),
    Status(Option<String>),
    MultiSelect(Vec<String>),
    Date(Option<DateValue>),
    Relation(Vec<String>),
    Checkbox(bool),
    CreatedTime(String),
    LastEditedTime(String),
    Url(Option<String>),
    /// Tipo que Lunar no interpreta (personas, archivos, rollups…). Se conserva el nombre del tipo.
    Unsupported(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropEntry {
    pub name: String,
    pub value: PropValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub id: String,
    pub url: Option<String>,
    pub created_time: String,
    pub last_edited_time: String,
    /// ID de propiedad → valor.
    pub properties: BTreeMap<String, PropEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaProperty {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// Opciones de select / status / multi_select.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// Para relaciones: fuente de datos de destino.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_data_source_id: Option<String>,
    /// Para fórmulas: tipo del resultado si se conoce.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDto {
    pub id: String,
    pub title: String,
    pub database_id: Option<String>,
    /// Página que contiene la base de datos, si la integración puede verla.
    pub parent_page_id: Option<String>,
    pub url: Option<String>,
    pub properties: Vec<SchemaProperty>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub title: String,
    pub database_id: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub pages: Vec<PageDto>,
    /// Instante de la lectura (RFC 3339, UTC).
    pub fetched_at: String,
    /// `false` si Notion indicó que el resultado está truncado (límite de 10 000 filas).
    pub complete: bool,
    pub incomplete_reason: Option<String>,
    /// Páginas descartadas por estar en la papelera.
    pub skipped_in_trash: usize,
    /// Páginas repetidas entre páginas de resultados (se conservó una).
    pub duplicates_removed: usize,
}

/// Valor a escribir en una propiedad.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum PropWrite {
    Title(String),
    RichText(String),
    Number(Option<f64>),
    Select(Option<String>),
    Status(Option<String>),
    /// Fecha ISO `AAAA-MM-DD`.
    Date(Option<String>),
    Relation(Vec<String>),
    Checkbox(bool),
}

fn rich_text_chunks(text: &str) -> AppResult<Value> {
    if text.chars().count() > MAX_TEXT_TOTAL {
        return Err(AppError::validation("El texto es demasiado largo para Notion."));
    }
    let chars: Vec<char> = text.chars().collect();
    let parts: Vec<Value> = chars
        .chunks(MAX_TEXT_CHUNK)
        .map(|c| json!({ "type": "text", "text": { "content": c.iter().collect::<String>() } }))
        .collect();
    Ok(Value::Array(parts))
}

fn check_option_name(name: &str) -> AppResult<()> {
    if name.contains(',') {
        return Err(AppError::validation(format!("Notion no admite comas en las opciones de selección: «{name}».")));
    }
    if name.trim().is_empty() {
        return Err(AppError::validation("El valor de selección está vacío."));
    }
    if name.chars().count() > 100 {
        return Err(AppError::validation("El valor de selección supera los 100 caracteres."));
    }
    Ok(())
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (s[0..4].parse::<u32>(), s[5..7].parse::<u32>(), s[8..10].parse::<u32>()) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1900..=2200).contains(&y) && d >= 1 && d <= days
}

impl PropWrite {
    pub fn type_name(&self) -> &'static str {
        match self {
            PropWrite::Title(_) => "title",
            PropWrite::RichText(_) => "rich_text",
            PropWrite::Number(_) => "number",
            PropWrite::Select(_) => "select",
            PropWrite::Status(_) => "status",
            PropWrite::Date(_) => "date",
            PropWrite::Relation(_) => "relation",
            PropWrite::Checkbox(_) => "checkbox",
        }
    }

    pub fn to_notion(&self) -> AppResult<Value> {
        Ok(match self {
            PropWrite::Title(t) => json!({ "title": rich_text_chunks(t)? }),
            PropWrite::RichText(t) => json!({ "rich_text": rich_text_chunks(t)? }),
            PropWrite::Number(n) => {
                if let Some(v) = n
                    && !v.is_finite()
                {
                    return Err(AppError::validation("El importe no es un número válido."));
                }
                json!({ "number": n })
            }
            PropWrite::Select(s) => match s {
                Some(name) => {
                    check_option_name(name)?;
                    json!({ "select": { "name": name } })
                }
                None => json!({ "select": null }),
            },
            PropWrite::Status(s) => match s {
                Some(name) => {
                    check_option_name(name)?;
                    json!({ "status": { "name": name } })
                }
                None => json!({ "status": null }),
            },
            PropWrite::Date(d) => match d {
                Some(date) => {
                    if !is_iso_date(date) {
                        return Err(AppError::validation(format!("Fecha no válida: «{date}» (se espera AAAA-MM-DD).")));
                    }
                    json!({ "date": { "start": date } })
                }
                None => json!({ "date": null }),
            },
            PropWrite::Relation(ids) => {
                if ids.len() > 100 {
                    return Err(AppError::validation("Notion admite como máximo 100 relaciones por propiedad."));
                }
                let mut items = Vec::new();
                for id in ids {
                    let norm = crate::config::normalize_notion_id(id)
                        .ok_or_else(|| AppError::validation(format!("ID de relación no válido: «{id}».")))?;
                    items.push(json!({ "id": norm }));
                }
                json!({ "relation": items })
            }
            PropWrite::Checkbox(b) => json!({ "checkbox": b }),
        })
    }
}

/// Definición de una propiedad nueva (solo se usan altas no destructivas).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PropertySpec {
    Title,
    RichText,
    Number,
    Date,
    Select { options: Vec<String> },
    Relation { data_source_id: String },
}

impl PropertySpec {
    pub fn to_notion(&self) -> AppResult<Value> {
        Ok(match self {
            PropertySpec::Title => json!({ "title": {} }),
            PropertySpec::RichText => json!({ "rich_text": {} }),
            PropertySpec::Number => json!({ "number": { "format": "number" } }),
            PropertySpec::Date => json!({ "date": {} }),
            PropertySpec::Select { options } => {
                for o in options {
                    check_option_name(o)?;
                }
                json!({ "select": { "options": options.iter().map(|o| json!({ "name": o })).collect::<Vec<_>>() } })
            }
            PropertySpec::Relation { data_source_id } => {
                let id = crate::config::normalize_notion_id(data_source_id)
                    .ok_or_else(|| AppError::validation("ID de fuente de datos no válido para la relación."))?;
                json!({ "relation": { "data_source_id": id, "type": "single_property", "single_property": {} } })
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_prop_values_with_type_tags() {
        let v = PropValue::Number(Some(12.5));
        assert_eq!(serde_json::to_value(&v).unwrap(), json!({ "type": "number", "value": 12.5 }));
        let back: PropWrite = serde_json::from_value(json!({ "type": "select", "value": "Ocio" })).unwrap();
        assert_eq!(back, PropWrite::Select(Some("Ocio".into())));
    }

    #[test]
    fn builds_notion_payloads() {
        assert_eq!(PropWrite::Number(Some(3.5)).to_notion().unwrap(), json!({ "number": 3.5 }));
        assert_eq!(PropWrite::Select(None).to_notion().unwrap(), json!({ "select": null }));
        assert_eq!(PropWrite::Date(Some("2026-02-28".into())).to_notion().unwrap(), json!({ "date": { "start": "2026-02-28" } }));
        let rel = PropWrite::Relation(vec!["01234567-89ab-cdef-0123-456789abcdef".into()]).to_notion().unwrap();
        assert_eq!(rel, json!({ "relation": [{ "id": "0123456789abcdef0123456789abcdef" }] }));
    }

    #[test]
    fn splits_long_text_in_2000_char_chunks() {
        let text = "á".repeat(4500);
        let v = PropWrite::RichText(text).to_notion().unwrap();
        let parts = v["rich_text"].as_array().unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0]["text"]["content"].as_str().unwrap().chars().count(), 2000);
    }

    #[test]
    fn rejects_invalid_values() {
        assert!(PropWrite::Date(Some("2026-02-30".into())).to_notion().is_err());
        assert!(PropWrite::Date(Some("30/01/2026".into())).to_notion().is_err());
        assert!(PropWrite::Select(Some("a,b".into())).to_notion().is_err());
        assert!(PropWrite::Number(Some(f64::NAN)).to_notion().is_err());
        assert!(PropWrite::Relation(vec!["nope".into()]).to_notion().is_err());
        assert!(PropWrite::Date(Some("2024-02-29".into())).to_notion().is_ok());
        assert!(PropWrite::Date(Some("2023-02-29".into())).to_notion().is_err());
    }
}
