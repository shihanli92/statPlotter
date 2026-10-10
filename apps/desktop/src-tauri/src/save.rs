//! Atomic project save (roadmap 25): the new contents are written next to the file as
//! `name.psproj.tmp`, flushed to disk and read back; the previous version is kept as
//! `name.psproj.bak`; then the temporary file is renamed over the original, which is atomic on
//! the same volume. At every step either the old file or the new one is at the path: a failure
//! (disk full, permissions, a read-back that differs) leaves the original untouched and removes
//! the temporary file.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Request header carrying the length of the UTF-8 path that precedes the file's bytes.
pub const PATH_LENGTH_HEADER: &str = "x-path-length";

/// The file-system operations a save uses, so tests can make any of them fail.
pub trait Ops {
    /// Creates or truncates `path`, writes `bytes` and flushes them to the disk.
    fn write_synced(&self, path: &Path, bytes: &[u8]) -> io::Result<()>;
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn exists(&self, path: &Path) -> bool;
    fn remove(&self, path: &Path) -> io::Result<()>;
    fn hard_link(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn copy(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// Gives `to` the permissions of `from` (best effort).
    fn copy_permissions(&self, from: &Path, to: &Path);
    /// Replaces `to` by `from` in one step.
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// Makes the rename itself durable (best effort).
    fn sync_dir(&self, dir: &Path);
}

/// The real file system.
pub struct Disk;

impl Ops for Disk {
    fn write_synced(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        let mut f = std::fs::File::create(path)?;
        f.write_all(bytes)?;
        f.sync_all()
    }
    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(path)
    }
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
    fn remove(&self, path: &Path) -> io::Result<()> {
        std::fs::remove_file(path)
    }
    fn hard_link(&self, from: &Path, to: &Path) -> io::Result<()> {
        std::fs::hard_link(from, to)
    }
    fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        std::fs::copy(from, to).map(|_| ())
    }
    fn copy_permissions(&self, from: &Path, to: &Path) {
        if let Ok(meta) = std::fs::metadata(from) {
            let _ = std::fs::set_permissions(to, meta.permissions());
        }
    }
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        std::fs::rename(from, to)
    }
    fn sync_dir(&self, dir: &Path) {
        #[cfg(unix)]
        if let Ok(d) = std::fs::File::open(dir) {
            let _ = d.sync_all();
        }
        #[cfg(not(unix))]
        let _ = dir;
    }
}

/// `path` with `suffix` added to its file name (`a.psproj` → `a.psproj.tmp`).
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Only absolute paths of project files are written.
pub fn check_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("psproj") {
        return Err("not a project file path".into());
    }
    if path.is_dir() {
        return Err("a folder has that name".into());
    }
    Ok(())
}

/// Saves `bytes` to `path` atomically, keeping the previous version as `path.bak`.
pub fn save_atomic(ops: &impl Ops, path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = sibling(path, ".tmp");
    let bak = sibling(path, ".bak");
    let fail = |what: String| {
        let _ = ops.remove(&tmp);
        Err(format!("{what}; {name} was not changed"))
    };

    // 1. The new contents, on disk and read back unchanged.
    if let Err(e) = ops.write_synced(&tmp, bytes) {
        return fail(format!("couldn't write {}: {e}", tmp.display()));
    }
    match ops.read(&tmp) {
        Ok(back) if back == bytes => {}
        Ok(_) => return fail("the file written didn't read back the same".into()),
        Err(e) => return fail(format!("couldn't read back {}: {e}", tmp.display())),
    }

    // 2. The previous version as .bak (a hard link to it, else a copy); the original stays.
    if ops.exists(path) {
        ops.copy_permissions(path, &tmp);
        if ops.exists(&bak) {
            if let Err(e) = ops.remove(&bak) {
                return fail(format!(
                    "couldn't replace the old backup {}: {e}",
                    bak.display()
                ));
            }
        }
        if ops.hard_link(path, &bak).is_err() {
            if let Err(e) = ops.copy(path, &bak) {
                return fail(format!(
                    "couldn't keep the previous version as {}: {e}",
                    bak.display()
                ));
            }
        }
    }

    // 3. The new file replaces the old one in one step.
    if let Err(e) = ops.rename(&tmp, path) {
        return fail(format!("couldn't replace the file: {e}"));
    }
    if let Some(dir) = path.parent() {
        ops.sync_dir(dir);
    }
    Ok(())
}

/// The file a save writes to: through a symbolic link to the file it points at, so the link
/// stays a link.
pub fn target_of(path: &Path) -> PathBuf {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }
        _ => path.to_path_buf(),
    }
}

/// Splits a request body into the path and the file's bytes.
pub fn split_payload(body: &[u8], path_len: usize) -> Result<(PathBuf, &[u8]), String> {
    if path_len > body.len() {
        return Err("save payload shorter than its path".into());
    }
    let (path, bytes) = body.split_at(path_len);
    let path = std::str::from_utf8(path).map_err(|_| "the path is not UTF-8".to_string())?;
    Ok((PathBuf::from(path), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ps-save-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The real file system with one operation failing.
    #[derive(Default)]
    struct Failing {
        write: bool,
        read_differs: bool,
        remove_bak: bool,
        link: bool,
        copy: bool,
        rename: bool,
        renamed: Cell<bool>,
    }

    fn io_err() -> io::Result<()> {
        Err(io::Error::other("injected"))
    }

    impl Ops for Failing {
        fn write_synced(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
            if self.write {
                // A partial write, then the error (disk full).
                std::fs::write(path, &bytes[..bytes.len() / 2])?;
                return io_err();
            }
            Disk.write_synced(path, bytes)
        }
        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            let mut v = Disk.read(path)?;
            if self.read_differs {
                v[0] ^= 1;
            }
            Ok(v)
        }
        fn exists(&self, path: &Path) -> bool {
            Disk.exists(path)
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            if self.remove_bak && path.to_string_lossy().ends_with(".bak") {
                return io_err();
            }
            Disk.remove(path)
        }
        fn hard_link(&self, from: &Path, to: &Path) -> io::Result<()> {
            if self.link {
                return io_err();
            }
            Disk.hard_link(from, to)
        }
        fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
            if self.copy {
                return io_err();
            }
            Disk.copy(from, to)
        }
        fn copy_permissions(&self, from: &Path, to: &Path) {
            Disk.copy_permissions(from, to)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            if self.rename {
                return io_err();
            }
            self.renamed.set(true);
            Disk.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) {
            Disk.sync_dir(dir)
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn writes_a_new_file_without_a_backup() {
        let dir = temp_dir("new");
        let file = dir.join("a.psproj");
        save_atomic(&Disk, &file, b"one").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"one");
        assert_eq!(names(&dir), ["a.psproj"]);
    }

    #[test]
    fn keeps_the_previous_version_as_bak_replacing_an_older_one() {
        let dir = temp_dir("bak");
        let file = dir.join("a.psproj");
        save_atomic(&Disk, &file, b"one").unwrap();
        save_atomic(&Disk, &file, b"two").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"two");
        assert_eq!(std::fs::read(dir.join("a.psproj.bak")).unwrap(), b"one");
        save_atomic(&Disk, &file, b"three").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"three");
        assert_eq!(std::fs::read(dir.join("a.psproj.bak")).unwrap(), b"two");
        assert_eq!(names(&dir), ["a.psproj", "a.psproj.bak"]);
    }

    #[test]
    fn copies_the_backup_where_hard_links_fail() {
        let dir = temp_dir("copy");
        let file = dir.join("a.psproj");
        std::fs::write(&file, b"old").unwrap();
        let ops = Failing {
            link: true,
            ..Default::default()
        };
        save_atomic(&ops, &file, b"new").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
        assert_eq!(std::fs::read(dir.join("a.psproj.bak")).unwrap(), b"old");
    }

    #[test]
    fn a_failure_at_any_step_leaves_the_original_and_no_temporary_file() {
        let cases: Vec<(&str, Failing)> = vec![
            (
                "write",
                Failing {
                    write: true,
                    ..Default::default()
                },
            ),
            (
                "read back",
                Failing {
                    read_differs: true,
                    ..Default::default()
                },
            ),
            (
                "old backup",
                Failing {
                    remove_bak: true,
                    ..Default::default()
                },
            ),
            (
                "backup",
                Failing {
                    link: true,
                    copy: true,
                    ..Default::default()
                },
            ),
            (
                "rename",
                Failing {
                    rename: true,
                    ..Default::default()
                },
            ),
        ];
        for (what, ops) in cases {
            let dir = temp_dir(&what.replace(' ', "-"));
            let file = dir.join("a.psproj");
            std::fs::write(&file, b"old").unwrap();
            std::fs::write(dir.join("a.psproj.bak"), b"older").unwrap();
            let err = save_atomic(&ops, &file, b"new contents").unwrap_err();
            assert!(err.ends_with("a.psproj was not changed"), "{what}: {err}");
            assert_eq!(std::fs::read(&file).unwrap(), b"old", "{what}");
            assert!(
                !dir.join("a.psproj.tmp").exists(),
                "{what}: temporary file left"
            );
            assert!(!ops.renamed.get() || what == "rename", "{what}");
        }
    }

    #[test]
    fn a_failed_first_save_leaves_nothing() {
        let dir = temp_dir("first");
        let file = dir.join("a.psproj");
        let ops = Failing {
            write: true,
            ..Default::default()
        };
        assert!(save_atomic(&ops, &file, b"new").is_err());
        assert!(names(&dir).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn saves_through_a_symbolic_link() {
        let dir = temp_dir("link");
        let real = dir.join("real.psproj");
        let link = dir.join("link.psproj");
        std::fs::write(&real, b"old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        save_atomic(&Disk, &target_of(&link), b"new").unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(&link).unwrap(), b"new");
    }

    #[test]
    fn checks_paths_and_splits_the_payload() {
        assert!(check_path(Path::new("relative.psproj")).is_err());
        assert!(check_path(&std::env::temp_dir().join("x.txt")).is_err());
        assert!(check_path(&std::env::temp_dir().join("x.psproj")).is_ok());
        let body = b"/tmp/a.psprojPK\x03\x04";
        let (path, bytes) = split_payload(body, 13).unwrap();
        assert_eq!(path, PathBuf::from("/tmp/a.psproj"));
        assert_eq!(bytes, b"PK\x03\x04");
        assert!(split_payload(body, 99).is_err());
    }
}
