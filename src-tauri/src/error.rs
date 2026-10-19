//! Error único que cruza la frontera IPC. Siempre lleva un código estable, un mensaje comprensible en español
//! y, cuando existe, una acción sugerida. Nunca incluye el token (ver [`redact`]).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// No hay token guardado.
    NoToken,
    /// Notion rechaza el token (401).
    InvalidToken,
    /// Sin conexión a Internet o Notion inalcanzable.
    Offline,
    /// La integración no tiene permiso (403).
    Forbidden,
    /// El recurso no existe o no está compartido con la integración (404).
    NotFound,
    /// El esquema de Notion no coincide con el mapeo configurado.
    Schema,
    /// Datos enviados inválidos (400 validation_error o validación local).
    Validation,
    /// Límite de peticiones de Notion.
    RateLimited,
    /// La página cambió desde que se leyó.
    Conflict,
    /// Error del servidor de Notion (5xx).
    Server,
    /// Configuración incompleta.
    Config,
    /// Error de E/S local (configuración, exportación).
    Io,
    /// Error inesperado.
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// Detalle técnico (código de Notion, estado HTTP). Ya redactado.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: redact(&message.into()), hint: None, detail: None, retry_after_secs: None }
    }

    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(redact(&hint.into()));
        self
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(redact(&detail.into()));
        self
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn config(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Config, message)
    }

    pub fn io(message: impl Into<String>, err: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::Io, message).detail(err.to_string())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Sustituye cualquier cosa con forma de token de Notion (`ntn_…`, `secret_…`) o cabecera Bearer por `[oculto]`.
pub fn redact(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        let next = ["ntn_", "secret_", "Bearer "]
            .iter()
            .filter_map(|p| rest.find(p).map(|i| (i, *p)))
            .min_by_key(|(i, _)| *i);
        match next {
            None => {
                out.push_str(rest);
                return out;
            }
            Some((i, prefix)) => {
                out.push_str(&rest[..i]);
                let after = &rest[i + prefix.len()..];
                let token_len = after
                    .char_indices()
                    .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-'))
                    .map(|(j, _)| j)
                    .unwrap_or(after.len());
                if token_len >= 8 {
                    out.push_str("[oculto]");
                } else {
                    out.push_str(prefix);
                    out.push_str(&after[..token_len]);
                }
                rest = &after[token_len..];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_notion_tokens_and_bearer_headers() {
        let s = "token ntn_abcDEF1234567890xyz falló; secret_ABCDEFGHIJKL y Bearer ntn_zzzzzzzzzzzz";
        let r = redact(s);
        assert!(!r.contains("abcDEF"));
        assert!(!r.contains("ABCDEFGHIJKL"));
        assert!(!r.contains("zzzz"));
        assert!(r.contains("[oculto]"));
    }

    #[test]
    fn keeps_short_words_with_prefix_like_text() {
        assert_eq!(redact("secret_x"), "secret_x");
        assert_eq!(redact("sin tokens"), "sin tokens");
    }

    #[test]
    fn app_error_redacts_message_hint_and_detail() {
        let e = AppError::new(ErrorCode::Internal, "ntn_1234567890abcdef")
            .hint("usa secret_1234567890abcdef")
            .detail("Bearer abcdefghijklmnop");
        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("1234567890abcdef"));
        assert!(!json.contains("abcdefghijklmnop"));
    }
}
