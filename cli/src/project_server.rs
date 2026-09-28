//! Installs `project-server.js`, the server `cdrca run` starts for a project
//! that owns its page (see `project_layout.rs`), next to the project's CDRCA
//! runtime.
//!
//! It is written on every `cdrca run` rather than once at install time, so a
//! newer CLI always brings its own matching server, and it works whichever
//! way the runtime got there (the bundled copy or the published package).

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

/// The server's source, embedded at compile time.
pub const PROJECT_SERVER_JS: &str = include_str!("templates/cdrca-runtime/project-server.js");

/// Where it is installed, relative to the project root.
pub const INSTALL_PATH: &str = "node_modules/cdrca/project-server.js";

/// Write the server into `<project_root>/node_modules/cdrca/`. Returns its
/// path. Fails (with a message saying what to run) if the runtime it is
/// installed alongside isn't there, because the server loads the compiler and
/// the browser scripts from that folder.
pub fn install(project_root: &Path) -> Result<PathBuf> {
    let runtime = project_root.join("node_modules/cdrca");
    let compiler = runtime.join("Back-end/Transpiler/index.js");
    if !compiler.is_file() {
        bail!(
            "CDRCA runtime not found at {} — run 'cdrca create app' or 'cdrca install cdrca' first",
            runtime.display()
        );
    }
    let target = project_root.join(INSTALL_PATH);
    let unchanged = std::fs::read_to_string(&target)
        .map(|existing| existing == PROJECT_SERVER_JS)
        .unwrap_or(false);
    if !unchanged {
        std::fs::write(&target, PROJECT_SERVER_JS)
            .with_context(|| format!("writing {}", target.display()))?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_runtime(root: &Path) {
        let dir = root.join("node_modules/cdrca/Back-end/Transpiler");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.js"), "").unwrap();
    }

    #[test]
    fn the_embedded_server_is_the_real_one() {
        assert!(PROJECT_SERVER_JS.contains("function createServer"));
        assert!(PROJECT_SERVER_JS.contains("CDRCA_PROJECT"));
        assert!(PROJECT_SERVER_JS.contains("CDRCA_PORT"));
    }

    #[test]
    fn installs_next_to_the_runtime() {
        let dir = tempfile::tempdir().unwrap();
        fake_runtime(dir.path());
        let path = install(dir.path()).unwrap();
        assert_eq!(path, dir.path().join(INSTALL_PATH));
        assert_eq!(std::fs::read_to_string(path).unwrap(), PROJECT_SERVER_JS);
    }

    #[test]
    fn replaces_an_out_of_date_copy_and_leaves_a_current_one_alone() {
        let dir = tempfile::tempdir().unwrap();
        fake_runtime(dir.path());
        let target = dir.path().join(INSTALL_PATH);
        std::fs::write(&target, "// old server").unwrap();
        install(dir.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), PROJECT_SERVER_JS);
        let before = std::fs::metadata(&target).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        install(dir.path()).unwrap();
        assert_eq!(std::fs::metadata(&target).unwrap().modified().unwrap(), before, "unchanged file must not be rewritten");
    }

    #[test]
    fn without_a_runtime_it_says_what_to_run() {
        let dir = tempfile::tempdir().unwrap();
        let err = install(dir.path()).unwrap_err().to_string();
        assert!(err.contains("CDRCA runtime not found"), "{err}");
        assert!(err.contains("cdrca install cdrca"), "{err}");
        assert!(!dir.path().join(INSTALL_PATH).exists(), "must not create a stray file");
    }
}
