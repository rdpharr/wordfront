// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Wordfront desktop shell: shows the game and keeps its data (save.json and logs/)
//! in a Wordfront folder under the OS's per-user data folder, the same folder and the
//! same operations as the dev server (dev/datastore.ts):
//! - Windows: %APPDATA%\Wordfront
//! - macOS:   ~/Library/Application Support/Wordfront
//! - Linux:   $XDG_DATA_HOME/Wordfront (usually ~/.local/share/Wordfront)

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalSize, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// The only pages the game may open in the browser: the project's own (src/app/links.ts).
const LINK_PREFIXES: [&str; 3] = [
    "https://github.com/rdpharr/wordfront",
    "https://buymeacoffee.com/rdpharr",
    "https://rdpharr.github.io/wordfront",
];

/// Set once at startup from the OS's per-user data folder.
static DATA_DIR: OnceLock<Result<PathBuf, String>> = OnceLock::new();

fn data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("WORDFRONT_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    DATA_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| Err("the data folder isn't known yet".to_string()))
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

/// The first and last line of every run log, oldest first: the run_start and (for a
/// finished run) the run_end, enough to rebuild run history.
#[tauri::command]
fn log_ends() -> Result<String, String> {
    let logs = data_dir()?.join("logs");
    if !logs.exists() {
        return Ok(String::new());
    }
    let mut names: Vec<String> = fs::read_dir(&logs)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| safe_log_name(n))
        .collect();
    names.sort();
    let mut out = String::new();
    for name in names {
        let Ok(text) = fs::read_to_string(logs.join(&name)) else { continue };
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        if let Some(first) = lines.first() {
            out.push_str(first);
            out.push('\n');
            if lines.len() > 1 {
                out.push_str(lines[lines.len() - 1]);
                out.push('\n');
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn quit(app: AppHandle) {
    save_and_exit(&app);
}

/// Remember the window's size, position and fullscreen state, then exit.
fn save_and_exit(app: &AppHandle) {
    let _ = app.save_window_state(StateFlags::all());
    app.exit(0);
}

/// One of LINK_PREFIXES exactly, or followed by a path or query; plain printable ASCII only.
fn allowed_link(url: &str) -> bool {
    url.bytes().all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
        && LINK_PREFIXES.iter().any(|p| {
            url.strip_prefix(p)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/') || rest.starts_with('?'))
        })
}

#[tauri::command]
fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    if !allowed_link(&url) {
        return Err(format!("not a Wordfront link: {url}"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Download the latest release (checked against the public key in tauri.conf.json),
/// install it and start it. Ok(false) when there's nothing this build can install,
/// e.g. no entry for it in latest.json yet; the game then offers the download page.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<bool, String> {
    let handle = app.clone();
    let updater = app
        .updater_builder()
        // Windows: the installer takes over and the app exits without saying goodbye
        .on_before_exit(move || {
            let _ = handle.save_window_state(StateFlags::all());
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    // macOS and Linux: the new version is in place; start it
    let _ = app.save_window_state(StateFlags::all());
    app.restart();
}

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<(), String> {
    let full = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!full).map_err(|e| e.to_string())
}

/// The default 540x940 window is taller than many laptop screens: shrink it, keeping its
/// shape, to fit the monitor's work area (taskbar excluded), and centre it.
fn fit_to_screen(win: &WebviewWindow) {
    let (Ok(Some(mon)), Ok(outer), Ok(inner)) = (win.current_monitor(), win.outer_size(), win.inner_size()) else {
        return;
    };
    let area = mon.work_area().size;
    let (max_w, max_h) = (f64::from(area.width) * 0.95, f64::from(area.height) * 0.95);
    if f64::from(outer.width) <= max_w && f64::from(outer.height) <= max_h {
        return;
    }
    // the title bar and borders don't shrink
    // (saturating: some window managers report an outer size no bigger than the inner one)
    let deco_w = f64::from(outer.width.saturating_sub(inner.width));
    let deco_h = f64::from(outer.height.saturating_sub(inner.height));
    let k = ((max_w - deco_w) / f64::from(inner.width)).min((max_h - deco_h) / f64::from(inner.height));
    if !(k.is_finite() && k > 0.0 && k < 1.0) {
        return;
    }
    let size = PhysicalSize::new((f64::from(inner.width) * k) as u32, (f64::from(inner.height) * k) as u32);
    let _ = win.set_size(size);
    let _ = win.center();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Named "Wordfront" rather than after the app identifier, so the folder
            // stays the same if the identifier ever changes.
            let dir = app.path().data_dir().map(|d| d.join("Wordfront")).map_err(|e| e.to_string());
            let _ = DATA_DIR.set(dir);
            // after the window-state plugin has put back the last size and position
            if let Some(win) = app.get_webview_window("main") {
                if !win.is_fullscreen().unwrap_or(false) {
                    fit_to_screen(&win);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_save,
            write_save,
            append_log,
            prune_logs,
            log_ends,
            quit,
            open_link,
            toggle_fullscreen,
            install_update
        ])
        .on_window_event(|window, event| {
            // Let the game finish its run log before closing; it calls `quit` when done.
            // If it doesn't answer (e.g. the page is broken), close anyway after a moment.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let _ = window.emit("wf-close-requested", ());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    save_and_exit(&app);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Wordfront");
}

#[cfg(test)]
mod tests {
    use super::{allowed_link, safe_log_name};

    #[test]
    fn links() {
        assert!(allowed_link("https://github.com/rdpharr/wordfront"));
        assert!(allowed_link("https://github.com/rdpharr/wordfront/releases/latest"));
        assert!(allowed_link("https://github.com/rdpharr/wordfront/issues/new?body=Wordfront%200.1.0"));
        assert!(allowed_link("https://buymeacoffee.com/rdpharr"));
        assert!(allowed_link("https://rdpharr.github.io/wordfront/"));
        assert!(!allowed_link("https://github.com/rdpharr/wordfront.evil.example"));
        assert!(!allowed_link("https://github.com/rdpharr/wordfrontx"));
        assert!(!allowed_link("https://evil.example/https://github.com/rdpharr/wordfront"));
        assert!(!allowed_link("http://github.com/rdpharr/wordfront"));
        assert!(!allowed_link("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed_link("https://github.com/rdpharr/wordfront/ x"));
    }

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
