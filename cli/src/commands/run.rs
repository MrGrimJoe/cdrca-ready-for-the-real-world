use anyhow::{bail, Context, Result};
use std::path::Path;

use crate::manifest::Manifest;
use crate::project_state::ProjectState;

/// `cdrca run` — launches the current project's CDRCA server directly
/// (never via npm/npx), using the port baked into this project at
/// create/install time (see patch.rs + project_state.rs) rather than
/// negotiating a fresh one on every invocation — the port is patched into
/// this project's own node_modules/cdrca copy once, not per-run.
pub fn run(project_root: &Path) -> Result<()> {
    let manifest = Manifest::load(&project_root.join("cdrca.json")).context("loading cdrca.json")?;
    if !manifest.entry_exists(project_root) {
        bail!(
            "manifest 'entry' field points to '{}' which does not exist in this project",
            manifest.entry
        );
    }

    let state = ProjectState::load_or_default(project_root)?;
    let port = state.port.context(
        "no port assigned to this project yet — run 'cdrca create app' or 'cdrca install cdrca' first",
    )?;

    if !state.port_patch_applied {
        eprintln!(
            "warning: this project's local CDRCA copy was not successfully patched for \
             per-project ports (see the warning from when it was installed) — CDRCA_PORT below \
             will likely be ignored and it will bind its hardcoded default (3000) instead."
        );
    }

    let cdrca_entry = project_root.join("node_modules/cdrca/index.js");
    if !cdrca_entry.is_file() {
        bail!(
            "CDRCA runtime not found at {} — run 'cdrca create app' or 'cdrca install cdrca' first",
            cdrca_entry.display()
        );
    }

    println!("CDRCA_PORT={port}");

    let status = std::process::Command::new("node")
        .arg(&cdrca_entry)
        .env("CDRCA_PORT", port.to_string())
        .current_dir(project_root)
        .status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => bail!("CDRCA process exited with status {s}"),
        Err(e) => bail!("failed to launch CDRCA server ({e})"),
    }
}
