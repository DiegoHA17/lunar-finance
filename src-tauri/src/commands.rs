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
    /// Dirección del servicio local de Ollama (siempre 127.0.0.1).
    pub ollama_url: String,
    /// Señal para cancelar la descarga de modelo en curso.
    pub ai_pull: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    /// Cerrojo entre procesos del registro de pagos periódicos (mientras está abierto, otros procesos esperan).
    pub run_lock: Mutex<Option<std::fs::File>>,
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

/// Intenta obtener el cerrojo de pagos periódicos. `false` si otra instancia de Lunar lo tiene.
#[tauri::command]
pub fn run_lock_acquire(state: State<'_, AppState>) -> AppResult<bool> {
    let mut held = state.run_lock.lock().map_err(|_| AppError::internal("Bloqueo envenenado."))?;
    if held.is_some() {
        return Ok(true);
    }
    *held = store::try_lock_run(&state.data_dir)?;
    Ok(held.is_some())
}

#[tauri::command]
pub fn run_lock_release(state: State<'_, AppState>) -> AppResult<()> {
    let mut held = state.run_lock.lock().map_err(|_| AppError::internal("Bloqueo envenenado."))?;
    *held = None;
    Ok(())
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

// ── Inteligencia artificial local (Ollama) ───────────────────────────────────────────────────────────────────

use crate::ai::{self, AiStatus, ollama::{ClassifyInput, ClassifySuggestion, DuplicatePair, MatchCategoryInput, OllamaClient, PullEvent}};
use tauri::ipc::Channel;

fn ollama(state: &AppState) -> OllamaClient {
    OllamaClient::new(&state.ollama_url)
}

#[tauri::command]
pub async fn ai_status(state: State<'_, AppState>) -> AppResult<AiStatus> {
    Ok(ai::status(&ollama(&state), &ai::system::current_installation()).await)
}

/// Abre la aplicación oficial de Ollama ya instalada y espera a que el servicio responda (máx. ~20 s).
#[tauri::command]
pub async fn ai_start(state: State<'_, AppState>) -> AppResult<AiStatus> {
    let inst = ai::system::current_installation();
    let app = inst.app.clone().ok_or_else(|| AppError::validation("Ollama no está instalado."))?;
    let client = ollama(&state);
    if client.version().await.is_err() {
        ai::system::start_app(&app)?;
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if client.version().await.is_ok() {
                break;
            }
        }
    }
    Ok(ai::status(&client, &inst).await)
}

/// Descarga un modelo con progreso real. `true` si terminó, `false` si se canceló. Si ya está instalado, no se
/// vuelve a descargar.
#[tauri::command]
pub async fn ai_pull(state: State<'_, AppState>, model: String, on_event: Channel<PullEvent>) -> AppResult<bool> {
    ai::validate_model_name(&model)?;
    let client = ollama(&state);
    if client.tags().await?.iter().any(|m| m.name == model) {
        let _ = on_event.send(PullEvent::Done);
        return Ok(true);
    }
    let rx = {
        let mut slot = state.ai_pull.lock().map_err(|_| AppError::internal("Bloqueo de descarga envenenado."))?;
        if slot.is_some() {
            return Err(AppError::validation("Ya hay una descarga en curso."));
        }
        let (tx, rx) = tokio::sync::watch::channel(false);
        *slot = Some(tx);
        rx
    };
    let result = client.pull(&model, |e| { let _ = on_event.send(e); }, &rx).await;
    if let Ok(mut slot) = state.ai_pull.lock() {
        *slot = None;
    }
    log::info!("Descarga de modelo terminada: {:?}", result.as_ref().map(|d| if *d { "completa" } else { "cancelada" }));
    result
}

#[tauri::command]
pub fn ai_cancel_pull(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(tx) = state.ai_pull.lock().map_err(|_| AppError::internal("Bloqueo de descarga envenenado."))?.as_ref() {
        let _ = tx.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_classify(state: State<'_, AppState>, model: String, input: ClassifyInput) -> AppResult<ClassifySuggestion> {
    ai::validate_model_name(&model)?;
    if input.categories.len() > 200 {
        return Err(AppError::validation("Demasiadas categorías."));
    }
    ollama(&state).classify(&model, &input).await
}

#[tauri::command]
pub async fn ai_match_category(state: State<'_, AppState>, model: String, input: MatchCategoryInput) -> AppResult<ClassifySuggestion> {
    ai::validate_model_name(&model)?;
    if input.categories.len() > 200 {
        return Err(AppError::validation("Demasiadas categorías."));
    }
    ollama(&state).match_category(&model, &input).await
}

#[tauri::command]
pub async fn ai_review_duplicates(state: State<'_, AppState>, model: String, names: Vec<String>) -> AppResult<Vec<DuplicatePair>> {
    ai::validate_model_name(&model)?;
    if names.len() > 200 {
        return Err(AppError::validation("Demasiadas categorías."));
    }
    ollama(&state).review_duplicates(&model, &names).await
}

/// Página oficial de descarga de Ollama para el sistema actual (en Windows, instalador por usuario sin administrador).
#[tauri::command]
pub fn open_ollama_download(app: tauri::AppHandle) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(OLLAMA_DOWNLOAD, None::<&str>)
        .map_err(|e| AppError::internal("No se pudo abrir el navegador.").detail(e.to_string()))
}

#[cfg(windows)]
const OLLAMA_DOWNLOAD: &str = "https://ollama.com/download/windows";
#[cfg(target_os = "macos")]
const OLLAMA_DOWNLOAD: &str = "https://ollama.com/download/mac";
#[cfg(not(any(windows, target_os = "macos")))]
const OLLAMA_DOWNLOAD: &str = "https://ollama.com/download/linux";
