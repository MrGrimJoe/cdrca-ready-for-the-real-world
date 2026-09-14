//! Patches a project's locally-installed CDRCA copy so `Partial_transpiler.js`
//! emits a trailing `;` after a JS_BLOCK statement's generated IIFE.
//!
//! Verified bug (see docs/REACTIVE-STATE.md, bug #6): JS_BLOCK codegen
//! emits `(()=>{code})()` with NO trailing semicolon; consecutive
//! top-level statements in the generated output are only separated by
//! blank lines. JavaScript's automatic semicolon insertion does not treat
//! a blank line as a statement boundary, so two JS_BLOCKs back to back —
//! any two directives from Quark, cdrca-reactive-state, or a plain
//! `JS { ... }` block — get glued into ONE invalid expression: the first
//! IIFE's return value "called" with the second IIFE as an argument.
//! Breaks any file with more than one directive.
//!
//! This CLI's own bundled fallback copy of CDRCA
//! (`cli/src/templates/cdrca-runtime/Back-end/Transpiler/Partial_transpiler.js`)
//! is already fixed at the source. This patch exists for the OTHER case: a
//! project whose `npm install cdrca` pulled in a real, plugin-system-having
//! published copy that doesn't yet have this fix. Same spirit as
//! `patch.rs`'s port patch: local, per-project, idempotent, loud on
//! mismatch.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const TARGET_REL_PATH: &str = "node_modules/cdrca/Back-end/Transpiler/Partial_transpiler.js";
const ORIGINAL_LINE: &str =
    "return { value: `(()=>{${statement.prams.code}})()`, type: \"JS_BLOCK\" };";
const PATCHED_LINE: &str =
    "return { value: `(()=>{${statement.prams.code}})();`, type: \"JS_BLOCK\" };";
const PATCHED_MARKER: &str = "})();`, type: \"JS_BLOCK\" };";

#[derive(Debug, PartialEq, Eq)]
pub enum JsBlockSemicolonPatchOutcome {
    Applied,
    AlreadyPatched,
    /// The expected unpatched JS_BLOCK codegen line wasn't found — CDRCA's
    /// source may have changed upstream. Never treated as a silent no-op.
    TargetLineNotFound,
    FileNotFound(PathBuf),
}

impl JsBlockSemicolonPatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(
            self,
            JsBlockSemicolonPatchOutcome::Applied | JsBlockSemicolonPatchOutcome::AlreadyPatched
        )
    }
}

pub fn patch_js_block_semicolon(project_root: &Path) -> Result<JsBlockSemicolonPatchOutcome> {
    let target = project_root.join(TARGET_REL_PATH);
    if !target.is_file() {
        return Ok(JsBlockSemicolonPatchOutcome::FileNotFound(target));
    }

    let contents = std::fs::read_to_string(&target)
        .with_context(|| format!("reading {}", target.display()))?;

    if contents.contains(PATCHED_MARKER) {
        return Ok(JsBlockSemicolonPatchOutcome::AlreadyPatched);
    }

    if !contents.contains(ORIGINAL_LINE) {
        return Ok(JsBlockSemicolonPatchOutcome::TargetLineNotFound);
    }

    let patched = contents.replacen(ORIGINAL_LINE, PATCHED_LINE, 1);
    std::fs::write(&target, patched)
        .with_context(|| format!("writing patched {}", target.display()))?;

    Ok(JsBlockSemicolonPatchOutcome::Applied)
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `patch::report_outcome()`. Callers still continue.
pub fn report_outcome(outcome: &JsBlockSemicolonPatchOutcome) {
    match outcome {
        JsBlockSemicolonPatchOutcome::Applied => {
            println!("Patched local CDRCA copy: JS_BLOCK trailing-semicolon (ASI collision) fix.");
        }
        JsBlockSemicolonPatchOutcome::AlreadyPatched => {
            // Expected steady state — nothing to report.
        }
        JsBlockSemicolonPatchOutcome::TargetLineNotFound => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA JS_BLOCK semicolon patch could NOT be applied ***");
            eprintln!(
                "Expected code shape not found in this project's node_modules/cdrca copy of \
                 Partial_transpiler.js — CDRCA's source may have changed upstream since this \
                 patch was written."
            );
            eprintln!(
                "Any file with more than one directive (Quark, cdrca-reactive-state, or a plain \
                 'JS {{ ... }}' block) may produce invalid generated JavaScript until this is \
                 revisited."
            );
            eprintln!();
        }
        JsBlockSemicolonPatchOutcome::FileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA JS_BLOCK semicolon patch could NOT be applied ***");
            eprintln!("Expected file not found: {}", path.display());
            eprintln!();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_partial_transpiler(dir: &Path, contents: &str) {
        let target_dir = dir.join("node_modules/cdrca/Back-end/Transpiler");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(target_dir.join("Partial_transpiler.js"), contents).unwrap();
    }

    #[test]
    fn applies_the_patch() {
        let dir = tempfile::tempdir().unwrap();
        fake_partial_transpiler(
            dir.path(),
            "case \"JS_BLOCK\":\n  return { value: `(()=>{${statement.prams.code}})()`, type: \"JS_BLOCK\" };",
        );
        let outcome = patch_js_block_semicolon(dir.path()).unwrap();
        assert_eq!(outcome, JsBlockSemicolonPatchOutcome::Applied);
        let patched = std::fs::read_to_string(
            dir.path().join("node_modules/cdrca/Back-end/Transpiler/Partial_transpiler.js"),
        )
        .unwrap();
        assert!(patched.contains("})();`, type: \"JS_BLOCK\" };"));
    }

    #[test]
    fn is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        fake_partial_transpiler(
            dir.path(),
            "return { value: `(()=>{${statement.prams.code}})()`, type: \"JS_BLOCK\" };",
        );
        patch_js_block_semicolon(dir.path()).unwrap();
        let outcome = patch_js_block_semicolon(dir.path()).unwrap();
        assert_eq!(outcome, JsBlockSemicolonPatchOutcome::AlreadyPatched);
    }

    #[test]
    fn reports_missing_line_loudly() {
        let dir = tempfile::tempdir().unwrap();
        fake_partial_transpiler(dir.path(), "// moved elsewhere");
        let outcome = patch_js_block_semicolon(dir.path()).unwrap();
        assert_eq!(outcome, JsBlockSemicolonPatchOutcome::TargetLineNotFound);
        assert!(!outcome.is_ok());
    }

    #[test]
    fn missing_file_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let outcome = patch_js_block_semicolon(dir.path()).unwrap();
        match outcome {
            JsBlockSemicolonPatchOutcome::FileNotFound(_) => {}
            other => panic!("expected FileNotFound, got {other:?}"),
        }
    }
}
