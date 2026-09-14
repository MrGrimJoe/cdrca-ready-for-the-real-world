//! Patches a project's locally-installed CDRCA copy — the one npm put in
//! THIS project's own node_modules — so `Parser.js`'s token-collecting
//! rules (the JS_BLOCK body reader, the PROP_DEF body reader, and four
//! other `.join("")` sites) stop corrupting the raw source text they
//! recapture.
//!
//! Verified bug (see docs/REACTIVE-STATE.md, bug #5): every one of these
//! sites joins captured token *values* with `.join("")` — no separator —
//! so `function foo(){ return 1; }` comes back as
//! `functionfoo(){return1;}`, a SyntaxError. This breaks the "drop into a
//! plain `JS { ... }` block for anything the mini-language can't do"
//! escape hatch, and breaks any plugin (Quark, cdrca-reactive-state, or a
//! future one) that compiles down to a raw JS_BLOCK.
//!
//! This CLI's own bundled fallback copy of CDRCA
//! (`cli/src/templates/cdrca-runtime/Back-end/Transpiler/Parser.js`) is
//! already fixed at the source with the same `joinTokenValues()` helper
//! this patch inserts — see that file. This patch exists for the OTHER
//! case: a project whose `npm install cdrca` pulled in a real,
//! plugin-system-having published copy that doesn't yet have this fix.
//! Same spirit as `patch.rs`'s port patch: local, per-project,
//! idempotent, never silently a no-op on a shape mismatch.
//!
//! IMPORTANT: this fix is NOT a blanket `.join(" ")` — that breaks `i++`
//! into the invalid `i + +`. It inserts a space only between two
//! consecutive "word" characters (`[A-Za-z0-9_$]`), leaving
//! punctuation-to-punctuation joins untouched. See `joinTokenValues()`
//! below — it must stay byte-for-byte in sync with the version bundled in
//! `templates/cdrca-runtime/.../Parser.js`.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const TARGET_REL_PATH: &str = "node_modules/cdrca/Back-end/Transpiler/Parser.js";

/// Inserted once, right after the `parserConstructor` declaration line, so
/// every `.join("")` call site below can be swapped for a plain function
/// call.
const HELPER_MARKER: &str = "function joinTokenValues(tokens) {";

const HELPER_FN: &str = "// Verified bug fix (docs/REACTIVE-STATE.md, bug #5): several token-\n\
// collecting rules below used to join captured token values with\n\
// `.join(\"\")` (no separator), corrupting raw JS recaptured from a JS\n\
// block or a PROP_DEF body. A blanket `.join(\" \")` is NOT the fix — it\n\
// breaks `i++` into the invalid `i + +`. A space is inserted only between\n\
// two consecutive \"word\" characters ([A-Za-z0-9_$]).\n\
function joinTokenValues(tokens) {\n\
  const isWordChar = (c) => !!c && /[A-Za-z0-9_$]/.test(c);\n\
  return tokens.reduce((acc, t) => {\n\
    const value = String(t.value);\n\
    if (acc.length > 0 && isWordChar(acc[acc.length - 1]) && isWordChar(value[0])) {\n\
      return acc + \" \" + value;\n\
    }\n\
    return acc + value;\n\
  }, \"\");\n\
}\n\n";

/// The exact six `.join("")` call sites this patch rewrites into
/// `joinTokenValues(...)` calls, as seen on the real CDRCA source this was
/// verified against. If CDRCA's source has moved these lines or renamed
/// the local variables, none of these will match and the patch reports
/// `TargetSpotsNotFound` rather than silently doing nothing.
const JOIN_SITES: &[(&str, &str)] = &[
    (
        "const body = bodyTokens.map((t) => t.value).join(\"\");",
        "const body = joinTokenValues(bodyTokens);",
    ),
    (
        "const code = codeTokens.map((t) => t.value).join(\"\");",
        "const code = joinTokenValues(codeTokens);",
    ),
    (
        "const prams = pramsTokens.map((t) => t.value).join(\"\");",
        "const prams = joinTokenValues(pramsTokens);",
    ),
    (
        "const value = valueTokens.map((t) => t.value).join(\"\");",
        "const value = joinTokenValues(valueTokens);",
    ),
    (
        "const value = commentTokens.map((t) => t.value).join(\"\");",
        "const value = joinTokenValues(commentTokens);",
    ),
];

/// Anchor the helper is inserted directly before. Present once at the top
/// of every version of Parser.js this was checked against.
const INSERTION_ANCHOR: &str = "const parserConstructor = function (defaultTokenizer, pluginAPI) {";

#[derive(Debug, PartialEq, Eq)]
pub enum ParserSpacingPatchOutcome {
    Applied,
    AlreadyPatched,
    /// The helper-insertion anchor and/or one or more of the `.join("")`
    /// call sites weren't found — CDRCA's Parser.js may have changed
    /// upstream since this patch was written. Loud, not a silent no-op.
    TargetSpotsNotFound,
    FileNotFound(PathBuf),
}

impl ParserSpacingPatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(
            self,
            ParserSpacingPatchOutcome::Applied | ParserSpacingPatchOutcome::AlreadyPatched
        )
    }
}

pub fn patch_js_block_spacing(project_root: &Path) -> Result<ParserSpacingPatchOutcome> {
    let target = project_root.join(TARGET_REL_PATH);
    if !target.is_file() {
        return Ok(ParserSpacingPatchOutcome::FileNotFound(target));
    }

    let contents = std::fs::read_to_string(&target)
        .with_context(|| format!("reading {}", target.display()))?;

    if contents.contains(HELPER_MARKER) {
        return Ok(ParserSpacingPatchOutcome::AlreadyPatched);
    }

    if !contents.contains(INSERTION_ANCHOR) {
        return Ok(ParserSpacingPatchOutcome::TargetSpotsNotFound);
    }
    // Every join site must be present too, or we'd insert a helper nothing
    // calls — report loudly instead of doing a half-patch.
    if JOIN_SITES.iter().any(|(find, _)| !contents.contains(find)) {
        return Ok(ParserSpacingPatchOutcome::TargetSpotsNotFound);
    }

    let mut patched = contents.replacen(
        INSERTION_ANCHOR,
        &format!("{HELPER_FN}{INSERTION_ANCHOR}"),
        1,
    );
    for (find, replace) in JOIN_SITES {
        patched = patched.replacen(find, replace, 1);
    }

    std::fs::write(&target, patched)
        .with_context(|| format!("writing patched {}", target.display()))?;

    Ok(ParserSpacingPatchOutcome::Applied)
}

/// Loud, unmissable warning for any non-success outcome — same spirit as
/// `patch::report_outcome()`. Callers still continue.
pub fn report_outcome(outcome: &ParserSpacingPatchOutcome) {
    match outcome {
        ParserSpacingPatchOutcome::Applied => {
            println!("Patched local CDRCA copy: JS_BLOCK/PROP_DEF body reader token-spacing fix.");
        }
        ParserSpacingPatchOutcome::AlreadyPatched => {
            // Expected steady state — nothing to report.
        }
        ParserSpacingPatchOutcome::TargetSpotsNotFound => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA Parser.js spacing patch could NOT be applied ***");
            eprintln!(
                "Expected code shape not found in this project's node_modules/cdrca copy of \
                 Parser.js — CDRCA's source may have changed upstream since this patch was \
                 written."
            );
            eprintln!(
                "Any plugin that compiles to a raw JS_BLOCK (Quark, cdrca-reactive-state, or a \
                 plain 'JS {{ ... }}' block) may throw a SyntaxError on multi-token bodies until \
                 this is revisited."
            );
            eprintln!();
        }
        ParserSpacingPatchOutcome::FileNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: CDRCA Parser.js spacing patch could NOT be applied ***");
            eprintln!("Expected file not found: {}", path.display());
            eprintln!();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_parser(dir: &Path, contents: &str) {
        let target_dir = dir.join("node_modules/cdrca/Back-end/Transpiler");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(target_dir.join("Parser.js"), contents).unwrap();
    }

    const MINIMAL_REAL_SHAPE: &str = r#"
const parserConstructor = function (defaultTokenizer, pluginAPI) {
      const body = bodyTokens.map((t) => t.value).join("");
      const code = codeTokens.map((t) => t.value).join("");
      const code = codeTokens.map((t) => t.value).join("");
      const prams = pramsTokens.map((t) => t.value).join("");
      const value = valueTokens.map((t) => t.value).join("");
      const value = commentTokens.map((t) => t.value).join("");
};
"#;

    #[test]
    fn applies_and_rewrites_every_join_site() {
        let dir = tempfile::tempdir().unwrap();
        fake_parser(dir.path(), MINIMAL_REAL_SHAPE);

        let outcome = patch_js_block_spacing(dir.path()).unwrap();
        assert_eq!(outcome, ParserSpacingPatchOutcome::Applied);

        let patched =
            std::fs::read_to_string(dir.path().join("node_modules/cdrca/Back-end/Transpiler/Parser.js"))
                .unwrap();
        assert!(patched.contains("function joinTokenValues(tokens)"));
        assert!(!patched.contains(".join(\"\")"));
        assert_eq!(patched.matches("joinTokenValues(").count(), 7); // fn def + 6 call sites
    }

    #[test]
    fn is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        fake_parser(dir.path(), MINIMAL_REAL_SHAPE);
        patch_js_block_spacing(dir.path()).unwrap();
        let outcome = patch_js_block_spacing(dir.path()).unwrap();
        assert_eq!(outcome, ParserSpacingPatchOutcome::AlreadyPatched);
    }

    #[test]
    fn reports_missing_spots_loudly_not_silently() {
        let dir = tempfile::tempdir().unwrap();
        fake_parser(dir.path(), "const parserConstructor = function () { /* moved */ };");
        let outcome = patch_js_block_spacing(dir.path()).unwrap();
        assert_eq!(outcome, ParserSpacingPatchOutcome::TargetSpotsNotFound);
        assert!(!outcome.is_ok());
    }

    #[test]
    fn missing_file_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let outcome = patch_js_block_spacing(dir.path()).unwrap();
        match outcome {
            ParserSpacingPatchOutcome::FileNotFound(_) => {}
            other => panic!("expected FileNotFound, got {other:?}"),
        }
    }
}
