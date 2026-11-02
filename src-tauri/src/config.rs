//! Configuración persistente sin secretos (`config.json` en el directorio de configuración de la aplicación).
//!
//! Define qué fuente de datos de Notion cumple cada rol y cómo se corresponden sus propiedades con los campos
//! lógicos de Lunar. Las propiedades se referencian por ID (estable aunque se renombren en Notion).

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Movements,
    Categories,
}

impl Role {
    pub fn label(self) -> &'static str {
        match self {
            Role::Movements => "Movimientos",
            Role::Categories => "Categorías",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRef {
    /// ID de la propiedad en Notion.
    pub id: String,
    /// Nombre en el momento de configurarla (solo informativo).
    pub name: String,
    /// Tipo de propiedad de Notion al configurarla (`select`, `relation`…). El diagnóstico detecta si cambia.
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfig {
    pub data_source_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Campo lógico → propiedad de Notion.
    #[serde(default)]
    pub fields: BTreeMap<String, FieldRef>,
    /// Correspondencias de valores (p. ej. `expense` → ["Gasto"]). Las interpreta la capa de dominio.
    #[serde(default)]
    pub value_map: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub movements: Option<SourceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<SourceConfig>,
}

impl NotionConfig {
    pub fn source(&self, role: Role) -> Option<&SourceConfig> {
        match role {
            Role::Movements => self.movements.as_ref(),
            Role::Categories => self.categories.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub notion: NotionConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { version: CONFIG_VERSION, notion: NotionConfig::default() }
    }
}

/// Definición de un campo lógico: tipos de propiedad de Notion aceptados y si es obligatorio.
pub struct FieldSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub types: &'static [&'static str],
    pub required: bool,
    /// Si Lunar escribe en este campo (las fórmulas no son escribibles).
    pub writable_types: &'static [&'static str],
}

pub const MOVEMENT_FIELDS: &[FieldSpec] = &[
    FieldSpec { key: "description", label: "Descripción", types: &["title", "rich_text"], required: true, writable_types: &["title", "rich_text"] },
    FieldSpec { key: "date", label: "Fecha", types: &["date", "created_time"], required: true, writable_types: &["date"] },
    FieldSpec { key: "amount", label: "Cantidad", types: &["number", "formula"], required: true, writable_types: &["number"] },
    FieldSpec { key: "kind", label: "Tipo", types: &["select", "status", "rich_text"], required: true, writable_types: &["select", "status", "rich_text"] },
    FieldSpec { key: "category", label: "Categoría", types: &["select", "rich_text", "relation"], required: true, writable_types: &["select", "rich_text", "relation"] },
    FieldSpec { key: "paymentMethod", label: "Método de pago", types: &["select", "rich_text", "multi_select"], required: false, writable_types: &["select", "rich_text"] },
    FieldSpec { key: "origin", label: "Origen de la clasificación", types: &["select", "rich_text"], required: false, writable_types: &["select", "rich_text"] },
    FieldSpec { key: "recurrence", label: "Pago periódico", types: &["rich_text"], required: false, writable_types: &["rich_text"] },
];

pub const CATEGORY_FIELDS: &[FieldSpec] = &[
    FieldSpec { key: "name", label: "Nombre", types: &["title"], required: true, writable_types: &["title"] },
    FieldSpec { key: "kind", label: "Tipo", types: &["select"], required: true, writable_types: &["select"] },
    FieldSpec { key: "status", label: "Estado", types: &["select", "status"], required: true, writable_types: &["select", "status"] },
    FieldSpec { key: "color", label: "Color", types: &["rich_text", "select"], required: false, writable_types: &["rich_text", "select"] },
    FieldSpec { key: "icon", label: "Icono", types: &["rich_text"], required: false, writable_types: &["rich_text"] },
    FieldSpec { key: "description", label: "Descripción", types: &["rich_text"], required: false, writable_types: &["rich_text"] },
    FieldSpec { key: "aliases", label: "Alias", types: &["rich_text"], required: false, writable_types: &["rich_text"] },
];

pub fn field_specs(role: Role) -> &'static [FieldSpec] {
    match role {
        Role::Movements => MOVEMENT_FIELDS,
        Role::Categories => CATEGORY_FIELDS,
    }
}

/// Normaliza un identificador de Notion (con o sin guiones, o dentro de una URL) a 32 caracteres hexadecimales.
pub fn normalize_notion_id(raw: &str) -> Option<String> {
    // En una URL el ID son los 32 últimos hexadecimales del último segmento, antes de `?` o `#`
    // (p. ej. `…/Gastos-0123…cdef?v=…`). Un UUID con guiones es el caso particular sin slug.
    let before_query = raw.trim().split(['?', '#']).next()?;
    let last_segment = before_query.trim_end_matches('/').rsplit('/').next()?;
    let compact: Vec<char> = last_segment.chars().filter(|c| *c != '-').collect();
    if compact.len() < 32 {
        return None;
    }
    let tail = &compact[compact.len() - 32..];
    if !tail.iter().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(tail.iter().collect::<String>().to_ascii_lowercase())
}

/// Compara IDs de Notion ignorando guiones y mayúsculas.
pub fn same_id(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.chars().filter(|c| *c != '-').collect::<String>().to_ascii_lowercase();
    norm(a) == norm(b)
}

impl AppConfig {
    /// Validación estructural (la validación contra el esquema real la hace el diagnóstico).
    pub fn validate(&self) -> AppResult<()> {
        for role in [Role::Movements, Role::Categories] {
            let Some(src) = self.notion.source(role) else { continue };
            if normalize_notion_id(&src.data_source_id).is_none() {
                return Err(AppError::validation(format!("El identificador de la fuente de {} no es válido.", role.label())));
            }
            for key in src.fields.keys() {
                if !field_specs(role).iter().any(|f| f.key == key) {
                    return Err(AppError::validation(format!("Campo desconocido «{key}» en {}.", role.label())));
                }
            }
            let mut seen = std::collections::HashSet::new();
            for (key, f) in &src.fields {
                if f.id.is_empty() {
                    return Err(AppError::validation(format!("El campo «{key}» de {} no tiene propiedad asignada.", role.label())));
                }
                if !seen.insert(f.id.clone()) {
                    return Err(AppError::validation(format!(
                        "La propiedad «{}» está asignada a varios campos de {}.",
                        f.name,
                        role.label()
                    )));
                }
            }
            if src.value_map.values().map(Vec::len).sum::<usize>() > 500 {
                return Err(AppError::validation("Demasiadas correspondencias de valores."));
            }
        }
        Ok(())
    }
}

pub fn config_path(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

pub fn load(dir: &Path) -> AppResult<AppConfig> {
    let path = config_path(dir);
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let cfg: AppConfig = serde_json::from_str(&text).map_err(|e| {
                AppError::io("El archivo de configuración está dañado.", e)
                    .hint(format!("Revisa o elimina {} y vuelve a configurar la conexión.", path.display()))
            })?;
            Ok(cfg)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppConfig::default()),
        Err(e) => Err(AppError::io("No se pudo leer la configuración.", e)),
    }
}

pub fn save(dir: &Path, cfg: &AppConfig) -> AppResult<()> {
    cfg.validate()?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| AppError::internal("No se pudo serializar la configuración.").detail(e.to_string()))?;
    crate::store::write_atomic(&config_path(dir), text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ids_from_urls_and_uuids() {
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(normalize_notion_id(id).as_deref(), Some(id));
        assert_eq!(normalize_notion_id("01234567-89ab-cdef-0123-456789abcdef").as_deref(), Some(id));
        assert_eq!(
            normalize_notion_id("https://www.notion.so/miespacio/Gastos-0123456789ABCDEF0123456789abcdef?v=fedcba9876543210fedcba9876543210").as_deref(),
            Some(id)
        );
        assert_eq!(normalize_notion_id("https://www.notion.so/0123456789abcdef0123456789abcdef").as_deref(), Some(id));
        assert_eq!(normalize_notion_id("no es un id"), None);
        assert_eq!(normalize_notion_id("abc123"), None);
    }

    #[test]
    fn compares_ids_ignoring_dashes() {
        assert!(same_id("01234567-89ab-cdef-0123-456789abcdef", "0123456789ABCDEF0123456789abcdef"));
        assert!(!same_id("01234567-89ab-cdef-0123-456789abcdee", "0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn rejects_duplicated_property_assignments() {
        let mut src = SourceConfig { data_source_id: "0123456789abcdef0123456789abcdef".into(), ..Default::default() };
        src.fields.insert("description".into(), FieldRef { id: "title".into(), name: "Descripción".into(), kind: String::new() });
        src.fields.insert("paymentMethod".into(), FieldRef { id: "title".into(), name: "Descripción".into(), kind: String::new() });
        let cfg = AppConfig { version: 1, notion: NotionConfig { movements: Some(src), categories: None } };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn rejects_unknown_fields() {
        let mut src = SourceConfig { data_source_id: "0123456789abcdef0123456789abcdef".into(), ..Default::default() };
        src.fields.insert("hack".into(), FieldRef { id: "x".into(), name: "x".into(), kind: String::new() });
        let cfg = AppConfig { version: 1, notion: NotionConfig { movements: Some(src), categories: None } };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).unwrap(), AppConfig::default());
        let mut src = SourceConfig { data_source_id: "0123456789abcdef0123456789abcdef".into(), ..Default::default() };
        src.fields.insert("description".into(), FieldRef { id: "title".into(), name: "Descripción".into(), kind: String::new() });
        src.value_map.insert("expense".into(), vec!["Gasto".into()]);
        let cfg = AppConfig { version: 1, notion: NotionConfig { movements: Some(src), categories: None } };
        save(dir.path(), &cfg).unwrap();
        assert_eq!(load(dir.path()).unwrap(), cfg);
    }

    #[test]
    fn reports_corrupted_config() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(config_path(dir.path()), "{ no json").unwrap();
        assert!(load(dir.path()).is_err());
    }
}
