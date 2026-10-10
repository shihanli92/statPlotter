mod clipboard;
mod open_files;
mod save;

use open_files::{OpenedFiles, OPENED_EVENT};
use tauri::ipc::Response;
use tauri::{Emitter, Manager};

/// A length in bytes from a request header.
fn length_header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<usize, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
        .ok_or_else(|| format!("missing {name}"))
}

/// Copy as vector: puts a graph on the clipboard as PDF, PNG and SVG (request body: the SVG, the
/// PNG, then the PDF, all made by the webview; the first two's lengths in the `x-svg-length` and
/// `x-png-length` headers). Returns the pasteboard's change count, which `clipboard_change_count`
/// compares with to tell whether the copy is still there.
#[tauri::command]
fn copy_graphics(request: tauri::ipc::Request<'_>) -> Result<i64, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("expected a binary payload".into());
    };
    let svg_len = length_header(&request, clipboard::SVG_LENGTH_HEADER)?;
    let png_len = length_header(&request, clipboard::PNG_LENGTH_HEADER)?;
    let payload = clipboard::split_payload(body, svg_len, png_len)?;
    let reps = clipboard::representations(&payload);
    #[cfg(target_os = "macos")]
    {
        let pb = clipboard::pasteboard::general();
        clipboard::pasteboard::write(&pb, &reps).map(|c| c as i64)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = reps;
        Err("copying as PDF is available on macOS only".into())
    }
}

/// The clipboard's change count (macOS), or -1 where there is none.
#[tauri::command]
fn clipboard_change_count() -> i64 {
    #[cfg(target_os = "macos")]
    {
        clipboard::pasteboard::change_count(&clipboard::pasteboard::general()) as i64
    }
    #[cfg(not(target_os = "macos"))]
    {
        -1
    }
}

/// Open recent: a project file the webview remembered, read after a restart (the dialog plugin
/// lets the webview read the files the user picks for the session only). Project files
/// (`.psproj`) only, read here: nothing enters the file-system plugin's scope. Saving it again
/// goes through `save_project_file`.
#[tauri::command]
fn read_project_file(path: String) -> Result<Response, String> {
    open_files::read_project(std::path::Path::new(&path)).map(Response::new)
}

/// Saves a project file atomically (see save.rs): request body = the path (UTF-8, its length in
/// the `x-path-length` header), then the file's bytes. Only absolute `.psproj` paths: the paths
/// the save dialog returned, or remembered ones (Open recent, recovered projects).
#[tauri::command]
fn save_project_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("expected a binary payload".into());
    };
    let path_len = length_header(&request, save::PATH_LENGTH_HEADER)?;
    let (path, bytes) = save::split_payload(body, path_len)?;
    save::check_path(&path)?;
    save::save_atomic(&save::Disk, &save::target_of(&path), bytes)
}

/// Files the operating system asked the app to open since the last call (roadmap 41; see
/// open_files.rs). The webview reads each through `read_opened_file`.
#[tauri::command]
fn take_opened_files(files: tauri::State<'_, OpenedFiles>) -> Vec<String> {
    files.take()
}

/// The contents of a file the operating system opened with the app (a path `take_opened_files`
/// returned), once; any other path is refused.
#[tauri::command]
fn read_opened_file(
    files: tauri::State<'_, OpenedFiles>,
    path: String,
) -> Result<Response, String> {
    files.read(&path).map(Response::new)
}

/// Whether this build checks for updates: it was built with an update key (the release workflow
/// adds `plugins.updater` with the public key when the signing secrets exist; see
/// docs/RELEASING.md). Without one the updater plugin isn't started at all.
#[tauri::command]
fn updates_supported(support: tauri::State<'_, UpdateSupport>) -> bool {
    support.0
}

struct UpdateSupport(bool);

/// The updater's public key is set in the configuration (and not empty).
fn updater_configured(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// Keeps the files asked for (those the app opens and that exist), lets the webview read each
/// once (`read_opened_file`) and tells it they are waiting.
fn files_opened<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<std::path::PathBuf>) {
    let kept: Vec<String> = paths
        .into_iter()
        .filter(|p| p.is_file() && open_files::accepted(p))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if kept.is_empty() {
        return;
    }
    app.state::<OpenedFiles>().push(kept);
    let _ = app.emit(OPENED_EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let updates = updater_configured(context.config());
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Windows and Linux: a second launch (a file opened while the app runs) hands its arguments
    // to this one and quits. Registered first, as the plugin asks.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = open_files::paths_from_args(argv, std::path::Path::new(&cwd));
            files_opened(app, paths);
        }));
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());
    if updates {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        .manage(OpenedFiles::default())
        .manage(UpdateSupport(updates))
        .setup(|app| {
            // Windows and Linux: files the app was started with.
            #[cfg(not(target_os = "macos"))]
            {
                let cwd = std::env::current_dir().unwrap_or_default();
                let paths = open_files::paths_from_args(std::env::args(), &cwd);
                files_opened(app.handle(), paths);
            }
            #[cfg(target_os = "macos")]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            save_project_file,
            copy_graphics,
            clipboard_change_count,
            take_opened_files,
            read_opened_file,
            updates_supported
        ])
        .build(context)
        .expect("error while building tauri application");
    app.run(|_app, _event| {
        // macOS: files opened from the Finder or the Dock, at launch and while running.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            files_opened(_app, paths);
        }
    });
}
