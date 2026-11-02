//! Documentos JSON locales que no son datos financieros (reglas de clasificación, preferencias y pagos periódicos).
//!
//! Solo se permiten nombres de una lista cerrada. Las escrituras son atómicas y la versión anterior se conserva
//! como `.bak` para poder recuperarla.

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub const ALLOWED_DOCUMENTS: &[&str] = &["rules", "preferences", "recurring"];
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

fn document_path(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !ALLOWED_DOCUMENTS.contains(&name) {
        return Err(AppError::validation(format!("Documento local no permitido: «{name}».")));
    }
    Ok(dir.join(format!("{name}.json")))
}

/// Escribe en un archivo temporal y lo renombra sobre el destino, para no dejar nunca un archivo a medias.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io("No se pudo crear el directorio de datos de la aplicación.", e))?;
    }
    let tmp = path.with_extension("tmp");
    // Se fuerza a disco antes de renombrar: un corte de luz no puede dejar el destino vacío ni a medias.
    let written = std::fs::File::create(&tmp).and_then(|mut f| {
        std::io::Write::write_all(&mut f, bytes)?;
        f.sync_all()
    });
    written.map_err(|e| AppError::io(format!("No se pudo escribir {}.", path.display()), e))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::io(format!("No se pudo reemplazar {}.", path.display()), e)
    })
}

pub fn read(dir: &Path, name: &str) -> AppResult<Option<serde_json::Value>> {
    let path = document_path(dir, name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| {
            AppError::io(format!("El archivo local «{name}» está dañado."), e)
                .hint(format!("Hay una copia anterior en {}.bak si necesitas recuperarla.", path.display()))
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::io(format!("No se pudo leer el archivo local «{name}»."), e)),
    }
}

pub fn write(dir: &Path, name: &str, value: &serde_json::Value) -> AppResult<()> {
    let path = document_path(dir, name)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| AppError::internal("No se pudo serializar el documento.").detail(e.to_string()))?;
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation("El documento supera el tamaño máximo permitido (2 MB)."));
    }
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    write_atomic(&path, text.as_bytes())
}

/// Cerrojo exclusivo entre procesos (dos ventanas o instancias de Lunar) para registrar pagos periódicos.
/// Devuelve `None` si otro proceso lo tiene. El sistema lo libera al cerrar el archivo o si el proceso termina.
pub fn try_lock_run(dir: &Path) -> AppResult<Option<std::fs::File>> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::io("No se pudo crear el directorio de datos de la aplicación.", e))?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("recurring.lock"))
        .map_err(|e| AppError::io("No se pudo abrir el cerrojo de pagos periódicos.", e))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(e)) => Err(AppError::io("No se pudo bloquear el registro de pagos periódicos.", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_allows_listed_documents() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write(dir.path(), "../config", &json!({})).is_err());
        assert!(read(dir.path(), "secrets").is_err());
    }

    #[test]
    fn writes_reads_and_keeps_backup() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path(), "rules").unwrap(), None);
        write(dir.path(), "rules", &json!({"v": 1})).unwrap();
        write(dir.path(), "rules", &json!({"v": 2})).unwrap();
        assert_eq!(read(dir.path(), "rules").unwrap(), Some(json!({"v": 2})));
        let bak = std::fs::read_to_string(dir.path().join("rules.json.bak")).unwrap();
        assert!(bak.contains("\"v\": 1"));
    }

    #[test]
    fn run_lock_is_exclusive_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let first = try_lock_run(dir.path()).unwrap();
        assert!(first.is_some());
        assert!(try_lock_run(dir.path()).unwrap().is_none());
        drop(first);
        assert!(try_lock_run(dir.path()).unwrap().is_some());
    }

    #[test]
    fn allows_recurring_document() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "recurring", &json!({"version": 1})).unwrap();
        assert_eq!(read(dir.path(), "recurring").unwrap(), Some(json!({"version": 1})));
    }

    #[test]
    fn rejects_oversized_documents() {
        let dir = tempfile::tempdir().unwrap();
        let big = "x".repeat(MAX_DOCUMENT_BYTES + 1);
        assert!(write(dir.path(), "rules", &json!({ "big": big })).is_err());
    }
}
