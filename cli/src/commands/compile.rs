//! `cdrca compile custom` — compiles a project's custom grammar-plugin
//! workspace (their edited copy of the grammar plugin, plus all the code
//! they added — "through source", i.e. diffed and validated against the
//! real base source, not just a snippet) into a shippable grammar package.
//!
//! This is deliberately a thin wrapper, not a reimplementation: the actual
//! diff/validate/package logic already exists and is fully tested —
//! `Plugins/grammar/packager.js`'s `packageWorkspace`, driven through
//! `Plugins/grammar/workspace.js`'s existing `init|add-grammar|test|package`
//! CLI — it was just never wired into the `cdrca` binary itself. This
//! module shells out to that same `workspace.js package <dir>` path
//! (`npm.rs` already sets the precedent for this CLI calling out to Node
//! rather than reimplementing something Node-side) so behavior can never
//! drift between the two entry points.
//!
//! Project convention: a workspace lives at `<project>/grammar-workspace/`
//! (matching `workspace.js`'s own on-disk shape: `grammar-workspace.js`,
//! `.base/plugin.js`, `deps/`, `grammar.plugin.json`) — there's no existing
//! convention to match since this was never wired in before now.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

const WORKSPACE_JS_REL: &str =
    "node_modules/cdrca/Back-end/Transpiler/Plugins/grammar/workspace.js";
pub const DEFAULT_WORKSPACE_DIR_NAME: &str = "grammar-workspace";

fn node_program() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn workspace_js_path(project_root: &Path) -> Result<PathBuf> {
    let path = project_root.join(WORKSPACE_JS_REL);
    if !path.is_file() {
        bail!(
            "{} not found — is this a CDRCA project with `node_modules/cdrca` installed? \
             (run `cdrca install cdrca` first)",
            path.display()
        );
    }
    Ok(path)
}

/// `cdrca compile custom [--workspace <dir>]`. Runs the workspace's full
/// diff-against-base validation (packager.js rules 1-5: no shared-code
/// edits, insertions only between top-level statements, only additive
/// registrations/declarations, no reaching into base-internal names, no
/// name collisions against a fresh registry) over everything the author
/// added, then writes `<workspace>/dist/<name>.grammar.json` on success.
pub fn run(project_root: &Path, workspace_dir: Option<&str>) -> Result<()> {
    let workspace_js = workspace_js_path(project_root)?;
    let workspace_dir = match workspace_dir {
        Some(d) => project_root.join(d),
        None => project_root.join(DEFAULT_WORKSPACE_DIR_NAME),
    };
    if !workspace_dir.is_dir() {
        bail!(
            "no grammar workspace at {} — create one first with `cdrca compile custom --init <plugin-name>`",
            workspace_dir.display()
        );
    }

    let output = Command::new(node_program())
        .arg(&workspace_js)
        .arg("package")
        .arg(&workspace_dir)
        .output()
        .with_context(|| format!("running node {} package", workspace_js.display()))?;

    print!("{}", String::from_utf8_lossy(&output.stdout));
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        bail!(
            "compiling the grammar workspace failed (see errors above) — every insertion must be \
             new, additive, top-level code; nothing from the base grammar may be changed"
        );
    }
    Ok(())
}

/// `cdrca compile custom --init <plugin-name>`. Scaffolds a fresh workspace
/// directory the author edits directly (`grammar-workspace.js`), same as
/// running `node workspace.js init <dir> <name>` by hand.
pub fn init(project_root: &Path, plugin_name: &str, workspace_dir: Option<&str>) -> Result<()> {
    let workspace_js = workspace_js_path(project_root)?;
    let workspace_dir = match workspace_dir {
        Some(d) => project_root.join(d),
        None => project_root.join(DEFAULT_WORKSPACE_DIR_NAME),
    };

    let output = Command::new(node_program())
        .arg(&workspace_js)
        .arg("init")
        .arg(&workspace_dir)
        .arg(plugin_name)
        .output()
        .with_context(|| format!("running node {} init", workspace_js.display()))?;

    print!("{}", String::from_utf8_lossy(&output.stdout));
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        bail!("initializing the grammar workspace failed (see errors above)");
    }
    println!(
        "Edit {}/grammar-workspace.js, then run `cdrca compile custom` when ready.",
        workspace_dir.display()
    );
    Ok(())
}

/// The path `cdrca export` should look for a compiled grammar package at,
/// for a workspace-based custom grammar plugin, once `compile custom` has
/// succeeded — used by export.rs to fold a compiled grammar package into
/// its "export everything" pass rather than requiring a separate manual step.
pub fn compiled_package_path(project_root: &Path, workspace_dir: Option<&str>, plugin_name: &str) -> PathBuf {
    let workspace_dir = match workspace_dir {
        Some(d) => project_root.join(d),
        None => project_root.join(DEFAULT_WORKSPACE_DIR_NAME),
    };
    workspace_dir
        .join("dist")
        .join(format!("{plugin_name}.grammar.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_project_with_runtime(dir: &Path) {
        // Copies the real workspace.js + packager.js + plugin.js so tests
        // exercise the actual Node-side logic, not a stub.
        let src_base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/templates/cdrca-runtime/Back-end/Transpiler/Plugins/grammar");
        let dst = dir.join("node_modules/cdrca/Back-end/Transpiler/Plugins/grammar");
        std::fs::create_dir_all(&dst).unwrap();
        for f in ["workspace.js", "packager.js", "plugin.js"] {
            std::fs::copy(src_base.join(f), dst.join(f)).unwrap();
        }
        // packager.js requires acorn at runtime (see the fix to the bundled
        // runtime's package.json — this dependency previously only lived
        // in a nested, never-installed grammar/package.json and so was
        // silently missing from every real installed project). Symlink the
        // CLI workspace's own copy rather than running `npm install`
        // per-test, matching how a real project's `node_modules/cdrca`
        // sits alongside its own top-level `node_modules/acorn`.
        let acorn_src = Path::new(env!("CARGO_MANIFEST_DIR")).join("node_modules/acorn");
        if acorn_src.is_dir() {
            let acorn_dst = dir.join("node_modules/acorn");
            #[cfg(unix)]
            std::os::unix::fs::symlink(&acorn_src, &acorn_dst).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_dir(&acorn_src, &acorn_dst).unwrap();
        }
    }

    fn have_node() -> bool {
        Command::new(node_program())
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn missing_runtime_is_a_clear_error_not_a_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let err = run(tmp.path(), None).unwrap_err();
        assert!(err.to_string().contains("node_modules/cdrca"));
    }

    #[test]
    fn missing_workspace_dir_is_a_clear_error() {
        if !have_node() {
            eprintln!("skipping: node not available in this environment");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        fake_project_with_runtime(tmp.path());
        let err = run(tmp.path(), None).unwrap_err();
        assert!(err.to_string().contains("no grammar workspace"));
    }

    #[test]
    fn init_then_compile_a_trivial_addition_end_to_end() {
        if !have_node() {
            eprintln!("skipping: node not available in this environment");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        fake_project_with_runtime(tmp.path());

        init(tmp.path(), "my-test-plugin", None).unwrap();
        let ws = tmp.path().join(DEFAULT_WORKSPACE_DIR_NAME);
        assert!(ws.join("grammar-workspace.js").is_file());

        // Append one trivial, valid, additive top-level statement — a
        // registration is more representative than a bare const, but a
        // const already proves the "insertion classified and shipped"
        // path since we're not testing packager.js's own logic here (it
        // has its own extensive test suite in grammar/tests/).
        let ws_file = ws.join("grammar-workspace.js");
        let mut content = std::fs::read_to_string(&ws_file).unwrap();
        content = content.replace(
            "module.exports = function (pluginAPI) {",
            "const MY_TEST_PLUGIN_MARKER = true;\n\nmodule.exports = function (pluginAPI) {",
        );
        std::fs::write(&ws_file, content).unwrap();

        run(tmp.path(), None).unwrap();
        let compiled = compiled_package_path(tmp.path(), None, "my-test-plugin");
        assert!(compiled.is_file(), "expected {} to exist", compiled.display());
        let pkg: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&compiled).unwrap()).unwrap();
        assert_eq!(pkg["owner"], "my-test-plugin");
        assert!(pkg["source"].as_str().unwrap().contains("MY_TEST_PLUGIN_MARKER"));
    }

    #[test]
    fn editing_shared_base_code_is_refused_not_silently_shipped() {
        if !have_node() {
            eprintln!("skipping: node not available in this environment");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        fake_project_with_runtime(tmp.path());
        init(tmp.path(), "bad-plugin", None).unwrap();
        let ws = tmp.path().join(DEFAULT_WORKSPACE_DIR_NAME);
        let ws_file = ws.join("grammar-workspace.js");
        let mut content = std::fs::read_to_string(&ws_file).unwrap();
        // Mutate an existing base line rather than only adding new ones.
        content = content.replacen("module.exports = function (pluginAPI) {", "module.exports = function (tamperedAPI) {", 1);
        std::fs::write(&ws_file, content).unwrap();

        let err = run(tmp.path(), None);
        assert!(err.is_err(), "editing shared base code must fail compilation");
        assert!(!compiled_package_path(tmp.path(), None, "bad-plugin").is_file());
    }
}
