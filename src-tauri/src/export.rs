//! Guardado de informes (PDF/CSV) en la ruta que elija el usuario con el diálogo nativo.
//! La interfaz no recibe permisos generales de sistema de archivos.

use crate::error::{AppError, AppResult, ErrorCode};
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 50 * 1024 * 1024;

/// Limpia un nombre de archivo sugerido: sin separadores de ruta ni caracteres reservados de Windows.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() { "informe".to_string() } else { trimmed.chars().take(120).collect() }
}

pub fn save_with_dialog(app: &tauri::AppHandle, suggested_name: &str, format: &str, bytes: &[u8]) -> AppResult<Option<String>> {
    let (filter_name, ext) = match format {
        "pdf" => ("Documento PDF", "pdf"),
        "csv" => ("CSV (separado por punto y coma)", "csv"),
        _ => return Err(AppError::validation("Formato de exportación no admitido.")),
    };
    if bytes.is_empty() {
        return Err(AppError::validation("El archivo generado está vacío."));
    }
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(AppError::validation("El archivo generado es demasiado grande."));
    }
    let mut name = sanitize_file_name(suggested_name);
    if !name.to_lowercase().ends_with(&format!(".{ext}")) {
        name.push('.');
        name.push_str(ext);
    }
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(filter_name, &[ext]).blocking_save_file() else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| AppError::new(ErrorCode::Io, "La ruta elegida no es válida.").detail(e.to_string()))?;
    std::fs::write(&path, bytes).map_err(|e| {
        AppError::io("No se pudo guardar el archivo.", e)
            .hint("Comprueba que el archivo no está abierto en otro programa (por ejemplo, Excel o un visor de PDF) y que tienes permiso para escribir en esa carpeta.")
    })?;
    log::info!("Exportación guardada ({} bytes)", bytes.len());
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_file_name("Informe 2026/10: octubre"), "Informe 2026_10_ octubre");
        assert_eq!(sanitize_file_name("..\\..\\evil"), "_.._evil");
        assert_eq!(sanitize_file_name("   "), "informe");
    }
}
