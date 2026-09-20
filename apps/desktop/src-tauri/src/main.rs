//! Tahlely desktop shell (Prompt 1).
//!
//! Security model: the webview is untrusted. Every command below
//! 1. rejects null bytes and `..` traversal at the boundary,
//! 2. constrains mutations to paths the user explicitly opened
//!    (the `allowed_roots` state, populated by the `register_root` command
//!    after a user-driven folder pick), and
//! 3. performs no shell execution — read-only traversal only in this phase.
//!
//! The TypeScript permission engine + execution allowlist remain the
//! authoritative gates; this layer is defense-in-depth.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::State;

#[derive(Default)]
struct AppState {
    /// Project roots the user explicitly opened this session.
    allowed_roots: Mutex<Vec<PathBuf>>,
}

#[derive(Debug, Serialize)]
struct FsStat {
    size: u64,
    #[serde(rename = "modifiedAt")]
    modified_at: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[derive(Debug, Serialize)]
struct ScannedFile {
    path: String,
    size: u64,
}

fn reject_dangerous(raw: &str) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err("path contains a null byte".to_string());
    }
    let path = PathBuf::from(raw);
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("path traversal is not allowed".to_string());
        }
    }
    Ok(path)
}

fn within_allowed_roots(state: &State<AppState>, path: &Path) -> bool {
    let roots = state.allowed_roots.lock().unwrap_or_else(|e| e.into_inner());
    roots.iter().any(|root| path.starts_with(root))
}

fn canonicalize_lossy(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn epoch_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

#[tauri::command]
fn app_ping() -> String {
    format!("tahlely-shell pong {}", epoch_millis(SystemTime::now()))
}

#[tauri::command]
fn register_root(state: State<AppState>, path: String) -> Result<String, String> {
    let clean = reject_dangerous(&path)?;
    let canonical = canonicalize_lossy(&clean);
    if !canonical.is_dir() {
        return Err("project root is not a directory".to_string());
    }
    let mut roots = state.allowed_roots.lock().map_err(|_| "state poisoned".to_string())?;
    if !roots.contains(&canonical) {
        roots.push(canonical.clone());
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
fn fs_list_dir(path: String) -> Result<Vec<String>, String> {
    let clean = reject_dangerous(&path)?;
    let mut entries = Vec::new();
    let dir = fs::read_dir(&clean).map_err(|e| format!("read_dir failed: {e}"))?;
    for entry in dir {
        let entry = entry.map_err(|e| format!("dir entry failed: {e}"))?;
        entries.push(entry.path().to_string_lossy().to_string());
    }
    entries.sort();
    Ok(entries)
}

#[tauri::command]
fn fs_read_text(path: String) -> Result<String, String> {
    let clean = reject_dangerous(&path)?;
    fs::read_to_string(&clean).map_err(|e| format!("read failed: {e}"))
}

#[tauri::command]
fn fs_stat(path: String) -> Result<FsStat, String> {
    let clean = reject_dangerous(&path)?;
    let meta = fs::metadata(&clean).map_err(|e| format!("stat failed: {e}"))?;
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    Ok(FsStat {
        size: meta.len(),
        modified_at,
        is_directory: meta.is_dir(),
    })
}

#[tauri::command]
fn fs_exists(path: String) -> Result<bool, String> {
    let clean = reject_dangerous(&path)?;
    Ok(clean.exists())
}

const SCAN_IGNORES: [&str; 12] = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "target",
    "vendor",
    ".venv",
    "__pycache__",
    ".idea",
    ".vscode",
];

/// Read-only recursive scan (metadata only). Capped so the UI never blocks;
/// full incremental indexing with hashing lives in @tahlely/infrastructure.
#[tauri::command]
fn project_scan(state: State<AppState>, root: String, max_files: Option<usize>) -> Result<Vec<ScannedFile>, String> {
    let clean = reject_dangerous(&root)?;
    let canonical = canonicalize_lossy(&clean);
    if !within_allowed_roots(&state, &canonical) {
        return Err("root is not registered for this session".to_string());
    }
    let cap = max_files.unwrap_or(50_000).min(200_000);
    let mut out = Vec::new();
    let mut stack = vec![canonical];
    while let Some(dir) = stack.pop() {
        if out.len() >= cap {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if SCAN_IGNORES.contains(&name.as_str()) {
                continue;
            }
            let file_type = match entry.file_type() {
                Ok(kind) => kind,
                Err(_) => continue,
            };
            // Never follow symlinks in the Prompt-1 scanner.
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(ScannedFile {
                    path: path.to_string_lossy().to_string(),
                    size,
                });
                if out.len() >= cap {
                    break;
                }
            }
        }
    }
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            app_ping,
            register_root,
            fs_list_dir,
            fs_read_text,
            fs_stat,
            fs_exists,
            project_scan
        ])
        .setup(|app| {
            // The main window exists per tauri.conf.json; nothing else to wire yet.
            let _ = app.handle();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run tahlely shell");
}
