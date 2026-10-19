//! Comandos IPC: la única superficie que la interfaz puede invocar.
//!
//! No hay comandos genéricos de «petición a Notion»: las operaciones de lectura y escritura se hacen sobre un rol
//! configurado (`movements` o `categories`) y el token nunca sale de este proceso.

use crate::config::{self, AppConfig, Role};
use crate::credentials::{self, SecretStore};
use crate::error::{AppError, AppResult};
use crate::notion::client::NotionClient;
use crate::notion::diagnose::{self, DiagnosticReport};
use crate::notion::service;
use crate::notion::types::*;
use crate::store;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub secrets: Box<dyn SecretStore>,
    pub http: reqwest::Client,
    pub base_url: String,
    pub data_dir: PathBuf,
    /// Serializa las escrituras de configuración y documentos locales.
    pub write_lock: Mutex<()>,
}

impl AppState {
    fn client(&self) -> AppResult<NotionClient> {
        let token = credentials::require_token(self.secrets.as_ref())?;
        Ok(NotionClient::new(self.http.clone(), &self.base_url, token))
    }

    fn config(&self) -> AppResult<AppConfig> {
        config::load(&self.data_dir)
    }

    fn source(&self, role: Role) -> AppResult<config::SourceConfig> {
        self.config()?.notion.source(role).cloned().ok_or_else(|| {
            AppError::config(format!("No hay ninguna base de datos de {} configurada.", role.label()))
                .hint("Configúrala en Ajustes → Conexión con Notion.")
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub configured: bool,
}

#[tauri::command]
pub fn credentials_status(state: State<'_, AppState>) -> AppResult<CredentialStatus> {
    Ok(CredentialStatus { configured: state.secrets.get()?.is_some() })
}

#[tauri::command]
pub fn credentials_set(state: State<'_, AppState>, token: String) -> AppResult<CredentialStatus> {
    let clean = credentials::validate_token_format(&token)?;
    state.secrets.set(&clean)?;
    log::info!("Token de Notion guardado en el Administrador de credenciales.");
    Ok(CredentialStatus { configured: true })
}

#[tauri::command]
pub fn credentials_clear(state: State<'_, AppState>) -> AppResult<CredentialStatus> {
    state.secrets.delete()?;
    log::info!("Token de Notion eliminado.");
    Ok(CredentialStatus { configured: false })
}

#[tauri::command]
pub fn config_get(state: State<'_, AppState>) -> AppResult<AppConfig> {
    state.config()
}

#[tauri::command]
pub fn config_set(state: State<'_, AppState>, config: AppConfig) -> AppResult<AppConfig> {
    let _guard = state.write_lock.lock().map_err(|_| AppError::internal("Bloqueo de configuración envenenado."))?;
    let mut cfg = config;
    cfg.version = config::CONFIG_VERSION;
    for src in [cfg.notion.movements.as_mut(), cfg.notion.categories.as_mut()].into_iter().flatten() {
        src.data_source_id = config::normalize_notion_id(&src.data_source_id)
            .ok_or_else(|| AppError::validation("El identificador de la fuente de datos no es válido."))?;
    }
    config::save(&state.data_dir, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub async fn notion_diagnose(state: State<'_, AppState>) -> AppResult<DiagnosticReport> {
    let cfg = state.config()?;
    let token = credentials::require_token(state.secrets.as_ref());
    let http = state.http.clone();
    let base = state.base_url.clone();
    Ok(diagnose::run(token, move |t| NotionClient::new(http.clone(), &base, t), &cfg).await)
}

#[tauri::command]
pub async fn notion_list_sources(state: State<'_, AppState>) -> AppResult<Vec<SourceSummary>> {
    service::list_sources(&state.client()?).await
}

#[tauri::command]
pub async fn notion_resolve_source(state: State<'_, AppState>, input: String) -> AppResult<Vec<SourceSummary>> {
    service::resolve_sources(&state.client()?, &input).await
}

#[tauri::command]
pub async fn notion_get_schema(state: State<'_, AppState>, data_source_id: String) -> AppResult<SchemaDto> {
    service::retrieve_schema(&state.client()?, &data_source_id).await
}

#[tauri::command]
pub async fn notion_query(state: State<'_, AppState>, role: Role) -> AppResult<QueryResult> {
    let src = state.source(role)?;
    let client = state.client()?;
    let result = service::query_all(&client, &src.data_source_id).await?;
    log::info!("{}: {} páginas leídas", role.label(), result.pages.len());
    Ok(result)
}

#[tauri::command]
pub async fn notion_create_page(state: State<'_, AppState>, role: Role, properties: BTreeMap<String, PropWrite>) -> AppResult<PageDto> {
    let src = state.source(role)?;
    service::create_page(&state.client()?, &src.data_source_id, &properties).await
}

#[tauri::command]
pub async fn notion_update_page(
    state: State<'_, AppState>,
    role: Role,
    page_id: String,
    expected: BTreeMap<String, PropValue>,
    properties: BTreeMap<String, PropWrite>,
) -> AppResult<PageDto> {
    let src = state.source(role)?;
    service::update_page_checked(&state.client()?, &src.data_source_id, src.database_id.as_deref(), &page_id, &expected, &properties).await
}

#[tauri::command]
pub async fn notion_add_properties(state: State<'_, AppState>, role: Role, specs: BTreeMap<String, PropertySpec>) -> AppResult<SchemaDto> {
    let src = state.source(role)?;
    service::add_properties(&state.client()?, &src.data_source_id, &specs).await
}

#[tauri::command]
pub async fn notion_create_categories_database(state: State<'_, AppState>, parent_page_id: String, title: String) -> AppResult<SchemaDto> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 100 {
        return Err(AppError::validation("El título de la base de datos no es válido."));
    }
    service::create_categories_database(&state.client()?, &parent_page_id, title).await
}

#[tauri::command]
pub fn store_read(state: State<'_, AppState>, name: String) -> AppResult<Option<serde_json::Value>> {
    store::read(&state.data_dir, &name)
}

#[tauri::command]
pub fn store_write(state: State<'_, AppState>, name: String, value: serde_json::Value) -> AppResult<()> {
    let _guard = state.write_lock.lock().map_err(|_| AppError::internal("Bloqueo de escritura envenenado."))?;
    store::write(&state.data_dir, &name, &value)
}

#[tauri::command]
pub async fn export_save(app: tauri::AppHandle, suggested_name: String, format: String, bytes: Vec<u8>) -> AppResult<Option<String>> {
    crate::export::save_with_dialog(&app, &suggested_name, &format, &bytes)
}

#[tauri::command]
pub fn open_notion_url(app: tauri::AppHandle, url: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let allowed = ["https://www.notion.so/", "https://notion.so/", "https://app.notion.com/", "https://www.notion.com/"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err(AppError::validation("Solo se pueden abrir enlaces de Notion."));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::internal("No se pudo abrir el navegador.").detail(e.to_string()))
}
