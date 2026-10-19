//! Inteligencia artificial local opcional (Ollama). La aplicación funciona igual sin ella.

pub mod ollama;
pub mod system;

use crate::error::{AppError, AppResult};
use ollama::{LocalModel, OllamaClient};
use serde::Serialize;
use system::{Installation, SystemResources};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub installed: bool,
    /// Se puede abrir la aplicación oficial para iniciar el servicio.
    pub can_start: bool,
    pub running: bool,
    pub version: Option<String>,
    pub models: Vec<LocalModel>,
    pub resources: SystemResources,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

pub async fn status(client: &OllamaClient, inst: &Installation) -> AiStatus {
    let resources = system::resources();
    let mut st = AiStatus { installed: inst.installed(), can_start: inst.app.is_some(), running: false, version: None, models: Vec::new(), resources, error: None };
    match client.version().await {
        Ok(v) => {
            st.running = true;
            // Un servicio que responde implica una instalación aunque no esté en la ruta habitual.
            st.installed = true;
            st.version = Some(v);
            match client.tags().await {
                Ok(m) => st.models = m,
                Err(e) => st.error = Some(e),
            }
        }
        Err(e) => {
            if st.installed {
                st.error = Some(e);
            }
        }
    }
    st
}

/// Nombre de modelo admitido por Ollama (`familia:etiqueta`, opcionalmente con espacio de nombres).
pub fn validate_model_name(name: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && name.len() <= 100
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-' | ':' | '/'));
    if ok { Ok(()) } else { Err(AppError::validation("Nombre de modelo no válido.")) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[test]
    fn validates_model_names() {
        assert!(validate_model_name("gemma3:4b").is_ok());
        assert!(validate_model_name("library/gemma3:1b-it-qat").is_ok());
        assert!(validate_model_name("gemma3:4b; rm -rf").is_err());
        assert!(validate_model_name("").is_err());
        assert!(validate_model_name("Gemma3").is_err());
    }

    #[tokio::test]
    async fn status_distinguishes_absent_stopped_and_running() {
        let none = Installation { cli: None, app: None };
        let installed = Installation { cli: Some("C:/x/ollama.exe".into()), app: Some("C:/x/ollama app.exe".into()) };
        let down = OllamaClient::new("http://127.0.0.1:9");

        let absent = status(&down, &none).await;
        assert!(!absent.installed && !absent.running && absent.error.is_none());

        let stopped = status(&down, &installed).await;
        assert!(stopped.installed && !stopped.running && stopped.can_start);
        assert!(stopped.error.is_some());

        let mut s = Server::new_async().await;
        let _v = s.mock("GET", "/api/version").with_body(r#"{"version":"0.40.6"}"#).create_async().await;
        let _t = s.mock("GET", "/api/tags").with_body(r#"{"models":[{"name":"gemma3:4b","size":1,"details":{"family":"gemma3"}}]}"#).create_async().await;
        let running = status(&OllamaClient::new(&s.url()), &none).await;
        assert!(running.installed && running.running);
        assert_eq!(running.version.as_deref(), Some("0.40.6"));
        assert_eq!(running.models.len(), 1);
    }
}
