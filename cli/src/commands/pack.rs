//! `cdrca pack` — builds a `.mrmib` archive from the current project.
//!
//! This is the missing counterpart to `publish.rs`: publish sends the
//! manifest to the registry, which returns a `githubReleaseAssetUrl` for
//! `install` to download — but nothing in this CLI actually builds that
//! release asset. `cdrca pack` produces one (as a `.mrmib`, which is a
//! plain gzip'd tar under the hood — see mrmib.rs) so it can be attached to
//! a GitHub release for the registry flow, or handed to someone directly
//! for offline/side-loaded installs via `cdrca install <path>.mrmib`.

use crate::mrmib;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// `cdrca pack [--out <path>]`. Defaults the output filename to
/// `<name>-<version>.mrmib` in the project root, matching the
/// `<name>-<version>.tar.gz` naming `install.rs` already uses for
/// downloaded tarballs, so the two are recognizable as the same kind of
/// thing side by side.
pub fn run(project_root: &Path, out: Option<&str>) -> Result<()> {
    let manifest_path = project_root.join("cdrca.json");
    let manifest = crate::manifest::Manifest::load(&manifest_path).context("loading cdrca.json")?;

    let dest = match out {
        Some(o) => {
            let p = PathBuf::from(o);
            if p.is_absolute() {
                p
            } else {
                project_root.join(p)
            }
        }
        None => project_root.join(format!("{}-{}.mrmib", manifest.name, manifest.version)),
    };

    let mrmib::PackOutcome::Written(path) = mrmib::pack(project_root, &dest)?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!(
        "Packed {}@{} -> {} ({:.1} KB)",
        manifest.name,
        manifest.version,
        path.display(),
        size as f64 / 1024.0
    );
    println!(
        "Attach this file to a GitHub release for the registry to serve, or share it directly \
         — install it anywhere with:\n  cdrca install {}",
        path.display()
    );
    Ok(())
}

/// `cdrca info <path>.mrmib` support: reads the manifest out of a local
/// archive without extracting it, for the same "inspect before installing"
/// purpose `misc::info` serves for a registry package name.
pub fn inspect(archive_path: &Path) -> Result<()> {
    let meta = mrmib::read_meta(archive_path)?;
    let m = &meta.manifest;
    println!("{} @ {}  ({:?})", m.name, m.version, m.package_type);
    println!("{}", m.description);
    if !m.author.is_empty() {
        println!("author: {}", m.author);
    }
    if !m.license.is_empty() {
        println!("license: {}", m.license);
    }
    println!("mrmib format version: {}", meta.format_version);
    println!("payload integrity: {}", meta.payload_sha256);
    Ok(())
}
