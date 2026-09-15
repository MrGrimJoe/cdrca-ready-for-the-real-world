//! Wires an installed `type: "library"` package into a project — the
//! third package-type gap alongside `plugin_stage.rs` (plugins) and
//! `package_stage.rs` (`.cdrca` source packages).
//!
//! Unlike a plugin's OWN declared `libraries` (staged by
//! `plugin_stage.rs` right next to the plugin itself), a `type: "library"`
//! package is a fully independent, separately-published package that
//! extends someone else's (or its own author's) plugin via `providesFor`
//! — see manifest.rs's `ProvidesFor` and PLUGIN-LIBRARIES.md. It has no
//! natural home next to the plugin it targets (that plugin might not
//! even be installed by the same person), so it needs its own staging
//! area and its own index file — `libraries.json`, the direct counterpart
//! to `plugins.json`.
//!
//! `plugin_frontend_patch.rs` reads this index at scan time: for a
//! `@useLib <plugin>.<library>` directive that isn't satisfied by the
//! target plugin's own declared `libraries` map, it falls back to
//! checking every entry here for a `providesFor` match — this is the
//! piece that makes "publish a library extending someone else's plugin,
//! with zero coordination from that plugin's author" actually work.

use crate::manifest::Manifest;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The same directory as `LIBRARIES_DIR_REL`, but relative to
/// `Front-end/index.html` rather than the project root — what
/// `plugin_frontend_patch.rs` actually writes into a `<script src="...">`
/// tag. `LIBRARIES_DIR_REL` below must always end with this exact
/// string — `library_dir_rel_ends_with_browser_prefix` in this file's
/// own tests checks that on every `cargo test`, so an edit to one that
/// forgets the other fails immediately instead of silently drifting.
pub const BROWSER_REL_PATH_PREFIX: &str = "Transpiler-Plugins/_libraries";
const LIBRARIES_DIR_REL: &str = "node_modules/cdrca/Front-end/Transpiler-Plugins/_libraries";
const LIBRARIES_JSON_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins/libraries.json";

#[derive(Debug, PartialEq, Eq)]
pub enum LibraryStageOutcome {
    /// Entry file staged and a fresh libraries.json entry added.
    Applied,
    /// A libraries.json entry for this package already existed; the
    /// bundle file was refreshed in place but libraries.json itself
    /// wasn't rewritten.
    AlreadyStaged,
    /// `node_modules/cdrca` isn't there — `npm install cdrca` must not
    /// have completed.
    CdrcaNotFound(PathBuf),
    /// The manifest's declared `entry` file doesn't exist in the
    /// downloaded/unpacked package directory.
    EntryFileNotFound(PathBuf),
    /// Reached only if a manifest with `provides_for: None` somehow gets
    /// here — `Manifest::validate()` is supposed to reject this before
    /// install ever calls this function, so this indicates that
    /// validation was skipped, not a normal runtime outcome.
    MissingProvidesFor,
}

impl LibraryStageOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, LibraryStageOutcome::Applied | LibraryStageOutcome::AlreadyStaged)
    }
}

/// `package_dir` is the local store directory this library package was
/// just unpacked into.
pub fn stage_library(
    project_root: &Path,
    package_dir: &Path,
    manifest: &Manifest,
) -> Result<LibraryStageOutcome> {
    let Some(provides_for) = &manifest.provides_for else {
        return Ok(LibraryStageOutcome::MissingProvidesFor);
    };

    let cdrca_root = project_root.join("node_modules/cdrca");
    if !cdrca_root.is_dir() {
        return Ok(LibraryStageOutcome::CdrcaNotFound(cdrca_root));
    }

    let entry_src = package_dir.join(&manifest.entry);
    if !entry_src.is_file() {
        return Ok(LibraryStageOutcome::EntryFileNotFound(entry_src));
    }

    let staged_dir = project_root.join(LIBRARIES_DIR_REL).join(&manifest.name);
    std::fs::create_dir_all(&staged_dir)
        .with_context(|| format!("creating {}", staged_dir.display()))?;
    let filename = Path::new(&manifest.entry)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "bundle.js".to_string());
    let staged_file = staged_dir.join(&filename);
    std::fs::copy(&entry_src, &staged_file).with_context(|| {
        format!("copying {} to {}", entry_src.display(), staged_file.display())
    })?;

    let libraries_json_path = project_root.join(LIBRARIES_JSON_REL);
    let mut entries: Vec<Value> = if libraries_json_path.is_file() {
        let raw = std::fs::read_to_string(&libraries_json_path)
            .with_context(|| format!("reading {}", libraries_json_path.display()))?;
        serde_json::from_str(&raw)
            .with_context(|| format!("parsing {}", libraries_json_path.display()))?
    } else {
        Vec::new()
    };

    let already_present = entries
        .iter()
        .any(|e| e.get("name").and_then(Value::as_str) == Some(manifest.name.as_str()));

    if !already_present {
        entries.push(json!({
            "name": manifest.name,
            "providesFor": {
                "plugin": provides_for.plugin,
                "library": provides_for.library,
            },
            // Relative to LIBRARIES_DIR_REL — what plugin_frontend_patch.rs
            // actually reads bytes from and what the <script> tag's src
            // resolves to.
            "path": format!("{}/{filename}", manifest.name),
        }));
        let raw = serde_json::to_string_pretty(&entries)?;
        if let Some(parent) = libraries_json_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::write(&libraries_json_path, raw)
            .with_context(|| format!("writing {}", libraries_json_path.display()))?;
    }

    Ok(if already_present {
        LibraryStageOutcome::AlreadyStaged
    } else {
        LibraryStageOutcome::Applied
    })
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `plugin_stage.rs::report_outcome()`. Callers still continue.
pub fn report_outcome(name: &str, outcome: &LibraryStageOutcome) {
    match outcome {
        LibraryStageOutcome::Applied => {
            println!("Staged library \"{name}\" into this project.");
        }
        LibraryStageOutcome::AlreadyStaged => {
            // Expected steady state — nothing to report.
        }
        LibraryStageOutcome::CdrcaNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: library \"{name}\" could NOT be staged ***");
            eprintln!("Expected directory not found: {}", path.display());
            eprintln!("This usually means 'npm install cdrca' did not complete successfully.");
            eprintln!();
        }
        LibraryStageOutcome::EntryFileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: library \"{name}\" could NOT be staged ***");
            eprintln!(
                "This package's manifest declares its entry file at {}, but that file doesn't \
                 exist in the downloaded package — the package may be malformed.",
                path.display()
            );
            eprintln!();
        }
        LibraryStageOutcome::MissingProvidesFor => {
            eprintln!();
            eprintln!("*** WARNING: library \"{name}\" could NOT be staged ***");
            eprintln!(
                "This package's manifest has no 'providesFor' — Manifest::validate() should \
                 have rejected this before install; something called stage_library() without \
                 validating first."
            );
            eprintln!();
        }
    }
}

/// One resolved entry from `libraries.json`, read back by
/// `plugin_frontend_patch.rs`.
#[derive(Debug, Clone)]
pub struct StagedLibrary {
    pub name: String,
    pub plugin: String,
    pub library: String,
    /// Relative to `LIBRARIES_DIR_REL`.
    pub rel_path: String,
}

/// Reads `libraries.json` back, for `plugin_frontend_patch.rs`'s fallback
/// resolution step. Missing file is just "no libraries installed yet",
/// not an error.
pub fn read_staged_libraries(project_root: &Path) -> Result<Vec<StagedLibrary>> {
    let libraries_json_path = project_root.join(LIBRARIES_JSON_REL);
    if !libraries_json_path.is_file() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&libraries_json_path)
        .with_context(|| format!("reading {}", libraries_json_path.display()))?;
    let entries: Vec<Value> = serde_json::from_str(&raw)
        .with_context(|| format!("parsing {}", libraries_json_path.display()))?;

    let mut out = Vec::new();
    for e in entries {
        let name = e.get("name").and_then(Value::as_str);
        let plugin = e.pointer("/providesFor/plugin").and_then(Value::as_str);
        let library = e.pointer("/providesFor/library").and_then(Value::as_str);
        let rel_path = e.get("path").and_then(Value::as_str);
        let (Some(name), Some(plugin), Some(library), Some(rel_path)) = (name, plugin, library, rel_path) else {
            bail!("malformed entry in {}: {e}", libraries_json_path.display());
        };
        out.push(StagedLibrary {
            name: name.to_string(),
            plugin: plugin.to_string(),
            library: library.to_string(),
            rel_path: rel_path.to_string(),
        });
    }
    Ok(out)
}

/// Absolute path to a staged library's directory — `plugin_frontend_patch.rs`
/// reads the actual bytes from here.
pub fn staged_library_dir(project_root: &Path) -> PathBuf {
    project_root.join(LIBRARIES_DIR_REL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{PackageType, ProvidesFor};
    use std::collections::HashMap;

    fn fake_manifest(name: &str, plugin: &str, library: &str) -> Manifest {
        Manifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: "test library".to_string(),
            package_type: PackageType::Library,
            entry: "dist/bundle.js".to_string(),
            icon: "icon.png".to_string(),
            author: "tester".to_string(),
            license: "IOSL".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: Vec::new(),
            libraries: HashMap::new(),
            provides_for: Some(ProvidesFor {
                plugin: plugin.to_string(),
                library: library.to_string(),
            }),
        }
    }

    fn fake_project(dir: &Path) {
        std::fs::create_dir_all(dir.join("node_modules/cdrca")).unwrap();
    }

    fn fake_package(dir: &Path) -> PathBuf {
        let pkg_dir = dir.join("pkg-store/quark-icons/1.0.0/dist");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        std::fs::write(pkg_dir.join("bundle.js"), "/* icons */").unwrap();
        dir.join("pkg-store/quark-icons/1.0.0")
    }

    #[test]
    fn stages_and_indexes_a_fresh_library() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path());
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("quark-icons", "quark", "icons");

        let outcome = stage_library(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, LibraryStageOutcome::Applied);

        let staged = staged_library_dir(dir.path()).join("quark-icons/bundle.js");
        assert!(staged.is_file());

        let libs = read_staged_libraries(dir.path()).unwrap();
        assert_eq!(libs.len(), 1);
        assert_eq!(libs[0].plugin, "quark");
        assert_eq!(libs[0].library, "icons");
        assert_eq!(libs[0].rel_path, "quark-icons/bundle.js");
    }

    #[test]
    fn re_staging_refreshes_without_duplicating_index_entry() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path());
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("quark-icons", "quark", "icons");

        stage_library(dir.path(), &pkg_dir, &manifest).unwrap();
        let outcome = stage_library(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, LibraryStageOutcome::AlreadyStaged);

        let libs = read_staged_libraries(dir.path()).unwrap();
        assert_eq!(libs.len(), 1);
    }

    #[test]
    fn missing_provides_for_is_reported_not_panicked() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path());
        let pkg_dir = fake_package(dir.path());
        let mut manifest = fake_manifest("quark-icons", "quark", "icons");
        manifest.provides_for = None;

        let outcome = stage_library(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, LibraryStageOutcome::MissingProvidesFor);
    }

    #[test]
    fn no_libraries_json_yet_reads_as_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let libs = read_staged_libraries(dir.path()).unwrap();
        assert!(libs.is_empty());
    }

    #[test]
    fn library_dir_rel_ends_with_browser_prefix() {
        // See BROWSER_REL_PATH_PREFIX's doc comment — this is what
        // actually enforces the two constants can't silently drift apart.
        assert!(LIBRARIES_DIR_REL.ends_with(BROWSER_REL_PATH_PREFIX));
    }
}
