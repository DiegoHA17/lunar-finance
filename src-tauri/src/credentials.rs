//! Gestión del token de la integración de Notion.
//!
//! El token se guarda en Windows Credential Manager (protegido por DPAPI) mediante `keyring`. Ningún comando lo
//! devuelve a la interfaz: solo se informa de si existe.

use crate::error::{AppError, AppResult, ErrorCode};
use std::sync::Mutex;

pub const SERVICE: &str = "com.lunar.finance";
pub const ACCOUNT: &str = "notion-token";

pub trait SecretStore: Send + Sync {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, secret: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

/// Almacén real: Windows Credential Manager.
pub struct KeyringStore;

impl KeyringStore {
    fn entry() -> AppResult<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT)
            .map_err(|e| AppError::new(ErrorCode::Internal, "No se pudo abrir el almacén de credenciales de Windows.").detail(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self) -> AppResult<Option<String>> {
        match Self::entry()?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::new(ErrorCode::Internal, "No se pudo leer el token del Administrador de credenciales de Windows.")
                .detail(e.to_string())),
        }
    }

    fn set(&self, secret: &str) -> AppResult<()> {
        Self::entry()?
            .set_password(secret)
            .map_err(|e| AppError::new(ErrorCode::Internal, "No se pudo guardar el token en el Administrador de credenciales de Windows.").detail(e.to_string()))
    }

    fn delete(&self) -> AppResult<()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::new(ErrorCode::Internal, "No se pudo eliminar el token.").detail(e.to_string())),
        }
    }
}

/// Almacén en memoria para pruebas.
#[derive(Default)]
pub struct MemoryStore(Mutex<Option<String>>);

impl MemoryStore {
    #[allow(dead_code)]
    pub fn with(secret: &str) -> Self {
        Self(Mutex::new(Some(secret.to_string())))
    }
}

impl SecretStore for MemoryStore {
    fn get(&self) -> AppResult<Option<String>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set(&self, secret: &str) -> AppResult<()> {
        *self.0.lock().unwrap() = Some(secret.to_string());
        Ok(())
    }
    fn delete(&self) -> AppResult<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

/// Valida el formato del token sin enviarlo a ninguna parte. Devuelve el token limpio.
pub fn validate_token_format(raw: &str) -> AppResult<String> {
    let token = raw.trim();
    if token.is_empty() {
        return Err(AppError::validation("El token está vacío."));
    }
    if token.len() < 20 || token.len() > 300 {
        return Err(AppError::validation("El token no tiene una longitud válida.")
            .hint("Copia el «Internal Integration Secret» completo desde notion.so/profile/integrations."));
    }
    if !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::validation("El token contiene caracteres no válidos (espacios, comillas o saltos de línea).")
            .hint("Pega solo el secreto, sin comillas ni el texto «Bearer»."));
    }
    if !(token.starts_with("ntn_") || token.starts_with("secret_")) {
        return Err(AppError::validation("El token no parece un secreto de integración de Notion (debe empezar por «ntn_» o «secret_»).")
            .hint("En notion.so/profile/integrations abre tu integración y copia el «Internal Integration Secret»."));
    }
    Ok(token.to_string())
}

/// Obtiene el token o devuelve un error `NoToken` con instrucciones.
pub fn require_token(store: &dyn SecretStore) -> AppResult<String> {
    store.get()?.ok_or_else(|| {
        AppError::new(ErrorCode::NoToken, "No hay ningún token de Notion configurado.")
            .hint("Ve a Ajustes → Conexión con Notion y pega el secreto de tu integración.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_tokens() {
        assert_eq!(validate_token_format("  ntn_abcdefghijklmnopqrstuvwxyz012345 \n").unwrap(), "ntn_abcdefghijklmnopqrstuvwxyz012345");
        assert!(validate_token_format("secret_abcdefghijklmnopqrstuvwxyz").is_ok());
    }

    #[test]
    fn rejects_malformed_tokens() {
        assert!(validate_token_format("").is_err());
        assert!(validate_token_format("ntn_short").is_err());
        assert!(validate_token_format("Bearer ntn_abcdefghijklmnopqrstuvwxyz").is_err());
        assert!(validate_token_format("\"ntn_abcdefghijklmnopqrstuvwxyz\"").is_err());
        assert!(validate_token_format("abcdefghijklmnopqrstuvwxyz0123").is_err());
    }

    #[test]
    fn invalid_token_error_never_echoes_the_token() {
        let err = validate_token_format("ntn_abcdefghijklmnopqrstuvwxyz 123").unwrap_err();
        assert!(!err.message.contains("abcdefghij"));
    }

    /// Integración real con Windows Credential Manager (servicio de prueba, distinto del de la aplicación).
    /// Se ejecuta a mano: `cargo test -- --ignored keyring_roundtrip`.
    #[test]
    #[ignore]
    fn keyring_roundtrip_on_windows_credential_manager() {
        let entry = keyring::Entry::new("com.lunar.finance.test", "roundtrip").unwrap();
        let secret = "ntn_pruebaSinValor0000000000000000";
        entry.set_password(secret).unwrap();
        assert_eq!(entry.get_password().unwrap(), secret);
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn missing_token_is_reported_as_no_token() {
        let store = MemoryStore::default();
        assert_eq!(require_token(&store).unwrap_err().code, ErrorCode::NoToken);
        store.set("ntn_abcdefghijklmnopqrstuvwxyz").unwrap();
        assert!(require_token(&store).is_ok());
        store.delete().unwrap();
        assert!(store.get().unwrap().is_none());
    }
}
