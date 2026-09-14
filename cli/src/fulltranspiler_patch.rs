//! Patches a project's locally-installed CDRCA copy so `FullTranspiler.js`'s
//! `reshapeToInps()` recognizes `JS_BLOCK` as an input key instead of
//! silently dropping every top-level JS_BLOCK statement.
//!
//! Verified bug (see docs/REACTIVE-STATE.md, bug #2): `reshapeToInps()`
//! builds an `inputs` object with a fixed set of recognized AST node
//! types. `"JS_BLOCK"` — the node BOTH Quark and cdrca-reactive-state
//! compile every directive down to, and what a plain `JS { ... }` block
//! produces too — was never one of them, so every JS_BLOCK statement was
//! silently discarded before it ever reached codegen. Reproduces with
//! zero plugins involved. Fixed by adding `JS_BLOCK: []` to `inputs`, and
//! adding `"JS_BLOCK"` to the placeholder group already used for
//! `ACTION_DEF`/`PROP_DEF`/`PROP_USE`/`ACTION_USE`.
//!
//! This CLI's own bundled fallback copy of CDRCA
//! (`cli/src/templates/cdrca-runtime/Back-end/Transpiler/FullTranspiler.js`)
//! is already fixed at the source — this has been true since before this
//! patch module existed. This patch exists for the OTHER case: a project
//! whose `npm install cdrca` pulled in a real, plugin-system-having
//! published copy that doesn't yet have this fix. Same spirit as
//! `patch.rs`'s port patch: local, per-project, idempotent, loud on
//! mismatch.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const TARGET_REL_PATH: &str = "node_modules/cdrca/Back-end/Transpiler/FullTranspiler.js";

const INPUTS_FIND: &str = "      errorsLOGS: [],\n      scenes: [],\n    };";
const INPUTS_REPLACE: &str = "      errorsLOGS: [],\n      scenes: [],\n      JS_BLOCK: [],\n    };";
const INPUTS_MARKER: &str = "JS_BLOCK: []";

const PLACEHOLDER_FIND: &str =
    "placeholder: [\"ACTION_DEF\", \"PROP_DEF\", \"PROP_USE\", \"ACTION_USE\"],\n      toString: general3DastToSTRplaceholder,";
const PLACEHOLDER_REPLACE: &str =
    "placeholder: [\"ACTION_DEF\", \"PROP_DEF\", \"PROP_USE\", \"ACTION_USE\", \"JS_BLOCK\"],\n      toString: general3DastToSTRplaceholder,";
const PLACEHOLDER_MARKER: &str = "\"ACTION_DEF\", \"PROP_DEF\", \"PROP_USE\", \"ACTION_USE\", \"JS_BLOCK\"";

#[derive(Debug, PartialEq, Eq)]
pub enum FullTranspilerPatchOutcome {
    Applied,
    AlreadyPatched,
    /// Neither expected code shape was found (or only one half was) —
    /// CDRCA's source may have changed upstream. Never a silent no-op.
    TargetSpotsNotFound,
    FileNotFound(PathBuf),
}

impl FullTranspilerPatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(
            self,
            FullTranspilerPatchOutcome::Applied | FullTranspilerPatchOutcome::AlreadyPatched
        )
    }
}

pub fn patch_js_block_output(project_root: &Path) -> Result<FullTranspilerPatchOutcome> {
    let target = project_root.join(TARGET_REL_PATH);
    if !target.is_file() {
        return Ok(FullTranspilerPatchOutcome::FileNotFound(target));
    }

    let contents = std::fs::read_to_string(&target)
        .with_context(|| format!("reading {}", target.display()))?;

    let inputs_done = contents.contains(INPUTS_MARKER);
    let placeholder_done = contents.contains(PLACEHOLDER_MARKER);
    if inputs_done && placeholder_done {
        return Ok(FullTranspilerPatchOutcome::AlreadyPatched);
    }

    let inputs_findable = contents.contains(INPUTS_FIND);
    let placeholder_findable = contents.contains(PLACEHOLDER_FIND);
    // Each half is independently idempotent (already-done OR findable) —
    // anything else means the source shape moved and we should report
    // loudly rather than apply half a fix.
    if !(inputs_done || inputs_findable) || !(placeholder_done || placeholder_findable) {
        return Ok(FullTranspilerPatchOutcome::TargetSpotsNotFound);
    }

    let mut patched = contents;
    if !inputs_done {
        patched = patched.replacen(INPUTS_FIND, INPUTS_REPLACE, 1);
    }
    if !placeholder_done {
        patched = patched.replacen(PLACEHOLDER_FIND, PLACEHOLDER_REPLACE, 1);
    }

    std::fs::write(&target, patched)
        .with_context(|| format!("writing patched {}", target.display()))?;

    Ok(FullTranspilerPatchOutcome::Applied)
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `patch::report_outcome()`. Callers still continue.
pub fn report_outcome(outcome: &FullTranspilerPatchOutcome) {
    match outcome {
        FullTranspilerPatchOutcome::Applied => {
            println!("Patched local CDRCA copy: JS_BLOCK-dropped-by-reshapeToInps fix.");
        }
        FullTranspilerPatchOutcome::AlreadyPatched => {
            // Expected steady state — nothing to report.
        }
        FullTranspilerPatchOutcome::TargetSpotsNotFound => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA FullTranspiler.js JS_BLOCK patch could NOT be applied ***");
            eprintln!(
                "Expected code shape not found in this project's node_modules/cdrca copy of \
                 FullTranspiler.js — CDRCA's source may have changed upstream since this patch \
                 was written."
            );
            eprintln!(
                "Every JS_BLOCK-producing statement (Quark, cdrca-reactive-state, or a plain \
                 'JS {{ ... }}' block) will be silently dropped from generated output until this \
                 is revisited."
            );
            eprintln!();
        }
        FullTranspilerPatchOutcome::FileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA FullTranspiler.js JS_BLOCK patch could NOT be applied ***");
            eprintln!("Expected file not found: {}", path.display());
            eprintln!();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_full_transpiler(dir: &Path, contents: &str) {
        let target_dir = dir.join("node_modules/cdrca/Back-end/Transpiler");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(target_dir.join("FullTranspiler.js"), contents).unwrap();
    }

    const UNPATCHED_SHAPE: &str = "let inputs = {\n      errorsLOGS: [],\n      scenes: [],\n    };\nsomePlaceholderGroup = {\n      placeholder: [\"ACTION_DEF\", \"PROP_DEF\", \"PROP_USE\", \"ACTION_USE\"],\n      toString: general3DastToSTRplaceholder,\n};";

    #[test]
    fn applies_both_halves() {
        let dir = tempfile::tempdir().unwrap();
        fake_full_transpiler(dir.path(), UNPATCHED_SHAPE);
        let outcome = patch_js_block_output(dir.path()).unwrap();
        assert_eq!(outcome, FullTranspilerPatchOutcome::Applied);
        let patched = std::fs::read_to_string(
            dir.path().join("node_modules/cdrca/Back-end/Transpiler/FullTranspiler.js"),
        )
        .unwrap();
        assert!(patched.contains("JS_BLOCK: []"));
        assert!(patched.contains("\"ACTION_USE\", \"JS_BLOCK\"]"));
    }

    #[test]
    fn is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        fake_full_transpiler(dir.path(), UNPATCHED_SHAPE);
        patch_js_block_output(dir.path()).unwrap();
        let outcome = patch_js_block_output(dir.path()).unwrap();
        assert_eq!(outcome, FullTranspilerPatchOutcome::AlreadyPatched);
    }

    #[test]
    fn reports_missing_spots_loudly() {
        let dir = tempfile::tempdir().unwrap();
        fake_full_transpiler(dir.path(), "// totally different shape");
        let outcome = patch_js_block_output(dir.path()).unwrap();
        assert_eq!(outcome, FullTranspilerPatchOutcome::TargetSpotsNotFound);
        assert!(!outcome.is_ok());
    }

    #[test]
    fn missing_file_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let outcome = patch_js_block_output(dir.path()).unwrap();
        match outcome {
            FullTranspilerPatchOutcome::FileNotFound(_) => {}
            other => panic!("expected FileNotFound, got {other:?}"),
        }
    }
}
