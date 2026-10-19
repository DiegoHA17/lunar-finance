//! Detección de la instalación de Ollama en Windows y recursos del equipo (RAM y espacio libre).
//! No instala ni actualiza nada: solo comprueba y, si el usuario lo pide, abre la aplicación oficial ya instalada.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    /// `ollama.exe` (CLI y servidor).
    pub cli: Option<PathBuf>,
    /// `ollama app.exe` (aplicación de bandeja oficial, que arranca el servicio).
    pub app: Option<PathBuf>,
}

impl Installation {
    pub fn installed(&self) -> bool {
        self.cli.is_some() || self.app.is_some()
    }
}

#[cfg(windows)]
const CLI: &str = "ollama.exe";
#[cfg(not(windows))]
const CLI: &str = "ollama";

/// Busca Ollama en la ubicación del instalador oficial (Windows: `%LOCALAPPDATA%\Programs\Ollama`; Linux:
/// `/usr/local/bin`, `/usr/bin`; macOS: `/Applications/Ollama.app`) y en el `PATH`.
pub fn find_installation(local_app_data: Option<PathBuf>, path_var: Option<OsString>) -> Installation {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(l) = local_app_data {
        dirs.push(l.join("Programs").join("Ollama"));
    }
    if cfg!(not(windows)) {
        dirs.extend(["/usr/local/bin", "/usr/bin", "/Applications/Ollama.app/Contents/Resources"].map(PathBuf::from));
    }
    if let Some(p) = path_var {
        dirs.extend(std::env::split_paths(&p));
    }
    let mut inst = Installation { cli: None, app: None };
    for d in dirs {
        if inst.cli.is_none() && d.join(CLI).is_file() {
            inst.cli = Some(d.join(CLI));
        }
        if inst.app.is_none() && d.join("ollama app.exe").is_file() {
            inst.app = Some(d.join("ollama app.exe"));
        }
    }
    inst
}

pub fn current_installation() -> Installation {
    find_installation(std::env::var_os("LOCALAPPDATA").map(PathBuf::from), std::env::var_os("PATH"))
}

/// Abre la aplicación oficial de Ollama (que inicia el servicio local). Sin consola ni argumentos.
pub fn start_app(app: &Path) -> AppResult<()> {
    if app.file_name().and_then(|n| n.to_str()) != Some("ollama app.exe") || !app.is_file() {
        return Err(AppError::validation("No se encontró la aplicación de Ollama."));
    }
    std::process::Command::new(app).spawn().map(|_| ()).map_err(|e| AppError::io("No se pudo abrir Ollama.", e))
}

/// Carpeta de modelos de Ollama (`OLLAMA_MODELS` o `%USERPROFILE%\.ollama\models`).
pub fn models_dir() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("OLLAMA_MODELS") {
        return Some(PathBuf::from(p));
    }
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".ollama").join("models"))
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResources {
    pub total_memory_bytes: Option<u64>,
    pub free_disk_bytes: Option<u64>,
}

#[cfg(windows)]
pub fn resources() -> SystemResources {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut mem: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    mem.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: estructura inicializada con su tamaño, como exige la API.
    let total_memory_bytes = (unsafe { GlobalMemoryStatusEx(&mut mem) } != 0).then_some(mem.ullTotalPhys);

    // Primer antepasado existente de la carpeta de modelos (puede no existir todavía).
    let mut dir = models_dir();
    while let Some(d) = &dir {
        if d.exists() {
            break;
        }
        dir = d.parent().map(Path::to_path_buf);
    }
    let free_disk_bytes = dir.and_then(|d| {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = d.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free: u64 = 0;
        // SAFETY: cadena terminada en cero; los punteros nulos son opcionales en la API.
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(free)
    });
    SystemResources { total_memory_bytes, free_disk_bytes }
}

#[cfg(not(windows))]
pub fn resources() -> SystemResources {
    // Linux: memoria total de /proc/meminfo. El espacio libre no se mide (la recomendación será la conservadora).
    let total_memory_bytes = std::fs::read_to_string("/proc/meminfo").ok().and_then(|s| {
        s.lines()
            .find(|l| l.starts_with("MemTotal:"))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|kb| kb.parse::<u64>().ok())
            .map(|kb| kb * 1024)
    });
    SystemResources { total_memory_bytes, free_disk_bytes: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_official_install_and_path_installs() {
        let dir = tempfile::tempdir().unwrap();
        let official = dir.path().join("Programs").join("Ollama");
        std::fs::create_dir_all(&official).unwrap();
        std::fs::write(official.join(CLI), b"").unwrap();
        std::fs::write(official.join("ollama app.exe"), b"").unwrap();
        let inst = find_installation(Some(dir.path().to_path_buf()), None);
        assert!(inst.installed());
        assert_eq!(inst.app.unwrap().file_name().unwrap(), "ollama app.exe");

        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join(CLI), b"").unwrap();
        let path = std::env::join_paths([other.path()]).unwrap();
        let inst = find_installation(None, Some(path));
        assert!(inst.cli.is_some());
        assert!(inst.app.is_none());
    }

    #[test]
    fn reports_absent_installation() {
        let empty = tempfile::tempdir().unwrap();
        assert!(!find_installation(Some(empty.path().to_path_buf()), Some(OsString::new())).installed());
    }

    #[test]
    fn refuses_to_start_anything_but_the_official_app() {
        let dir = tempfile::tempdir().unwrap();
        let evil = dir.path().join("cmd.exe");
        std::fs::write(&evil, b"").unwrap();
        assert!(start_app(&evil).is_err());
        assert!(start_app(&dir.path().join("ollama app.exe")).is_err());
    }

    #[test]
    fn reads_system_resources() {
        let r = resources();
        if cfg!(windows) {
            assert!(r.total_memory_bytes.unwrap_or(0) > 512 * 1024 * 1024);
            assert!(r.free_disk_bytes.is_some());
        }
    }
}
