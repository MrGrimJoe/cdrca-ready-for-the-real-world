//! Wires an installed `type: "package"` package (a reusable `.cdrca`
//! source library another project's `add import`/`use` should be able to
//! reference) onto disk in the CONSUMING project — `cdrca install
//! <package>` had the same gap for packages that it had for plugins (see
//! `plugin_stage.rs`): downloaded, checksummed, extracted into the local
//! store, and locked — but never actually placed anywhere the consuming
//! project's own `.cdrca` source could get at it.
//!
//! **What this fixes, and what it deliberately does NOT claim to fix:**
//! this stages the package's full `.cdrca` source tree into a
//! predictable, conventional location on disk
//! (`cdrca_packages/<name>/` at the project root, mirroring how
//! `node_modules/<name>/` works for npm). That much is verified: the
//! files really do land there, byte-for-byte, idempotently, same as
//! every other patch in this codebase.
//!
//! What's genuinely UNCONFIRMED — checked directly, not glossed over —
//! is how CDRCA's own `add import <path>` statement is supposed to find
//! them from there. Tracing the real bundled runtime
//! (`Back-end/Transpiler/index.js`'s `getVFScontent`/`mainMultiFile`,
//! `Back-end/Servers/main/index.js`'s `handleAPI`) shows the `VFS`
//! (`fileSystem`) that `add import` resolves paths against is supplied
//! PER-REQUEST by whatever calls `transpiler.transpile(...)` — in
//! `cdrca run`'s case, a browser-side editor POSTing to `/api/transpileCDRCA`
//! — not built by any recursive disk scan anywhere in this bundled
//! runtime. There is no code path in the currently-bundled CDRCA copy
//! that reads `cdrca_packages/` (or any other directory) off disk and
//! folds it into that VFS automatically. This is the same category of
//! gap as `QuarkPatchOutcome::PluginSystemNotPresent` — a real limitation
//! in CDRCA itself (or in what's confirmed about it), not a bug in this
//! staging step — and needs to be surfaced the same way: loudly, not
//! silently assumed away. See docs/REACTIVE-STATE.md and
//! docs/PLUGIN-LIBRARIES.md for the same pattern elsewhere in this repo.
//!
//! Net effect today: `cdrca install <package>` now leaves the package's
//! source somewhere real and inspectable, which is strictly better than
//! before (nothing existed on disk in the project at all), but a
//! `.cdrca` file's `add import "cdrca_packages/<name>/<entry>"` is NOT
//! yet confirmed to work end-to-end against a real transpile — that
//! needs verifying against an actual editor-driven VFS build once one is
//! available to test against, not assumed from reading source alone.

use crate::manifest::Manifest;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const PACKAGES_DIR_REL: &str = "cdrca_packages";

#[derive(Debug, PartialEq, Eq)]
pub enum PackageStageOutcome {
    /// Source tree copied (or refreshed — this always overwrites, since
    /// there's no separate "already staged" branch worth reporting
    /// differently for a plain file copy the way plugins.json has one).
    Applied,
    /// The manifest's declared `entry` file doesn't exist in the
    /// downloaded/unpacked package directory.
    EntryFileNotFound(PathBuf),
}

impl PackageStageOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, PackageStageOutcome::Applied)
    }
}

/// `package_dir` is the local store directory this package was just
/// unpacked into (what `Store::package_dir` returns) — copied in full
/// (not just `entry`) into `<project_root>/cdrca_packages/<name>/`, since
/// a package may reference its own other `.cdrca` files via relative
/// `add import` paths internally.
pub fn stage_package(project_root: &Path, package_dir: &Path, manifest: &Manifest) -> Result<PackageStageOutcome> {
    let entry_src = package_dir.join(&manifest.entry);
    if !entry_src.is_file() {
        return Ok(PackageStageOutcome::EntryFileNotFound(entry_src));
    }

    let staged_dir = project_root.join(PACKAGES_DIR_REL).join(&manifest.name);
    if staged_dir.is_dir() {
        std::fs::remove_dir_all(&staged_dir)
            .with_context(|| format!("clearing previous copy at {}", staged_dir.display()))?;
    }
    copy_dir_recursive(package_dir, &staged_dir)
        .with_context(|| format!("copying {} to {}", package_dir.display(), staged_dir.display()))?;

    Ok(PackageStageOutcome::Applied)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else {
            std::fs::copy(&path, &dst_path)?;
        }
    }
    Ok(())
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `plugin_stage.rs::report_outcome()`. Callers still continue. Even on
/// `Applied`, this prints the still-unconfirmed caveat (see module docs)
/// rather than a plain success — a silent-looking success here would be
/// actively misleading given how much of the real story isn't nailed
/// down yet.
pub fn report_outcome(name: &str, outcome: &PackageStageOutcome) {
    match outcome {
        PackageStageOutcome::Applied => {
            println!(
                "Staged package \"{name}\" source into cdrca_packages/{name}/. NOTE: whether \
                 CDRCA's real `add import` VFS mechanism actually picks this up from disk is \
                 NOT yet confirmed against a real transpile — see plugin_stage.rs's sibling \
                 module docs (package_stage.rs) for exactly what's verified and what isn't."
            );
        }
        PackageStageOutcome::EntryFileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: package \"{name}\" could NOT be staged ***");
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
            description: "test package".to_string(),
            package_type: PackageType::Package,
            entry: "src/main.cdrca".to_string(),
            icon: "icon.png".to_string(),
            author: "tester".to_string(),
            license: "IOSL".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: Vec::new(),
            libraries: HashMap::new(),
            provides_for: None,
        }
    }

    fn fake_package(dir: &Path) -> PathBuf {
        let pkg_dir = dir.join("pkg-store/calculastic/1.0.0");
        std::fs::create_dir_all(pkg_dir.join("src")).unwrap();
        std::fs::write(pkg_dir.join("src/main.cdrca"), "!--- SCENE Main ---\n!---END---\n").unwrap();
        std::fs::write(pkg_dir.join("cdrca.json"), "{}").unwrap();
        pkg_dir
    }

    #[test]
    fn stages_the_full_source_tree() {
        let dir = tempfile::tempdir().unwrap();
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("calculastic");

        let outcome = stage_package(dir.path(), &pkg_dir, &manifest).unwrap();
        assert_eq!(outcome, PackageStageOutcome::Applied);

        let staged_entry = dir.path().join("cdrca_packages/calculastic/src/main.cdrca");
        assert!(staged_entry.is_file());
        assert!(dir.path().join("cdrca_packages/calculastic/cdrca.json").is_file());
    }

    #[test]
    fn re_staging_refreshes_rather_than_accumulates_stale_files() {
        let dir = tempfile::tempdir().unwrap();
        let pkg_dir = fake_package(dir.path());
        let manifest = fake_manifest("calculastic");
        stage_package(dir.path(), &pkg_dir, &manifest).unwrap();

        // Simulate a stale file left over from a previous, different
        // version of the package.
        let stale = dir.path().join("cdrca_packages/calculastic/old-file.cdrca");
        std::fs::write(&stale, "leftover").unwrap();

        stage_package(dir.path(), &pkg_dir, &manifest).unwrap();
        assert!(!stale.is_file(), "stale files from a previous version must not survive re-staging");
    }

    #[test]
    fn missing_entry_file_is_reported_not_panicked() {
        let dir = tempfile::tempdir().unwrap();
        let pkg_dir = dir.path().join("pkg-store/empty");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        let manifest = fake_manifest("calculastic");

        let outcome = stage_package(dir.path(), &pkg_dir, &manifest).unwrap();
        match outcome {
            PackageStageOutcome::EntryFileNotFound(_) => {}
            other => panic!("expected EntryFileNotFound, got {other:?}"),
        }
        assert!(!outcome.is_ok());
    }
}
