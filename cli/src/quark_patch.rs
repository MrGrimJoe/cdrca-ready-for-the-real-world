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

use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const CDRCA_ROOT_REL: &str = "node_modules/cdrca";
const PLUGINS_DIR_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins";
const PLUGIN_LOADER_REL: &str = "node_modules/cdrca/Back-end/Transpiler/plugin.js";
const PLUGINS_JSON_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins/plugins.json";

const QUARK_PLUGIN_JS: &str = include_str!("templates/plugins/quark/plugin.js");
const QUARK_UI_JS: &str = include_str!("templates/plugins/quark/quark-ui.js");

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
    std::fs::write(plugins_dir.join("plugin.js"), QUARK_PLUGIN_JS)
        .context("writing quark/plugin.js")?;
    std::fs::write(plugins_dir.join("quark-ui.js"), QUARK_UI_JS)
        .context("writing quark/quark-ui.js")?;

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
                 published npm package. `@sidebar ...`-style directives will throw \
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
