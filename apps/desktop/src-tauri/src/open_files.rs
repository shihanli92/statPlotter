//! Files the operating system asks the app to open (roadmap 41): a double-click on a project,
//! "Open with" on a data file, a file dropped on the Dock icon. macOS sends them as an event
//! (`RunEvent::Opened`, at launch and while running); Windows starts the app with the paths as
//! arguments, and a second launch hands its arguments to the running app (single instance).
//!
//! The paths wait here until the webview takes them (`take_opened_files`): at start, once the
//! app is ready, and whenever the `opened-files` event says more arrived. Only the kinds the app
//! opens are kept. The webview reads each one through `read_opened_file`, once: the shell reads
//! it and hands the bytes over, so these files never enter the file-system plugin's scope (which
//! would let the webview write, rename or remove them; code audit 2, decision 656).
//!
//! Open recent reads a remembered project the same way (`read_project`): read-only, `.psproj`
//! files only. Saving goes through `save_project_file` (save.rs).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Extensions the app opens from the operating system: projects, the library's presets and
/// styles, and data files (through the import dialogs).
pub const OPENED_EXTENSIONS: &[&str] = &[
    "psproj", "pspreset", "psstyle", "pzfx", "csv", "tsv", "txt", "xlsx",
];

/// The event telling the webview that files are waiting.
pub const OPENED_EVENT: &str = "opened-files";

/// Whether the app opens a file of this name (by its extension, ignoring case).
pub fn accepted(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            OPENED_EXTENSIONS.contains(&e.as_str())
        })
        .unwrap_or(false)
}

/// The files named by command-line arguments (Windows, Linux): the program itself and options
/// left out, relative paths resolved against the directory the app was started in, kinds the
/// app doesn't open dropped. Whether they exist is checked by the caller.
pub fn paths_from_args<I, S>(args: I, cwd: &Path) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .filter_map(|a| {
            let a = a.as_ref();
            if a.is_empty() || a.starts_with('-') {
                return None;
            }
            let p = PathBuf::from(a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            accepted(&p).then_some(p)
        })
        .collect()
}

/// The paths waiting for the webview, in the order they were asked for, and those it may still
/// read (each once).
#[derive(Default)]
pub struct OpenedFiles {
    waiting: Mutex<Vec<String>>,
    readable: Mutex<HashSet<String>>,
}

impl OpenedFiles {
    /// Adds paths (each once) and lets the webview read each of them once.
    pub fn push(&self, paths: impl IntoIterator<Item = String>) {
        let mut list = self.waiting.lock().unwrap_or_else(|e| e.into_inner());
        let mut readable = self.readable.lock().unwrap_or_else(|e| e.into_inner());
        for p in paths {
            readable.insert(p.clone());
            if !list.contains(&p) {
                list.push(p);
            }
        }
    }

    /// Takes every waiting path.
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.waiting.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// The contents of a file the system opened with the app: only a path it handed over (and
    /// not read since), of a kind the app opens, that is still a file.
    pub fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        let allowed = self
            .readable
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(path);
        if !allowed {
            return Err("not a file the system opened with the app".into());
        }
        let p = Path::new(path);
        if !accepted(p) || !p.is_file() {
            return Err("not a file the app opens".into());
        }
        std::fs::read(p).map_err(|e| e.to_string())
    }
}

/// Open recent: the contents of a remembered project file. Only absolute `.psproj` paths that
/// are files; nothing else is readable this way.
pub fn read_project(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("psproj") {
        return Err("not a project file".into());
    }
    if !path.is_file() {
        return Err("the file no longer exists".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_kinds_the_app_opens() {
        assert!(accepted(Path::new("/a/b/Study.psproj")));
        assert!(accepted(Path::new("/a/b/DATA.CSV")));
        assert!(accepted(Path::new("C:/x/y.Xlsx")));
        assert!(accepted(Path::new("look.psstyle")));
        assert!(accepted(Path::new("bars.pspreset")));
        assert!(accepted(Path::new("prism.pzfx")));
        assert!(!accepted(Path::new("/a/b/notes.docx")));
        assert!(!accepted(Path::new("/a/b/psproj")));
        assert!(!accepted(Path::new("/a/b/")));
    }

    #[test]
    fn reads_paths_from_arguments() {
        let cwd = Path::new("/home/me");
        let args = [
            "plotting-software",
            "--flag",
            "data.csv",
            "/abs/Study.psproj",
            "readme.md",
            "",
        ];
        assert_eq!(
            paths_from_args(args, cwd),
            vec![
                PathBuf::from("/home/me/data.csv"),
                PathBuf::from("/abs/Study.psproj")
            ]
        );
        assert!(paths_from_args(["app"], cwd).is_empty());
    }

    #[test]
    fn keeps_each_path_once_and_takes_them_all() {
        let files = OpenedFiles::default();
        files.push(["/a.psproj".to_string(), "/b.csv".to_string()]);
        files.push(["/a.psproj".to_string()]);
        assert_eq!(files.take(), vec!["/a.psproj", "/b.csv"]);
        assert!(files.take().is_empty());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ps-open-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn path_string(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn reads_only_the_files_the_system_opened_each_once() {
        let dir = temp_dir("opened");
        let opened = dir.join("data.csv");
        let other = dir.join("other.csv");
        std::fs::write(&opened, b"a,b\n1,2\n").unwrap();
        std::fs::write(&other, b"secret").unwrap();
        let files = OpenedFiles::default();
        files.push([path_string(&opened)]);
        // Taking the paths doesn't use up the read.
        assert_eq!(files.take(), vec![path_string(&opened)]);
        // Another file in the same folder, or a path spelled differently, isn't readable.
        assert!(files.read(&path_string(&other)).is_err());
        assert!(files
            .read(&path_string(&dir.join(".").join("data.csv")))
            .is_err());
        assert_eq!(files.read(&path_string(&opened)).unwrap(), b"a,b\n1,2\n");
        // Once only: opening it again from the system allows another read.
        assert!(files.read(&path_string(&opened)).is_err());
        files.push([path_string(&opened)]);
        assert!(files.read(&path_string(&opened)).is_ok());
    }

    #[test]
    fn never_reads_kinds_the_app_does_not_open_or_folders() {
        let dir = temp_dir("kinds");
        let notes = dir.join("notes.docx");
        std::fs::write(&notes, b"x").unwrap();
        let folder = dir.join("folder.csv");
        std::fs::create_dir_all(&folder).unwrap();
        let files = OpenedFiles::default();
        files.push([path_string(&notes), path_string(&folder)]);
        assert!(files.read(&path_string(&notes)).is_err());
        assert!(files.read(&path_string(&folder)).is_err());
        assert!(files.read(&path_string(&dir.join("missing.csv"))).is_err());
    }

    #[test]
    fn reads_remembered_project_files_only() {
        let dir = temp_dir("project");
        let project = dir.join("Study.psproj");
        std::fs::write(&project, b"PK\x03\x04").unwrap();
        assert_eq!(read_project(&project).unwrap(), b"PK\x03\x04");
        let data = dir.join("data.csv");
        std::fs::write(&data, b"x").unwrap();
        assert!(read_project(&data).is_err());
        assert!(read_project(Path::new("Study.psproj")).is_err());
        assert!(read_project(&dir.join("missing.psproj")).is_err());
        let folder = dir.join("folder.psproj");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(read_project(&folder).is_err());
    }
}
