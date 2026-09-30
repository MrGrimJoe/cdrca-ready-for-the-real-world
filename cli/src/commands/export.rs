//! `cdrca export <name>` / `cdrca export` — packages an installed
//! plugin/library/package (or the current project itself) into a `.mrmib`.
//! Bare `cdrca export` is fully automatic: everything this project has —
//! its own package plus every staged plugin/library/package — each to its
//! own `.mrmib`, no per-item confirmation.
//!
//! "Everything this project has" is read from the same on-disk staging
//! locations `plugin_stage.rs` / `package_stage.rs` / `library_stage.rs`
//! already write to — this module never talks to the registry or the
//! local package store (store.rs) directly, since a project can have a
//! staged plugin whose original store copy was since removed; the staged
//! copy (with its co-staged cdrca.json — see plugin_stage.rs and the fix
//! in library_stage.rs) is the one actually in use by this project and so
//! the one that should be exported.

use crate::library_stage::LIBRARIES_DIR_REL;
use crate::manifest::Manifest;
use crate::mrmib;
use crate::package_stage::PACKAGES_DIR_REL;
use crate::plugin_stage::PLUGINS_DIR_REL;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

enum FoundAt {
    /// The current project's own cdrca.json at its root.
    ThisProject,
    Plugin(PathBuf),
    Library(PathBuf),
    Package(PathBuf),
}

fn describe(found: &FoundAt) -> &'static str {
    match found {
        FoundAt::ThisProject => "this project",
        FoundAt::Plugin(_) => "installed plugin",
        FoundAt::Library(_) => "installed library",
        FoundAt::Package(_) => "installed package",
    }
}

fn dir_of(found: &FoundAt, project_root: &Path) -> PathBuf {
    match found {
        FoundAt::ThisProject => project_root.to_path_buf(),
        FoundAt::Plugin(d) | FoundAt::Library(d) | FoundAt::Package(d) => d.clone(),
    }
}

/// Finds every named thing this project has staged, keyed by manifest
/// name, without assuming any one of the three staging areas exists (a
/// fresh project may have none).
fn discover_all(project_root: &Path) -> Result<Vec<FoundAt>> {
    let mut found = Vec::new();

    if project_root.join("cdrca.json").is_file() {
        found.push(FoundAt::ThisProject);
    }

    let plugins_root = project_root.join(PLUGINS_DIR_REL);
    if plugins_root.is_dir() {
        for entry in std::fs::read_dir(&plugins_root)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.path().join("cdrca.json").is_file() {
                found.push(FoundAt::Plugin(entry.path()));
            }
        }
    }

    let libraries_root = project_root.join(LIBRARIES_DIR_REL);
    if libraries_root.is_dir() {
        for entry in std::fs::read_dir(&libraries_root)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.path().join("cdrca.json").is_file() {
                found.push(FoundAt::Library(entry.path()));
            }
        }
    }

    let packages_root = project_root.join(PACKAGES_DIR_REL);
    if packages_root.is_dir() {
        for entry in std::fs::read_dir(&packages_root)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.path().join("cdrca.json").is_file() {
                found.push(FoundAt::Package(entry.path()));
            }
        }
    }

    Ok(found)
}

/// Finds one specific named thing — checked in the same four places
/// `discover_all` scans, current project first (a project exporting
/// itself while also having a same-named dependency staged is an edge
/// case, but "the thing right here" is the least surprising match).
fn discover_one(project_root: &Path, name: &str) -> Result<FoundAt> {
    if project_root.join("cdrca.json").is_file() {
        let m = Manifest::load(&project_root.join("cdrca.json"))?;
        if m.name == name {
            return Ok(FoundAt::ThisProject);
        }
    }
    let candidates: [(&str, fn(PathBuf) -> FoundAt); 3] = [
        (PLUGINS_DIR_REL, FoundAt::Plugin),
        (LIBRARIES_DIR_REL, FoundAt::Library),
        (PACKAGES_DIR_REL, FoundAt::Package),
    ];
    for (dir_rel, wrap) in candidates {
        let dir = project_root.join(dir_rel).join(name);
        if dir.join("cdrca.json").is_file() {
            return Ok(wrap(dir));
        }
    }
    bail!(
        "'{name}' isn't this project's own package and isn't staged as a plugin, library, or \
         package here — run `cdrca list` to see what's installed, or `cdrca export` with no \
         name to export everything this project has"
    );
}

fn export_one(project_root: &Path, found: FoundAt, out_dir: &Path) -> Result<PathBuf> {
    export_one_to(project_root, found, |m| {
        out_dir.join(format!("{}-{}.mrmib", m.name, m.version))
    })
}

/// Same as `export_one`, but the caller decides the exact destination file
/// from the loaded manifest (so `run_named` can honour `--out <file>.mrmib`).
fn export_one_to(
    project_root: &Path,
    found: FoundAt,
    dest_for: impl FnOnce(&Manifest) -> PathBuf,
) -> Result<PathBuf> {
    let dir = dir_of(&found, project_root);
    let manifest = Manifest::load(&dir.join("cdrca.json"))
        .with_context(|| format!("loading cdrca.json from {}", dir.display()))?;
    let dest = dest_for(&manifest);
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let mrmib::PackOutcome::Written(path) = mrmib::pack(&dir, &dest)
        .with_context(|| format!("packing {} ({})", manifest.name, describe(&found)))?;
    println!(
        "Exported {} ({}) -> {}",
        manifest.name,
        describe(&found),
        path.display()
    );
    Ok(path)
}

/// `cdrca export <name>`.
pub fn run_named(project_root: &Path, name: &str, out: Option<&str>) -> Result<()> {
    let found = discover_one(project_root, name)?;
    match out {
        // `--help` documents --out as "the exact file path when a name is
        // given", so a path ending in `.mrmib` is the archive itself, not
        // a directory to create and drop a file into.
        Some(o) if o.ends_with(".mrmib") => {
            let exact = PathBuf::from(o);
            export_one_to(project_root, found, move |_| exact)?;
        }
        Some(o) => {
            let p = PathBuf::from(o);
            std::fs::create_dir_all(&p)?;
            export_one(project_root, found, &p)?;
        }
        None => {
            export_one(project_root, found, project_root)?;
        }
    }
    Ok(())
}

/// `cdrca export` with no name — everything, automatically, no per-item
/// confirmation. Writes into `<project>/exports/` by default so a bare
/// "export everything" run doesn't scatter files across the project root
/// (unlike `run_named`/`pack`, which default next to the project itself —
/// a bulk export is more likely to want its own tidy destination).
pub fn run_all(project_root: &Path, out: Option<&str>) -> Result<()> {
    let out_dir = match out {
        Some(o) => project_root.join(o),
        None => project_root.join("exports"),
    };
    std::fs::create_dir_all(&out_dir)
        .with_context(|| format!("creating {}", out_dir.display()))?;

    let all = discover_all(project_root)?;
    if all.is_empty() {
        println!(
            "Nothing to export — no cdrca.json here, and no staged plugins/libraries/packages found."
        );
        return Ok(());
    }

    let mut exported = 0;
    let mut failed = 0;
    for found in all {
        match export_one(project_root, found, &out_dir) {
            Ok(_) => exported += 1,
            Err(e) => {
                // One broken staged item (e.g. a manifest that no longer
                // validates) shouldn't stop everything else from
                // exporting — "automatic" means it doesn't stop and ask,
                // not that one failure silently swallows the rest.
                eprintln!("warning: skipped one item: {e:#}");
                failed += 1;
            }
        }
    }
    println!("Exported {exported} item(s) to {}", out_dir.display());
    if failed > 0 {
        println!("({failed} item(s) skipped — see warnings above)");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::PackageType;
    use std::collections::HashMap;

    fn write_manifest(dir: &Path, name: &str, package_type: PackageType) {
        std::fs::create_dir_all(dir).unwrap();
        let m = Manifest {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: "t".to_string(),
            package_type,
            entry: "entry.txt".to_string(),
            icon: String::new(),
            author: "t".to_string(),
            license: "IOSL".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: Vec::new(),
            libraries: HashMap::new(),
            provides_for: None,
        };
        std::fs::write(dir.join("cdrca.json"), serde_json::to_string_pretty(&m).unwrap()).unwrap();
        std::fs::write(dir.join("entry.txt"), "x").unwrap();
    }

    #[test]
    fn exports_the_current_project_by_name() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "my-app", PackageType::App);
        run_named(tmp.path(), "my-app", None).unwrap();
        assert!(tmp.path().join("my-app-1.0.0.mrmib").is_file());
    }

    #[test]
    fn out_ending_in_mrmib_is_the_exact_file_not_a_directory() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "my-app", PackageType::App);
        let out = tmp.path().join("nested/custom-name.mrmib");
        run_named(tmp.path(), "my-app", Some(out.to_str().unwrap())).unwrap();
        assert!(out.is_file(), "--out <x>.mrmib must be written as a file");
    }

    #[test]
    fn out_without_mrmib_extension_is_still_a_directory() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "my-app", PackageType::App);
        let out = tmp.path().join("outdir");
        run_named(tmp.path(), "my-app", Some(out.to_str().unwrap())).unwrap();
        assert!(out.join("my-app-1.0.0.mrmib").is_file());
    }

    #[test]
    fn exports_a_staged_plugin_by_name() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin_dir = tmp.path().join(PLUGINS_DIR_REL).join("cool-plugin");
        write_manifest(&plugin_dir, "cool-plugin", PackageType::Plugin);
        run_named(tmp.path(), "cool-plugin", None).unwrap();
        assert!(tmp.path().join("cool-plugin-1.0.0.mrmib").is_file());
    }

    #[test]
    fn exports_a_staged_library_by_name() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_dir = tmp.path().join(LIBRARIES_DIR_REL).join("cool-lib");
        write_manifest(&lib_dir, "cool-lib", PackageType::Library);
        // Library manifests require provides_for to validate — patch it in.
        let raw = std::fs::read_to_string(lib_dir.join("cdrca.json")).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        v["providesFor"] = serde_json::json!({"plugin": "quark", "library": "icons"});
        std::fs::write(lib_dir.join("cdrca.json"), serde_json::to_string_pretty(&v).unwrap()).unwrap();

        run_named(tmp.path(), "cool-lib", None).unwrap();
        assert!(tmp.path().join("cool-lib-1.0.0.mrmib").is_file());
    }

    #[test]
    fn unknown_name_is_a_clear_error_listing_what_to_do_instead() {
        let tmp = tempfile::tempdir().unwrap();
        let err = run_named(tmp.path(), "does-not-exist", None).unwrap_err();
        assert!(err.to_string().contains("cdrca export"));
    }

    #[test]
    fn export_all_covers_project_plus_every_staged_kind_automatically() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "my-app", PackageType::App);
        write_manifest(
            &tmp.path().join(PLUGINS_DIR_REL).join("p1"),
            "p1",
            PackageType::Plugin,
        );
        write_manifest(
            &tmp.path().join(PACKAGES_DIR_REL).join("pkg1"),
            "pkg1",
            PackageType::Package,
        );

        run_all(tmp.path(), None).unwrap();
        let exports_dir = tmp.path().join("exports");
        assert!(exports_dir.join("my-app-1.0.0.mrmib").is_file());
        assert!(exports_dir.join("p1-1.0.0.mrmib").is_file());
        assert!(exports_dir.join("pkg1-1.0.0.mrmib").is_file());
    }

    #[test]
    fn export_all_with_nothing_present_says_so_rather_than_erroring() {
        let tmp = tempfile::tempdir().unwrap();
        run_all(tmp.path(), None).unwrap();
    }

    #[test]
    fn one_broken_staged_item_does_not_abort_exporting_the_rest() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "my-app", PackageType::App);
        // A staged "plugin" whose manifest won't validate (empty name).
        let broken_dir = tmp.path().join(PLUGINS_DIR_REL).join("broken");
        std::fs::create_dir_all(&broken_dir).unwrap();
        std::fs::write(
            broken_dir.join("cdrca.json"),
            r#"{"name":"","version":"1.0.0","description":"","type":"plugin","entry":"e","icon":"","author":"","license":"IOSL","repository":""}"#,
        ).unwrap();

        run_all(tmp.path(), None).unwrap();
        assert!(tmp.path().join("exports/my-app-1.0.0.mrmib").is_file());
    }
}
