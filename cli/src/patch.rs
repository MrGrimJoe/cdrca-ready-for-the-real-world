//! Patches a project's locally-installed CDRCA copy — the one npm put in
//! THIS project's own node_modules — so it honors a CDRCA_PORT env var
//! instead of CDRCA's real hardcoded `const PORT = 3000;`
//! (Back-end/Servers/main/index.js). Verified directly against CDRCA's
//! actual source: that env var is NOT honored upstream today.
//!
//! This is a local, per-project patch, same spirit as tools like
//! patch-package: it modifies node_modules AFTER npm install, not the
//! upstream package, Ayyan's repo, or any shared/global CDRCA install.
//! Deliberately chosen over asking for an upstream change or routing
//! multiple projects through one singleton server.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const TARGET_REL_PATH: &str = "node_modules/cdrca/Back-end/Servers/main/index.js";
const ORIGINAL_LINE: &str = "const PORT = 3000;";
const PATCHED_LINE: &str = "const PORT = process.env.CDRCA_PORT || 3000;";
const PATCHED_MARKER: &str = "process.env.CDRCA_PORT";

#[derive(Debug, PartialEq, Eq)]
pub enum PatchOutcome {
    Applied,
    AlreadyPatched,
    /// The expected `const PORT = 3000;` line wasn't found — CDRCA's source
    /// may have changed upstream. This is NOT treated as a silent no-op;
    /// callers must surface it loudly via report_outcome().
    TargetLineNotFound,
    FileNotFound(PathBuf),
}

impl PatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, PatchOutcome::Applied | PatchOutcome::AlreadyPatched)
    }
}

pub fn patch_port(project_root: &Path) -> Result<PatchOutcome> {
    let target = project_root.join(TARGET_REL_PATH);
    if !target.is_file() {
        return Ok(PatchOutcome::FileNotFound(target));
    }

    let contents = std::fs::read_to_string(&target)
        .with_context(|| format!("reading {}", target.display()))?;

    // Idempotency: if this project's copy was already patched (e.g. a
    // previous 'cdrca create app' or 'cdrca install cdrca' already ran
    // this), skip re-patching rather than failing or double-patching.
    if contents.contains(PATCHED_MARKER) {
        return Ok(PatchOutcome::AlreadyPatched);
    }

    if !contents.contains(ORIGINAL_LINE) {
        return Ok(PatchOutcome::TargetLineNotFound);
    }

    let patched = contents.replacen(ORIGINAL_LINE, PATCHED_LINE, 1);
    std::fs::write(&target, patched)
        .with_context(|| format!("writing patched {}", target.display()))?;

    Ok(PatchOutcome::Applied)
}

/// Loud, unmissable warning for any non-success outcome — never silently
/// swallowed. Callers still continue (this is a degraded-mode condition,
/// not a hard failure of create/install), but the user must be told
/// plainly that per-project ports won't work until this is revisited.
pub fn report_outcome(outcome: &PatchOutcome) {
    match outcome {
        PatchOutcome::Applied => {
            println!("Patched local CDRCA copy to honor CDRCA_PORT.");
        }
        PatchOutcome::AlreadyPatched => {
            // Expected steady state — nothing to report.
        }
        PatchOutcome::TargetLineNotFound => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA port patch could NOT be applied ***");
            eprintln!(
                "Expected to find '{ORIGINAL_LINE}' in this project's node_modules/cdrca copy, \
                 but it wasn't there — CDRCA's source may have changed upstream since this patch \
                 was written."
            );
            eprintln!(
                "'cdrca run' and 'cdrca build app' will NOT respect a per-project port until this \
                 is revisited — this project falls back to CDRCA's hardcoded port (3000), meaning \
                 only one CDRCA project can run at a time."
            );
            eprintln!();
        }
        PatchOutcome::FileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA port patch could NOT be applied ***");
            eprintln!("Expected file not found: {}", path.display());
            eprintln!(
                "'cdrca run' and 'cdrca build app' will NOT respect a per-project port until this \
                 is revisited."
            );
            eprintln!();
        }
    }
}
