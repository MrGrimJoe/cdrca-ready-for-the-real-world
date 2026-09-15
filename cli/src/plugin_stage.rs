//! Wires an installed ecosystem plugin package into a project's local
//! CDRCA copy — the step `cdrca install <plugin>` was missing entirely.
//!
//! Verified bug (see docs/REACTIVE-STATE.md, bug #4): `install.rs`
//! downloads a plugin package, verifies its checksum, unpacks it into the
//! local package store, and records it in the lockfile — but never
//! copies its entry file into `Plugins/<name>/plugin.js`, and never adds
//! an entry to `plugins.json`. The package sits on disk, fully verified
//! and locked, but CDRCA's `plugin.js` host never loads it — indistinguishable
//! from "not installed" from the transpiler's point of view.
//!
//! This is deliberately generic — NOT Quark-specific (Quark is staged by
//! `quark_patch.rs`, since it ships built into the CLI rather than through
//! the registry). Any ecosystem plugin — this repo's own
//! `cdrca-reactive-state`, or a third-party one — goes through this same
//! path once it's downloaded, matching how `quark_patch.rs` stages Quark's
//! own files: idempotent (safe to re-run), loud on a missing plugin-hook
//! system rather than a silent no-op.

use crate::manifest::Manifest;
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const PLUGINS_DIR_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins";
const PLUGIN_LOADER_REL: &str = "node_modules/cdrca/Back-end/Transpiler/plugin.js";
const PLUGINS_JSON_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins/plugins.json";

#[derive(Debug, PartialEq, Eq)]
pub enum PluginStageOutcome {
    /// Entry file staged and a fresh plugins.json entry added.
    Applied,
    /// A plugins.json entry for this plugin already existed; the entry
    /// file was refreshed in place (kept in sync with whatever's in the
    /// local package store) but plugins.json itself wasn't rewritten.
    AlreadyStaged,
    /// Staged, but this project's local CDRCA copy predates the
    /// plugin-hook system entirely — inert until the copy is updated.
    /// Same category as `QuarkPatchOutcome::PluginSystemNotPresent`.
    PluginSystemNotPresent,
    /// `node_modules/cdrca` isn't there — `npm install cdrca` must not
    /// have completed.
    CdrcaNotFound(PathBuf),
    /// The manifest's declared `entry` file doesn't exist in the
    /// downloaded/unpacked package directory.
    EntryFileNotFound(PathBuf),
}

impl PluginStageOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(
            self,
            PluginStageOutcome::Applied | PluginStageOutcome::AlreadyStaged
        )
    }
}

/// `package_dir` is the local store directory a plugin package was just
/// unpacked into (what `Store::install_from_tarball`/`Store::package_dir`
/// returns) — this is where `manifest.entry` is resolved relative to, NOT
/// the project root.
pub fn stage_plugin(
    project_root: &Path,
    package_dir: &Path,
    manifest: &Manifest,
) -> Result<PluginStageOutcome> {
    let cdrca_root = project_root.join("node_modules/cdrca");
    if !cdrca_root.is_dir() {
        return Ok(PluginStageOutcome::CdrcaNotFound(cdrca_root));
    }

    let entry_src = package_dir.join(&manifest.entry);
    if !entry_src.is_file() {
        return Ok(PluginStageOutcome::EntryFileNotFound(entry_src));
    }

    let plugin_system_present = project_root.join(PLUGIN_LOADER_REL).is_file();

    let staged_dir = project_root
        .join(PLUGINS_DIR_REL)
        .join(&manifest.name);
    std::fs::create_dir_all(&staged_dir)
        .with_context(|| format!("creating {}", staged_dir.display()))?;
    std::fs::copy(&entry_src, staged_dir.join("plugin.js")).with_context(|| {
        format!(
            "copying {} to {}",
            entry_src.display(),
            staged_dir.join("plugin.js").display()
        )
    })?;
    // Also stage the plugin's own manifest alongside its entry file — NOT
    // read by CDRCA's `plugin.js` host (which only ever wants plugin.js
    // itself), but read back later by `plugin_frontend_patch.rs`: a
    // `@useLib <thisPlugin>.<name>` directive resolves against this
    // plugin's declared `libraries` map first (see manifest.rs), and that
    // map has to be discoverable on disk without re-fetching from the
    // registry every time a project's frontend gets re-scanned.
    let manifest_json = serde_json::to_string_pretty(manifest)?;
    std::fs::write(staged_dir.join("cdrca.json"), manifest_json)
        .context("writing staged plugin's cdrca.json")?;

    // Also stage every bundle this plugin declares itself under
    // `libraries` (paths relative to the plugin's own package root) —
    // `plugin_frontend_patch.rs` resolves a `@useLib <thisPlugin>.<name>`
    // directive against the co-staged `cdrca.json` above, but the actual
    // FILE has to be here too, or resolution would succeed while staging
    // the real bundle silently failed.
    for (library_name, rel_path) in &manifest.libraries {
        let lib_src = package_dir.join(rel_path);
        if !lib_src.is_file() {
            // Declared but missing — same "loud, not silent" policy as
            // EntryFileNotFound, but this alone shouldn't fail staging
            // the plugin itself (its OWN hook may be perfectly fine even
            // if one declared bundle is broken) — report and continue.
            eprintln!();
            eprintln!(
                "*** WARNING: plugin \"{}\"'s declared library \"{library_name}\" could NOT be staged ***",
                manifest.name
            );
            eprintln!(
                "Manifest declares libraries.{library_name} = \"{}\", but that file doesn't \
                 exist in the downloaded package.",
                rel_path
            );
            eprintln!();
            continue;
        }
        let lib_dst = staged_dir.join(rel_path);
        if let Some(parent) = lib_dst.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::copy(&lib_src, &lib_dst)
            .with_context(|| format!("copying {} to {}", lib_src.display(), lib_dst.display()))?;
    }

    let plugins_json_path = project_root.join(PLUGINS_JSON_REL);
    let mut entries: Vec<Value> = if plugins_json_path.is_file() {
        let raw = std::fs::read_to_string(&plugins_json_path)
            .with_context(|| format!("reading {}", plugins_json_path.display()))?;
        serde_json::from_str(&raw)
            .with_context(|| format!("parsing {}", plugins_json_path.display()))?
    } else {
        Vec::new()
    };

    let already_present = entries
        .iter()
        .any(|e| e.get("name").and_then(Value::as_str) == Some(manifest.name.as_str()));

    if !already_present {
        entries.push(json!({
            "name": manifest.name,
            "path": format!("{}/plugin.js", manifest.name),
            "uses": manifest.uses,
            "permissions": manifest.permissions,
        }));
        let raw = serde_json::to_string_pretty(&entries)?;
        std::fs::write(&plugins_json_path, raw)
            .with_context(|| format!("writing {}", plugins_json_path.display()))?;
    }

    if !plugin_system_present {
        return Ok(PluginStageOutcome::PluginSystemNotPresent);
    }

    Ok(if already_present {
        PluginStageOutcome::AlreadyStaged
    } else {
        PluginStageOutcome::Applied
    })
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `quark_patch.rs::report_quark_outcome()`. Callers still continue.
pub fn report_outcome(name: &str, outcome: &PluginStageOutcome) {
    match outcome {
        PluginStageOutcome::Applied => {
            println!("Staged plugin \"{name}\" into this project (Plugins/{name}/plugin.js).");
        }
        PluginStageOutcome::AlreadyStaged => {
            // Expected steady state — nothing to report.
        }
        PluginStageOutcome::PluginSystemNotPresent => {
            eprintln!();
            eprintln!("*** WARNING: plugin \"{name}\" staged, but is NOT active yet ***");
            eprintln!(
                "This project's local CDRCA copy (node_modules/cdrca) doesn't have the \
                 plugin-hook system this plugin depends on (Back-end/Transpiler/plugin.js) — \
                 re-run 'cdrca install cdrca' once this project's CDRCA copy is updated to a \
                 version that includes it."
            );
            eprintln!();
        }
        PluginStageOutcome::CdrcaNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: plugin \"{name}\" could NOT be staged ***");
            eprintln!("Expected directory not found: {}", path.display());
            eprintln!("This usually means 'npm install cdrca' did not complete successfully.");
            eprintln!();
        }
        PluginStageOutcome::EntryFileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: plugin \"{name}\" could NOT be staged ***");
            eprintln!(
                "This package's manifest declares its entry file at {}, but that file doesn't \
                 exist in the downloaded package — the package may be malformed.",
                path.display()
            );
            eprintln!();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::PackageType;
    use std::collections::HashMap;

    fn fake_manifest(name: &str) -> Manifest {
        Manifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: "test plugin".to_string(),
            package_type: PackageType::Plugin,
            entry: "plugin.js".to_string(),
            icon: "icon.png".to_string(),
            author: "tester".to_string(),
            license: "MIT".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: vec![("syntax".to_string(), "customRule".to_string())],
            libraries: HashMap::new(),
            provides_for: None,
        }
    }

    fn fake_project(dir: &Path, with_plugin_system: bool) {
        std::fs::create_dir_all(dir.join(PLUGINS_DIR_REL)).unwrap();
        if with_plugin_system {
            std::fs::write(dir.join(PLUGIN_LOADER_REL), "// stub host").unwrap();
        }
    }

    fn fake_package(dir: &Path) -> PathBuf {
        let pkg_dir = dir.join("pkg-store/my-plugin/1.0.0");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        std::fs::write(pkg_dir.join("plugin.js"), "module.exports = function(){};").unwrap();
        pkg_dir
    }

    #[test]
    fn stages_a_fresh_plugin() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), true);
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("my-plugin");

        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, PluginStageOutcome::Applied);

        let staged = dir
            .path()
            .join(PLUGINS_DIR_REL)
            .join("my-plugin/plugin.js");
        assert!(staged.is_file());

        let plugins_json: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join(PLUGINS_JSON_REL)).unwrap(),
        )
        .unwrap();
        assert_eq!(plugins_json[0]["name"], "my-plugin");
    }

    #[test]
    fn re_staging_refreshes_file_without_duplicating_json_entry() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), true);
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("my-plugin");

        stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, PluginStageOutcome::AlreadyStaged);

        let plugins_json: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join(PLUGINS_JSON_REL)).unwrap(),
        )
        .unwrap();
        assert_eq!(plugins_json.as_array().unwrap().len(), 1);
    }

    #[test]
    fn reports_plugin_system_not_present_but_still_stages() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), false);
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("my-plugin");

        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, PluginStageOutcome::PluginSystemNotPresent);
        assert!(!outcome.is_ok());
        assert!(dir
            .path()
            .join(PLUGINS_DIR_REL)
            .join("my-plugin/plugin.js")
            .is_file());
    }

    #[test]
    fn missing_entry_file_is_reported_not_panicked() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), true);
        let pkg_dir = dir.path().join("pkg-store/empty");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        let manifest = fake_manifest("my-plugin");

        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        match outcome {
            PluginStageOutcome::EntryFileNotFound(_) => {}
            other => panic!("expected EntryFileNotFound, got {other:?}"),
        }
    }

    #[test]
    fn cdrca_not_found_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("my-plugin");
        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        match outcome {
            PluginStageOutcome::CdrcaNotFound(_) => {}
            other => panic!("expected CdrcaNotFound, got {other:?}"),
        }
    }

    #[test]
    fn stages_declared_libraries_alongside_the_entry() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), true);
        let pkg_dir = fake_package(dir.path());
        std::fs::write(pkg_dir.join("dist-icons.js"), "/* icons bundle */").unwrap();
        let mut manifest = fake_manifest("my-plugin");
        manifest.libraries.insert("icons".to_string(), "dist-icons.js".to_string());

        stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();

        let staged_lib = dir
            .path()
            .join(PLUGINS_DIR_REL)
            .join("my-plugin/dist-icons.js");
        assert!(staged_lib.is_file());
        assert_eq!(std::fs::read_to_string(staged_lib).unwrap(), "/* icons bundle */");

        let staged_manifest: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join(PLUGINS_DIR_REL).join("my-plugin/cdrca.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(staged_manifest["libraries"]["icons"], "dist-icons.js");
    }

    #[test]
    fn missing_declared_library_warns_but_does_not_fail_staging() {
        let dir = tempfile::tempdir().unwrap();
        fake_project(dir.path(), true);
        let pkg_dir = fake_package(dir.path());
        let mut manifest = fake_manifest("my-plugin");
        manifest.libraries.insert("icons".to_string(), "does-not-exist.js".to_string());

        let outcome = stage_plugin(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, PluginStageOutcome::Applied);
    }
}
