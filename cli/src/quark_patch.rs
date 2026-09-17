//! Installs Quark — the `@id preset.mod.mod = value` UI-directive plugin —
//! into THIS project's own `node_modules/cdrca` copy, the same way
//! `patch.rs` patches the port. Quark ships bundled with the CLI itself
//! (see `templates/plugins/quark/`) rather than through the registry:
//! it's meant to be built-in for every project, not something opted into
//! via `cdrca.json` `dependencies` or a `cdrca install` confirmation
//! prompt. No permissions are required — the plugin only reads tokens and
//! returns a plain AST node, it never touches fs/child_process.
//!
//! Verified directly against CDRCA's real source (see NOTES below): the
//! currently-published npm `cdrca` package does NOT yet contain the
//! plugin-hook system this depends on (`Back-end/Transpiler/plugin.js`,
//! `pluginAPI` wired into `Parser.js`) even though it exists on CDRCA's
//! GitHub `main` branch under the same version number. This patch stages
//! Quark's files and its `plugins.json` entry regardless — harmless, and
//! it starts working the moment a project's local CDRCA copy is updated
//! to a version that actually has the hook system — but
//! `QuarkPatchOutcome::PluginSystemNotPresent` must be surfaced loudly
//! rather than reported as a plain success, since today it's genuinely
//! inert.
//!
//! This file also patches this project's `Front-end/index.html` (same
//! local, per-project, idempotent style as `patch.rs`'s port patch) so
//! Quark's runtime is actually loaded into the page the transpiled
//! `JS_BLOCK` code runs in via `eval()` — not just staged on the backend
//! side. `quark-core.js` and `quark-ui.js` are always loaded (they're the
//! plugin's engine and compatibility shim, not optional). Library bundles
//! (`quark-components.js`, `quark-templates.js`) are only added to the
//! page if `quark_libscan` finds a matching `@useLib quark.<name>`
//! directive somewhere in this project's `.cdrca` source — see
//! `docs/PLUGIN-LIBRARIES.md` for why library selection has to happen
//! here, ahead of time, rather than at eval-time.

use crate::quark_libscan::{self, LibRef};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const CDRCA_ROOT_REL: &str = "node_modules/cdrca";
const PLUGINS_DIR_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins";
const PLUGIN_LOADER_REL: &str = "node_modules/cdrca/Back-end/Transpiler/plugin.js";
const PLUGINS_JSON_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins/plugins.json";
const FRONTEND_LIB_DIR_REL: &str = "node_modules/cdrca/Front-end/Transpiler-Plugins/quark";
const FRONTEND_INDEX_HTML_REL: &str = "node_modules/cdrca/Front-end/index.html";

const QUARK_PLUGIN_JS: &str = include_str!("templates/plugins/quark/plugin.js");
const QUARK_UI_JS: &str = include_str!("templates/plugins/quark/quark-ui.js");
const QUARK_CORE_JS: &str = include_str!("templates/plugins/quark/quark-core.js");
const QUARK_COMPONENTS_JS: &str = include_str!("templates/plugins/quark/quark-components.js");
const QUARK_TEMPLATES_JS: &str = include_str!("templates/plugins/quark/quark-templates.js");
const QUARK_FAMILIES_JS: &str = include_str!("templates/plugins/quark/quark-families.js");

/// Maps a `@useLib quark.<name>` reference to its actual bundled file +
/// content. Kept in one place so plugin.js's own `QUARK_LIBRARIES` (used
/// for parse-time validation) and this scan-to-script-tag step never
/// drift out of sync silently — if a name is added to one, it needs
/// adding here too, and vice versa.
fn quark_library_file(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "components" => Some(("quark-components.js", QUARK_COMPONENTS_JS)),
        "templates" => Some(("quark-templates.js", QUARK_TEMPLATES_JS)),
        "families" => Some(("quark-families.js", QUARK_FAMILIES_JS)),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum QuarkPatchOutcome {
    /// Files staged and a fresh entry added to plugins.json.
    Applied,
    /// A "quark" entry was already present; files were refreshed in place
    /// (kept in sync with the CLI's bundled copy) but plugins.json itself
    /// wasn't touched.
    AlreadyPatched,
    /// Files were staged, but this project's local CDRCA copy predates
    /// the plugin-hook system entirely (no `Back-end/Transpiler/plugin.js`
    /// found) — inert until that copy is updated. NOT a normal success.
    PluginSystemNotPresent,
    /// `node_modules/cdrca` isn't there at all — `npm install cdrca` must
    /// not have completed successfully.
    CdrcaNotFound(PathBuf),
}

impl QuarkPatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, QuarkPatchOutcome::Applied | QuarkPatchOutcome::AlreadyPatched)
    }
}

pub fn patch_quark(project_root: &Path) -> Result<QuarkPatchOutcome> {
    let cdrca_root = project_root.join(CDRCA_ROOT_REL);
    if !cdrca_root.is_dir() {
        return Ok(QuarkPatchOutcome::CdrcaNotFound(cdrca_root));
    }

    let plugin_system_present = project_root.join(PLUGIN_LOADER_REL).is_file();

    // Stage the files regardless — refreshing them is what keeps a
    // project's copy in sync with whatever version of Quark shipped with
    // this CLI, whether or not the hook system exists yet to use them.
    let plugins_dir = project_root.join(PLUGINS_DIR_REL).join("quark");
    std::fs::create_dir_all(&plugins_dir)
        .with_context(|| format!("creating {}", plugins_dir.display()))?;
    // Only plugin.js actually runs server-side (CDRCA's Back-end/Transpiler/
    // plugin.js require()s it directly — see that file). quark-ui.js,
    // quark-core.js, and the library bundles are browser-only (they check
    // `typeof window`) and are staged exclusively under the front-end path
    // below instead — staging them here too would just be dead weight
    // nothing ever loads.
    std::fs::write(plugins_dir.join("plugin.js"), QUARK_PLUGIN_JS)
        .context("writing quark/plugin.js")?;

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
        .any(|e| e.get("name").and_then(Value::as_str) == Some("quark"));

    if !already_present {
        entries.push(json!({
            "name": "quark",
            "path": "quark/plugin.js",
            "uses": [["syntax", "customRule"]],
            "permissions": []
        }));
        let raw = serde_json::to_string_pretty(&entries)?;
        std::fs::write(&plugins_json_path, raw)
            .with_context(|| format!("writing {}", plugins_json_path.display()))?;
    }

    if !plugin_system_present {
        return Ok(QuarkPatchOutcome::PluginSystemNotPresent);
    }

    Ok(if already_present {
        QuarkPatchOutcome::AlreadyPatched
    } else {
        QuarkPatchOutcome::Applied
    })
}

/// Loud, unmissable warning for the not-a-plain-success outcomes — same
/// spirit as patch::report_outcome(). Callers still continue either way.
pub fn report_quark_outcome(outcome: &QuarkPatchOutcome) {
    match outcome {
        QuarkPatchOutcome::Applied => {
            println!("Installed Quark (built-in @directive UI plugin) into this project.");
        }
        QuarkPatchOutcome::AlreadyPatched => {
            // Expected steady state — nothing to report.
        }
        QuarkPatchOutcome::PluginSystemNotPresent => {
            eprintln!();
            eprintln!("*** WARNING: Quark plugin staged, but is NOT active yet ***");
            eprintln!(
                "This project's local CDRCA copy (node_modules/cdrca) doesn't have the \
                 plugin-hook system Quark depends on (Back-end/Transpiler/plugin.js) — as of \
                 this CLI version, that only exists on CDRCA's GitHub main branch, not in the \
                 published npm package. `@id component.variant` directives will throw \
                 \"Unexpected token\" until this project's CDRCA copy is updated to a version \
                 that includes it — re-run `cdrca install cdrca` once it is."
            );
            eprintln!();
        }
        QuarkPatchOutcome::CdrcaNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: Quark could NOT be installed ***");
            eprintln!("Expected directory not found: {}", path.display());
            eprintln!("This usually means `npm install cdrca` did not complete successfully.");
            eprintln!();
        }
    }
}

// ===========================================================================
// Front-end page patching — loads Quark's runtime into the actual page
// CDRCA's Front-end/index.js eval()s generated JS_BLOCK code into. Separate
// from patch_quark() above (which only handles the Back-end/server side)
// since it touches a different file with a different patch strategy: a
// marker-delimited block that's fully replaced on every run, rather than a
// single find-and-replace line, because *which* library scripts belong in
// it changes based on this project's own @useLib directives.
// ===========================================================================

const QUARK_BLOCK_START: &str = "<!-- QUARK:START (managed by cdrca CLI — do not hand-edit, see cli/src/quark_patch.rs) -->";
const QUARK_BLOCK_END: &str = "<!-- QUARK:END -->";
/// Where CDRCA's own body ends — used to insert the Quark block right
/// before the closing tag if no previous Quark block exists yet.
const BODY_CLOSE_TAG: &str = "</body>";

#[derive(Debug, PartialEq, Eq)]
pub enum QuarkFrontendPatchOutcome {
    /// Block inserted or refreshed with this project's current @useLib scan.
    Applied,
    /// index.html doesn't exist — same underlying cause as
    /// QuarkPatchOutcome::CdrcaNotFound, reported separately since this is
    /// a different file.
    IndexHtmlNotFound(PathBuf),
    /// index.html exists but has neither a previous Quark block NOR a
    /// `</body>` tag to insert one before — CDRCA's front-end structure may
    /// have changed upstream. Not a silent no-op.
    NoInsertionPoint,
}

impl QuarkFrontendPatchOutcome {
    pub fn is_ok(&self) -> bool {
        matches!(self, QuarkFrontendPatchOutcome::Applied)
    }
}

/// Stages quark-core.js + quark-ui.js (always) and whichever library
/// bundles `libs` references (only those — see module docs for why an
/// unreferenced library isn't loaded), then patches
/// Front-end/index.html's managed block to declare a persistent
/// `#quarkRoot` container and the right `<script>` tags, in the required
/// load order: quark-core.js, then any library bundles, then quark-ui.js
/// (the compatibility shim generated JS_BLOCK code calls into — see
/// quark-ui.js's own header for why it must load last).
pub fn patch_quark_frontend(
    project_root: &Path,
    libs: &std::collections::BTreeSet<LibRef>,
) -> Result<QuarkFrontendPatchOutcome> {
    let index_html_path = project_root.join(FRONTEND_INDEX_HTML_REL);
    if !index_html_path.is_file() {
        return Ok(QuarkFrontendPatchOutcome::IndexHtmlNotFound(index_html_path));
    }

    let lib_dir = project_root.join(FRONTEND_LIB_DIR_REL);
    std::fs::create_dir_all(&lib_dir)
        .with_context(|| format!("creating {}", lib_dir.display()))?;
    std::fs::write(lib_dir.join("quark-core.js"), QUARK_CORE_JS)
        .context("writing Front-end quark-core.js")?;
    std::fs::write(lib_dir.join("quark-ui.js"), QUARK_UI_JS)
        .context("writing Front-end quark-ui.js")?;

    let mut library_script_tags = Vec::new();
    for lib in libs.iter().filter(|l| l.plugin_name == "quark") {
        if let Some((filename, contents)) = quark_library_file(&lib.library_name) {
            std::fs::write(lib_dir.join(filename), contents)
                .with_context(|| format!("writing Front-end {filename}"))?;
            library_script_tags.push(format!(
                "    <script src=\"./Transpiler-Plugins/quark/{filename}\"></script>"
            ));
        }
        // An unknown quark.<name> reference was already rejected with a
        // real error at transpile time by plugin.js's own QUARK_LIBRARIES
        // check — silently skipping it here too would just be redundant,
        // not a second point of enforcement worth adding.
    }

    // Built as a plain Vec<String> joined with "\n" rather than one large
    // literal with line-continuation escapes — much easier to read/edit
    // correctly than juggling backslash-newline + \x20 indentation tricks.
    let mut block_lines: Vec<String> = vec![
        QUARK_BLOCK_START.to_string(),
        "    <!-- Quark's persistent DOM root — survives refreshPreview()'s".to_string(),
        "         re-eval cycle, unlike the 3D scene, which is torn down and".to_string(),
        "         recreated every time. A .cdrca file's own JS_BLOCK code is".to_string(),
        "         the only way to create elements with a real id today (no".to_string(),
        "         DOM-authoring primitive exists in the language itself) —".to_string(),
        "         append into this container. See docs/QUARK.md. -->".to_string(),
        "    <div id=\"quarkRoot\"></div>".to_string(),
        "    <script src=\"./Transpiler-Plugins/quark/quark-core.js\"></script>".to_string(),
    ];
    block_lines.extend(library_script_tags);
    block_lines.push("    <script src=\"./Transpiler-Plugins/quark/quark-ui.js\"></script>".to_string());
    block_lines.push(QUARK_BLOCK_END.to_string());
    let block = block_lines.join("\n");

    let contents = std::fs::read_to_string(&index_html_path)
        .with_context(|| format!("reading {}", index_html_path.display()))?;

    let patched = if contents.contains(QUARK_BLOCK_START) {
        let start = contents.find(QUARK_BLOCK_START).unwrap();
        let end = match contents[start..].find(QUARK_BLOCK_END) {
            Some(rel_end) => start + rel_end + QUARK_BLOCK_END.len(),
            None => return Ok(QuarkFrontendPatchOutcome::NoInsertionPoint),
        };
        format!("{}{}{}", &contents[..start], block, &contents[end..])
    } else if let Some(idx) = contents.find(BODY_CLOSE_TAG) {
        format!("{}{}\n{}", &contents[..idx], block, &contents[idx..])
    } else {
        return Ok(QuarkFrontendPatchOutcome::NoInsertionPoint);
    };

    std::fs::write(&index_html_path, patched)
        .with_context(|| format!("writing patched {}", index_html_path.display()))?;

    Ok(QuarkFrontendPatchOutcome::Applied)
}

/// Convenience wrapper: scans this project's .cdrca source for @useLib
/// directives, then applies the front-end patch based on what it finds.
/// Separated from patch_quark_frontend() itself so tests can exercise the
/// patch logic directly with a hand-built LibRef set, without needing
/// real .cdrca files on disk.
pub fn scan_and_patch_quark_frontend(project_root: &Path) -> Result<QuarkFrontendPatchOutcome> {
    let libs = quark_libscan::scan_project(project_root)?;
    patch_quark_frontend(project_root, &libs)
}

pub fn report_quark_frontend_outcome(outcome: &QuarkFrontendPatchOutcome) {
    match outcome {
        QuarkFrontendPatchOutcome::Applied => {
            // Not worth a separate success line — patch_quark()'s own
            // "Installed Quark..." message already covers the common case.
        }
        QuarkFrontendPatchOutcome::IndexHtmlNotFound(path) => {
            eprintln!();
            eprintln!("*** WARNING: Quark's front-end runtime could NOT be installed ***");
            eprintln!("Expected file not found: {}", path.display());
            eprintln!(
                "@id directives will still transpile, but Quark/Quark.UI won't exist in the \
                 rendered page, so mount calls will fail at runtime."
            );
            eprintln!();
        }
        QuarkFrontendPatchOutcome::NoInsertionPoint => {
            eprintln!();
            eprintln!("*** WARNING: Quark's front-end runtime could NOT be installed ***");
            eprintln!(
                "Front-end/index.html has no previous Quark block and no `</body>` tag to \
                 insert one before — CDRCA's front-end structure may have changed upstream. \
                 @id directives will still transpile, but Quark/Quark.UI won't exist in the \
                 rendered page, so mount calls will fail at runtime."
            );
            eprintln!();
        }
    }
}

#[cfg(test)]
mod frontend_tests {
    use super::*;

    fn fake_frontend(dir: &Path, initial_html: &str) {
        let frontend_dir = dir.join("node_modules/cdrca/Front-end");
        std::fs::create_dir_all(&frontend_dir).unwrap();
        std::fs::write(frontend_dir.join("index.html"), initial_html).unwrap();
    }

    #[test]
    fn inserts_a_fresh_block_before_body_close() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body><div>hi</div></body></html>");

        let libs = std::collections::BTreeSet::new();
        let outcome = patch_quark_frontend(dir.path(), &libs).unwrap();
        assert_eq!(outcome, QuarkFrontendPatchOutcome::Applied);

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("id=\"quarkRoot\""));
        assert!(html.contains("quark-core.js"));
        assert!(html.contains("quark-ui.js"));
        // No library referenced -> no components/templates/families script tag.
        assert!(!html.contains("quark-components.js"));
        assert!(!html.contains("quark-templates.js"));
        assert!(!html.contains("quark-families.js"));
    }

    #[test]
    fn only_stages_referenced_libraries() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");

        let mut libs = std::collections::BTreeSet::new();
        libs.insert(LibRef {
            plugin_name: "quark".to_string(),
            library_name: "components".to_string(),
        });
        patch_quark_frontend(dir.path(), &libs).unwrap();

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("quark-components.js"));
        assert!(!html.contains("quark-templates.js"));

        let lib_file = dir.path().join(FRONTEND_LIB_DIR_REL).join("quark-components.js");
        assert!(lib_file.is_file(), "referenced library file must actually be written to disk");
        let unreferenced = dir.path().join(FRONTEND_LIB_DIR_REL).join("quark-templates.js");
        assert!(!unreferenced.is_file(), "unreferenced library must not be written");
    }

    #[test]
    fn families_library_stages_correctly_alongside_another_library() {
        // Regression coverage for the real drift bug found while adding
        // quark-families.js: quark_library_file()'s match arm and the
        // three duplicated Quark file copies (templates/plugins/quark,
        // the cdrca-runtime Back-end and Front-end bundled copies) all
        // had to be updated together, or @useLib quark.families would
        // validate at parse time but silently fail to actually stage the
        // script tag / file here.
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");

        let mut libs = std::collections::BTreeSet::new();
        libs.insert(LibRef {
            plugin_name: "quark".to_string(),
            library_name: "components".to_string(),
        });
        libs.insert(LibRef {
            plugin_name: "quark".to_string(),
            library_name: "families".to_string(),
        });
        patch_quark_frontend(dir.path(), &libs).unwrap();

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("quark-components.js"));
        assert!(html.contains("quark-families.js"));
        assert!(!html.contains("quark-templates.js"), "unreferenced library must still be excluded");

        // families.js must load after core (needs Quark.css) and before
        // ui.js (load-order comment in patch_quark_frontend's own doc
        // comment) — checked here as a real string-position assertion,
        // not just "both tags exist somewhere".
        let core_pos = html.find("quark-core.js").unwrap();
        let families_pos = html.find("quark-families.js").unwrap();
        let ui_pos = html.find("quark-ui.js").unwrap();
        assert!(core_pos < families_pos, "quark-core.js must load before quark-families.js");
        assert!(families_pos < ui_pos, "quark-families.js must load before quark-ui.js");

        let lib_file = dir.path().join(FRONTEND_LIB_DIR_REL).join("quark-families.js");
        assert!(lib_file.is_file(), "referenced families library file must actually be written to disk");
    }

    #[test]
    fn re_running_replaces_the_previous_block_instead_of_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");

        let mut libs = std::collections::BTreeSet::new();
        libs.insert(LibRef {
            plugin_name: "quark".to_string(),
            library_name: "components".to_string(),
        });
        patch_quark_frontend(dir.path(), &libs).unwrap();

        // Second run with a DIFFERENT library set — templates instead of
        // components — must fully replace the block, not accumulate both.
        let mut libs2 = std::collections::BTreeSet::new();
        libs2.insert(LibRef {
            plugin_name: "quark".to_string(),
            library_name: "templates".to_string(),
        });
        let outcome = patch_quark_frontend(dir.path(), &libs2).unwrap();
        assert_eq!(outcome, QuarkFrontendPatchOutcome::Applied);

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert_eq!(html.matches("id=\"quarkRoot\"").count(), 1, "must not duplicate the quarkRoot div");
        assert_eq!(html.matches(QUARK_BLOCK_START).count(), 1, "must not duplicate the managed block");
        assert!(html.contains("quark-templates.js"), "second run's library must be present");
        assert!(!html.contains("quark-components.js"), "first run's now-stale library must be gone");
    }

    #[test]
    fn missing_index_html_is_reported_not_silently_skipped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/cdrca/Front-end")).unwrap();
        let libs = std::collections::BTreeSet::new();
        let outcome = patch_quark_frontend(dir.path(), &libs).unwrap();
        match outcome {
            QuarkFrontendPatchOutcome::IndexHtmlNotFound(_) => {}
            other => panic!("expected IndexHtmlNotFound, got {other:?}"),
        }
        assert!(!outcome.is_ok());
    }

    #[test]
    fn scan_and_patch_end_to_end_from_real_cdrca_source() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");
        std::fs::write(
            dir.path().join("main.cdrca"),
            "@useLib quark.components\n@mainNav navbar.glass\n",
        )
        .unwrap();

        let outcome = scan_and_patch_quark_frontend(dir.path()).unwrap();
        assert_eq!(outcome, QuarkFrontendPatchOutcome::Applied);

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("quark-components.js"), "the scan must pick up @useLib from a real .cdrca file");
    }
}
