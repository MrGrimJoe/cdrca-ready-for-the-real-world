//! The CDRCA language runtime is a real npm package with no `bin` field —
//! it has to land in a project's own node_modules via npm to be runnable at
//! all. This is DIFFERENT from the custom ecosystem package manager (see
//! registry.rs/store.rs/resolve.rs), which never shells out to npm for
//! .cdrca packages/plugins/apps. This module exists only to install the
//! CDRCA runtime itself.

use anyhow::{Context, Result};
use std::path::Path;
use std::process::ExitStatus;

fn npm_program() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

pub fn install_or_update(project_root: &Path, spec: &str) -> Result<ExitStatus> {
    std::process::Command::new(npm_program())
        .args(["install", spec])
        .current_dir(project_root)
        .status()
        .with_context(|| format!("running npm install {spec}"))
}

/// Plain `npm install` with no package spec — installs whatever
/// `package.json` in `dir` already declares. Used after
/// `cdrca_bundle::write_bundled_runtime()` writes out the bundled
/// runtime's own `package.json` (express/prettier/vm), since that step
/// only writes files — it never fetches dependencies itself.
pub fn install_dependencies(dir: &Path) -> Result<ExitStatus> {
    std::process::Command::new(npm_program())
        .arg("install")
        .current_dir(dir)
        .status()
        .with_context(|| format!("running npm install in {}", dir.display()))
}
