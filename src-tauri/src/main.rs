// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Wordfront desktop shell: shows the game and keeps its data in
//! %APPDATA%/Wordfront (save.json and logs/), the same folder and the same
//! operations as the dev server (dev/datastore.ts).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

fn data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("WORDFRONT_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let base = std::env::var("APPDATA").map_err(|_| "APPDATA is not set".to_string())?;
    Ok(PathBuf::from(base).join("Wordfront"))
}

/// run-YYYYMMDD-HHMMSS(-xxxx).jsonl and nothing else, so a name can't escape logs/.
fn safe_log_name(name: &str) -> bool {
    let Some(stem) = name.strip_prefix("run-").and_then(|s| s.strip_suffix(".jsonl")) else {
        return false;
    };
    let parts: Vec<&str> = stem.split('-').collect();
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    let hex4 = |s: &str| s.len() == 4 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    match parts.as_slice() {
        [d, t] => digits(d, 8) && digits(t, 6),
        [d, t, x] => digits(d, 8) && digits(t, 6) && hex4(x),
        _ => false,
    }
}

#[tauri::command]
fn load_save() -> Result<Option<String>, String> {
    match fs::read_to_string(data_dir()?.join("save.json")) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic: write a temp file, then rename it over save.json.
#[tauri::command]
fn write_save(json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("not JSON: {e}"))?;
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("save.json.{}.tmp", std::process::id()));
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("save.json")).map_err(|e| e.to_string())
}

#[tauri::command]
fn append_log(file: String, lines: String) -> Result<(), String> {
    if !safe_log_name(&file) {
        return Err(format!("bad log file name: {file}"));
    }
    let logs = data_dir()?.join("logs");
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join(file))
        .map_err(|e| e.to_string())?;
    f.write_all(lines.as_bytes()).map_err(|e| e.to_string())
}

/// Delete the oldest run logs beyond max_runs files or max_bytes in total.
#[tauri::command]
fn prune_logs(max_runs: usize, max_bytes: u64) -> Result<usize, String> {
    let logs = data_dir()?.join("logs");
    if !logs.exists() {
        return Ok(0);
    }
    let mut files: Vec<(String, u64)> = fs::read_dir(&logs)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let size = e.metadata().ok()?.len();
            safe_log_name(&name).then_some((name, size))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0)); // newest first: names are timestamps
    let (mut total, mut removed) = (0u64, 0usize);
    for (i, (name, size)) in files.iter().enumerate() {
        total += size;
        if i >= max_runs || total > max_bytes {
            if fs::remove_file(logs.join(name)).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_save, write_save, append_log, prune_logs, quit])
        .on_window_event(|window, event| {
            // Let the game finish its run log before closing; it calls `quit` when done.
            // If it doesn't answer (e.g. the page is broken), close anyway after a moment.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let _ = window.emit("wf-close-requested", ());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Wordfront");
}

#[cfg(test)]
mod tests {
    use super::safe_log_name;

    #[test]
    fn log_names() {
        assert!(safe_log_name("run-20261125-101500-ab12.jsonl"));
        assert!(safe_log_name("run-20261125-101500.jsonl"));
        assert!(!safe_log_name("../save.json"));
        assert!(!safe_log_name("run-1.jsonl"));
        assert!(!safe_log_name("run-20261125-101500-AB12.jsonl"));
        assert!(!safe_log_name("run-20261125-101500-ab12.jsonl/../../x"));
    }
}
