//! Cliente HTTP mínimo de la API de Notion.
//!
//! - Cabecera `Notion-Version: 2026-03-11`.
//! - 429 y 529: espera lo que indique `Retry-After` (con tope) y reintenta, también en escrituras (Notion no las
//!   procesó).
//! - 500/502/503/504 y fallos de red: solo se reintentan las peticiones idempotentes (lecturas y consultas).
//! - Todos los errores se traducen a [`AppError`] con un mensaje y una acción sugerida.

use crate::error::{AppError, AppResult, ErrorCode};
use reqwest::{Method, StatusCode};
use serde_json::Value;
use std::time::Duration;

pub const NOTION_VERSION: &str = "2026-03-11";
pub const DEFAULT_BASE_URL: &str = "https://api.notion.com";

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    /// Si Notion pide esperar más que esto, se devuelve el error en lugar de bloquear la aplicación.
    pub max_wait: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self { max_retries: 4, base_delay: Duration::from_millis(500), max_wait: Duration::from_secs(30) }
    }
}

pub fn build_http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Lunar/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("cliente HTTP")
}

pub struct NotionClient {
    http: reqwest::Client,
    base_url: String,
    token: String,
    policy: RetryPolicy,
}

impl NotionClient {
    pub fn new(http: reqwest::Client, base_url: &str, token: String) -> Self {
        Self { http, base_url: base_url.trim_end_matches('/').to_string(), token, policy: RetryPolicy::default() }
    }

    #[cfg(test)]
    pub fn with_policy(mut self, policy: RetryPolicy) -> Self {
        self.policy = policy;
        self
    }

    pub async fn get(&self, path: &str) -> AppResult<Value> {
        self.request(Method::GET, path, None, true).await
    }

    /// POST de solo lectura (consultas y búsquedas): se puede reintentar.
    pub async fn post_read(&self, path: &str, body: &Value) -> AppResult<Value> {
        self.request(Method::POST, path, Some(body), true).await
    }

    pub async fn post_write(&self, path: &str, body: &Value) -> AppResult<Value> {
        self.request(Method::POST, path, Some(body), false).await
    }

    pub async fn patch(&self, path: &str, body: &Value) -> AppResult<Value> {
        self.request(Method::PATCH, path, Some(body), false).await
    }

    async fn request(&self, method: Method, path: &str, body: Option<&Value>, idempotent: bool) -> AppResult<Value> {
        let url = format!("{}{}", self.base_url, path);
        let mut attempt: u32 = 0;
        loop {
            let mut req = self
                .http
                .request(method.clone(), &url)
                .bearer_auth(&self.token)
                .header("Notion-Version", NOTION_VERSION);
            if let Some(b) = body {
                req = req.json(b);
            }
            let can_retry = attempt < self.policy.max_retries;
            let response = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    if idempotent && can_retry {
                        attempt += 1;
                        tokio::time::sleep(self.backoff(attempt)).await;
                        continue;
                    }
                    return Err(network_error(&e));
                }
            };
            let status = response.status();
            if status.is_success() {
                return response.json::<Value>().await.map_err(|e| {
                    AppError::new(ErrorCode::Server, "Notion devolvió una respuesta que no se pudo interpretar.").detail(e.to_string())
                });
            }
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok());
            let body_json: Value = response.json().await.unwrap_or(Value::Null);
            let code = body_json.get("code").and_then(Value::as_str).unwrap_or("").to_string();

            let throttled = status == StatusCode::TOO_MANY_REQUESTS || status.as_u16() == 529;
            if throttled && can_retry && code != "public_api_request_blocked" {
                let wait = retry_after.map(Duration::from_secs).unwrap_or_else(|| self.backoff(attempt + 1));
                if wait <= self.policy.max_wait {
                    attempt += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
            }
            let transient = matches!(status.as_u16(), 500 | 502 | 503 | 504);
            if transient && idempotent && can_retry {
                attempt += 1;
                tokio::time::sleep(self.backoff(attempt)).await;
                continue;
            }
            return Err(api_error(status, &body_json, retry_after));
        }
    }

    fn backoff(&self, attempt: u32) -> Duration {
        // Exponencial con una pequeña variación determinista por intento (sin dependencias de azar).
        let factor = 2u32.saturating_pow(attempt.saturating_sub(1)).min(16);
        let jitter = Duration::from_millis(37 * u64::from(attempt));
        self.policy.base_delay * factor + jitter.min(self.policy.base_delay)
    }
}

fn network_error(e: &reqwest::Error) -> AppError {
    let message = if e.is_timeout() {
        "Notion no respondió a tiempo."
    } else {
        "No se pudo conectar con Notion."
    };
    // `reqwest::Error` incluye la URL, nunca las cabeceras: no contiene el token.
    AppError::new(ErrorCode::Offline, message)
        .hint("Comprueba tu conexión a Internet y vuelve a intentarlo. Los datos mostrados no se han modificado.")
        .detail(e.to_string())
}

pub fn api_error(status: StatusCode, body: &Value, retry_after: Option<u64>) -> AppError {
    let code = body.get("code").and_then(Value::as_str).unwrap_or("");
    let notion_message = body.get("message").and_then(Value::as_str).unwrap_or("");
    let detail = format!("HTTP {} · {} · {}", status.as_u16(), if code.is_empty() { "sin código" } else { code }, notion_message);
    let mut err = match (status.as_u16(), code) {
        (401, _) => AppError::new(ErrorCode::InvalidToken, "Notion ha rechazado el token: no es válido o ha sido revocado.")
            .hint("Abre notion.so/profile/integrations, copia de nuevo el «Internal Integration Secret» y guárdalo en Ajustes."),
        (403, _) => AppError::new(ErrorCode::Forbidden, "La integración no tiene permiso para esta operación.")
            .hint("En notion.so/profile/integrations → tu integración → Capacidades, activa «Leer contenido», «Actualizar contenido» e «Insertar contenido»."),
        (404, _) => AppError::new(ErrorCode::NotFound, "Notion no encuentra el recurso o no está compartido con la integración.")
            .hint("Abre la base de datos en Notion → menú «···» → Conexiones → añade tu integración. Comprueba también que el enlace o ID corresponde a esa base de datos."),
        (409, _) => AppError::new(ErrorCode::Conflict, "Notion rechazó el cambio por un conflicto con otra edición.")
            .hint("Actualiza los datos y vuelve a intentarlo."),
        (429, _) | (529, _) => {
            let mut e = AppError::new(ErrorCode::RateLimited, "Se ha alcanzado el límite de peticiones de Notion.")
                .hint("Espera unos segundos y vuelve a intentarlo.");
            e.retry_after_secs = retry_after;
            e
        }
        (400, "validation_error") => AppError::new(ErrorCode::Validation, "Notion rechazó los datos enviados.")
            .hint("Puede que el esquema de la base de datos haya cambiado. Ejecuta el diagnóstico en Ajustes."),
        (400, "missing_version") | (400, "invalid_request_url") | (400, "invalid_request") => {
            AppError::internal("La petición a Notion no es válida (error interno de Lunar).")
        }
        (s, _) if s >= 500 => AppError::new(ErrorCode::Server, "Notion no está disponible en este momento.")
            .hint("Inténtalo de nuevo en unos minutos. Si estabas guardando un cambio, actualiza los datos antes de repetirlo: puede que ya se haya guardado."),
        _ => AppError::new(ErrorCode::Internal, "Notion devolvió un error inesperado."),
    };
    err = err.detail(detail);
    err
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;
    use serde_json::json;

    fn fast() -> RetryPolicy {
        RetryPolicy { max_retries: 3, base_delay: Duration::from_millis(1), max_wait: Duration::from_secs(2) }
    }

    fn client(server: &Server) -> NotionClient {
        NotionClient::new(build_http(), &server.url(), "ntn_testtoken1234567890".into()).with_policy(fast())
    }

    #[tokio::test]
    async fn sends_version_and_bearer_headers() {
        let mut server = Server::new_async().await;
        let m = server
            .mock("GET", "/v1/users/me")
            .match_header("notion-version", NOTION_VERSION)
            .match_header("authorization", "Bearer ntn_testtoken1234567890")
            .with_status(200)
            .with_body(r#"{"object":"user","type":"bot"}"#)
            .create_async()
            .await;
        let v = client(&server).get("/v1/users/me").await.unwrap();
        assert_eq!(v["type"], "bot");
        m.assert_async().await;
    }

    #[tokio::test]
    async fn classifies_401_403_404() {
        let mut server = Server::new_async().await;
        for (status, code, expected) in [
            (401, "unauthorized", ErrorCode::InvalidToken),
            (403, "restricted_resource", ErrorCode::Forbidden),
            (404, "object_not_found", ErrorCode::NotFound),
        ] {
            let path = format!("/v1/x{status}");
            let _m = server
                .mock("GET", path.as_str())
                .with_status(status)
                .with_body(json!({ "object": "error", "status": status, "code": code, "message": "m" }).to_string())
                .create_async()
                .await;
            let err = client(&server).get(&path).await.unwrap_err();
            assert_eq!(err.code, expected, "status {status}");
            assert!(err.hint.is_some());
            assert!(err.detail.unwrap().contains(code));
        }
    }

    #[tokio::test]
    async fn retries_rate_limited_requests_respecting_retry_after() {
        let mut server = Server::new_async().await;
        let limited = server
            .mock("POST", "/v1/pages")
            .with_status(429)
            .with_header("retry-after", "0")
            .with_body(r#"{"code":"rate_limited","message":"slow down"}"#)
            .expect(2)
            .create_async()
            .await;
        let ok = server.mock("POST", "/v1/pages").with_status(200).with_body(r#"{"id":"p"}"#).create_async().await;
        // mockito empareja el primer mock que no ha agotado sus expectativas; se registran en orden.
        let v = client(&server).post_write("/v1/pages", &json!({})).await.unwrap();
        assert_eq!(v["id"], "p");
        limited.assert_async().await;
        ok.assert_async().await;
    }

    #[tokio::test]
    async fn gives_up_when_retry_after_is_too_long() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("GET", "/v1/slow")
            .with_status(429)
            .with_header("retry-after", "120")
            .with_body(r#"{"code":"rate_limited","message":"workspace"}"#)
            .expect(1)
            .create_async()
            .await;
        let err = client(&server).get("/v1/slow").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RateLimited);
        assert_eq!(err.retry_after_secs, Some(120));
    }

    #[tokio::test]
    async fn retries_5xx_only_for_idempotent_requests() {
        let mut server = Server::new_async().await;
        let get_fail = server.mock("GET", "/v1/r").with_status(503).with_body("{}").expect(1).create_async().await;
        let get_ok = server.mock("GET", "/v1/r").with_status(200).with_body("{}").create_async().await;
        client(&server).get("/v1/r").await.unwrap();
        get_fail.assert_async().await;
        get_ok.assert_async().await;

        let patch_fail = server.mock("PATCH", "/v1/w").with_status(503).with_body(r#"{"code":"service_unavailable"}"#).expect(1).create_async().await;
        let err = client(&server).patch("/v1/w", &json!({})).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Server);
        patch_fail.assert_async().await;
    }

    #[tokio::test]
    async fn reports_offline_when_server_is_unreachable() {
        // Puerto cerrado en localhost: conexión rechazada.
        let c = NotionClient::new(build_http(), "http://127.0.0.1:9", "ntn_testtoken1234567890".into()).with_policy(fast());
        let err = c.get("/v1/users/me").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Offline);
        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("ntn_testtoken"));
    }
}
