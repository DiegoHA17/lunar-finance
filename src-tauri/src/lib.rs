//! Lunar — capa nativa.
//!
//! Responsabilidades: guardar el token de forma segura, hablar con la API de Notion, persistir la configuración y
//! los documentos locales sin secretos, y guardar exportaciones. La lógica de dominio vive en TypeScript.

mod ai;
mod commands;
mod config;
mod credentials;
mod error;
mod export;
mod notion;
mod store;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                // Las dependencias HTTP pueden registrar URLs; nunca cabeceras. Se limitan a advertencias.
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_config_dir().expect("directorio de configuración de la aplicación");
            std::fs::create_dir_all(&data_dir)?;
            let base_url = std::env::var("LUNAR_NOTION_BASE_URL")
                .ok()
                .filter(|_| cfg!(debug_assertions))
                .unwrap_or_else(|| notion::client::DEFAULT_BASE_URL.to_string());
            app.manage(AppState {
                secrets: Box::new(credentials::KeyringStore),
                http: notion::client::build_http(),
                base_url,
                data_dir,
                write_lock: std::sync::Mutex::new(()),
                ollama_url: ai::ollama::DEFAULT_URL.to_string(),
                ai_pull: std::sync::Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::credentials_status,
            commands::credentials_set,
            commands::credentials_clear,
            commands::config_get,
            commands::config_set,
            commands::notion_diagnose,
            commands::notion_list_sources,
            commands::notion_resolve_source,
            commands::notion_get_schema,
            commands::notion_query,
            commands::notion_create_page,
            commands::notion_update_page,
            commands::notion_add_properties,
            commands::notion_create_categories_database,
            commands::store_read,
            commands::store_write,
            commands::export_save,
            commands::open_notion_url,
            commands::ai_status,
            commands::ai_start,
            commands::ai_pull,
            commands::ai_cancel_pull,
            commands::ai_classify,
            commands::ai_review_duplicates,
            commands::open_ollama_download,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Lunar");
}
