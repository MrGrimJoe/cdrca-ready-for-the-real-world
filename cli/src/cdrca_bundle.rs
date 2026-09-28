//! A complete, fixed copy of CDRCA's actual language runtime, bundled
//! directly into this CLI binary (`include_str!`, same pattern as
//! `quark_patch.rs`'s Quark files) and installed in place of
//! `npm install cdrca` when the published npm package can't do the job.
//!
//! ## Why this exists
//!
//! The published npm `cdrca` package is missing an entire subsystem, not
//! just missing Quark: `Back-end/Transpiler/plugin.js` (the plugin-hook
//! loader) and the `pluginAPI` wiring in `Parser.js` that Quark's
//! `("syntax","customRule")` hook depends on are present on CDRCA's GitHub
//! `main` branch but confirmed absent from the published package — verified
//! directly by installing it and running an `@id ...` directive through
//! its actual `transpile()` export, which throws `Unexpected token`. A
//! missing subsystem isn't something `patch.rs`'s find-and-replace style
//! can restore (there's no existing line to rewrite), so staging a real,
//! working copy is the only complete fix.
//!
//! On top of that, this bundled copy carries a further real bug fix,
//! confirmed by actually running CDRCA's own transpiler end-to-end, not
//! by reading source: `FullTranspiler.js`'s `reshapeToInps()` only
//! forwards a statement into final output if its `type` matches a
//! hardcoded key list (`ACTION_DEF`, `PROP_DEF`, `scenes`, etc.) —
//! `"JS_BLOCK"` was never one of those keys, so *any* plugin compiling to
//! a `JS_BLOCK` node (Quark included) had its generated code silently
//! vanish from final output, with no error. This predates all of Quark's
//! own code and would have affected Quark even once the plugin-hook
//! system above is restored. Fixed here by adding a `JS_BLOCK` key and a
//! template entry that emits collected `JS_BLOCK` statements right after
//! `OAS_OBJ` is built, before the scene starts.
//!
//! ## What's intentionally NOT bundled
//!
//! CDRCA's real repository also ships a full Monaco-based visual code
//! editor (`Front-end/textEditerWindow/`, ~100MB) as an iframe inside its
//! `Front-end/index.html`. That's the browser IDE experience, not
//! something `cdrca build`/`cdrca run`'s headless execution needs — it is
//! deliberately excluded here to keep the CLI binary a sane size. The
//! bundled `Front-end/index.html` still references that iframe by path;
//! if a project wants the visual editor too, it needs `textEditerWindow/`
//! copied in separately (not automated by this CLI, out of scope for a
//! `.cdrca` build/run tool).
//!
//! ## Verification
//!
//! Every file here matches a real transpile of actual `.cdrca` source
//! through this exact bundled copy of `Back-end/Transpiler/index.js` —
//! see the CDRCA-source-side `tests/quark.test.js` this was validated
//! against (8/8 passing, including 3 covering `@useLib` specifically) —
//! not assumed correct from reading the code alone.

use anyhow::{Context, Result};
use std::path::Path;

/// One embedded file: its path relative to `node_modules/cdrca/`, and its
/// contents. Declared as a flat list rather than a nested struct so adding
/// a new file is a one-line change, and so `write_all` can stay a simple
/// loop rather than mirroring the directory tree in Rust code too.
const BUNDLED_FILES: &[(&str, &str)] = &[
    ("package.json", include_str!("templates/cdrca-runtime/package.json")),
    ("package-lock.json", include_str!("templates/cdrca-runtime/package-lock.json")),
    ("LICENSE.md", include_str!("templates/cdrca-runtime/LICENSE.md")),
    ("README.md", include_str!("templates/cdrca-runtime/README.md")),
    ("index.js", include_str!("templates/cdrca-runtime/index.js")),
    (
        "Back-end/serverManager.js",
        include_str!("templates/cdrca-runtime/Back-end/serverManager.js"),
    ),
    (
        "Back-end/Servers/main/index.js",
        include_str!("templates/cdrca-runtime/Back-end/Servers/main/index.js"),
    ),
    (
        "Back-end/Transpiler/index.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/index.js"),
    ),
    (
        "Back-end/Transpiler/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/plugin.js"),
    ),
    (
        "Back-end/Transpiler/Parser.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Parser.js"),
    ),
    (
        "Back-end/Transpiler/Tokenizer.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Tokenizer.js"),
    ),
    (
        "Back-end/Transpiler/Partial_transpiler.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Partial_transpiler.js"),
    ),
    (
        "Back-end/Transpiler/postSemanticAnalyizer.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/postSemanticAnalyizer.js"),
    ),
    (
        "Back-end/Transpiler/FullTranspiler.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/FullTranspiler.js"),
    ),
    (
        "Back-end/Transpiler/PostOptionalParsing.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/PostOptionalParsing.js"),
    ),
    (
        "Back-end/Transpiler/commonUtility.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/commonUtility.js"),
    ),
    (
        "Back-end/Transpiler/temp.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/temp.js"),
    ),
    (
        "Back-end/Transpiler/MINI_SYS/index.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/MINI_SYS/index.js"),
    ),
    (
        "Back-end/Transpiler/MINI_SYS/forming.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/MINI_SYS/forming.js"),
    ),
    (
        "Back-end/Transpiler/MINI_SYS/embeedings.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/MINI_SYS/embeedings.js"),
    ),
    (
        "Back-end/Transpiler/MINI_SYS/processManager.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/MINI_SYS/processManager.js"),
    ),
    (
        "Back-end/Transpiler/MINI_SYS/tests.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/MINI_SYS/tests.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/plugins.json",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/plugins.json"),
    ),
    (
        // The v2 statement grammar. Registered FIRST in plugins.json: it
        // rewrites a file's v2 statements into legacy ones before any other
        // plugin or the parser sees it, and leaves everything else untouched.
        "Back-end/Transpiler/Plugins/grammar/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/grammar/plugin.js"),
    ),
    (
        // Registered in plugins.json, so it MUST be written. It used to be
        // missing from this list: a CLI-scaffolded project then had
        // `animations` in plugins.json but no file behind it, and every
        // animations-owned statement (`background`, ...) failed with
        // "Unexpected token" — with no warning from the plugin loader.
        "Back-end/Transpiler/Plugins/animations/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/animations/plugin.js"),
    ),
    (
        // Same bug, same fix, found the same way: registered in
        // plugins.json but ABSENT from this bundle, so a CLI-scaffolded
        // project had `cdrca-reactive-state` in plugins.json with no file
        // behind it and every `state`/`computed`/`watch`/`bind`/event
        // statement — the entire reactive-state language, not an edge case
        // — failed with "Unexpected token", again with no warning from the
        // plugin loader. Caught by docs/SYNTAX.md's own compile-checked
        // examples, not by a targeted test: every existing reactive-state
        // test staged this plugin manually into a throwaway copy instead of
        // using the real default bundle, which is exactly how this stayed
        // invisible.
        "Back-end/Transpiler/Plugins/cdrca-reactive-state/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/cdrca-reactive-state/plugin.js"),
    ),
    (
        // `ember` and `campfire` are bundled by default, so they are registered in
        // plugins.json — which means (same rule as the entries above) their
        // files MUST be written here, or a CLI-scaffolded project would register
        // plugins with no file behind them and every `@id fx ...` / `speaker` /
        // `say` / `choice` statement would fail with no warning from the loader.
        // Their `load ember.*` / `load campfire.*` library bundles are staged
        // separately, the same way `cdrca-reactive-state`'s are.
        "Back-end/Transpiler/Plugins/ember/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/plugin.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/campfire/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/campfire/plugin.js"),
    ),
    // Each default-bundled plugin's own manifest and browser-side library
    // bundles. `plugin_frontend_patch.rs` resolves `load <plugin>.<library>`
    // (and `@useLib`) by reading `Plugins/<plugin>/cdrca.json` and copying the
    // declared files into `Front-end/Transpiler-Plugins/<plugin>/`. Without
    // these, only `plugin.js` existed, so the statements compiled but
    // `Ember`, `Campfire` and `CDRCA.reactive` were never defined on a served
    // page. Declared in cdrca.json's `libraries`; see the
    // `every_declared_library_is_bundled` test below.
    (
        "Back-end/Transpiler/Plugins/ember/cdrca.json",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/cdrca.json"),
    ),
    (
        "Back-end/Transpiler/Plugins/ember/ember-core.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/ember-core.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/ember/ember-easings.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/ember-easings.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/ember/ember-presets.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/ember-presets.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/ember/ember-sequences.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/ember/ember-sequences.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/campfire/cdrca.json",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/campfire/cdrca.json"),
    ),
    (
        "Back-end/Transpiler/Plugins/campfire/campfire-core.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/campfire/campfire-core.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/campfire/campfire-ui.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/campfire/campfire-ui.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/cdrca-reactive-state/cdrca.json",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/cdrca-reactive-state/cdrca.json"),
    ),
    (
        "Back-end/Transpiler/Plugins/cdrca-reactive-state/runtime.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/cdrca-reactive-state/runtime.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/cdrca-reactive-state/reactive-state-store.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/cdrca-reactive-state/reactive-state-store.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/cdrca-reactive-state/reactive-state-query.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/cdrca-reactive-state/reactive-state-query.js"),
    ),
    (
        "Back-end/Transpiler/Plugins/quark/plugin.js",
        include_str!("templates/cdrca-runtime/Back-end/Transpiler/Plugins/quark/plugin.js"),
    ),
    (
        "Front-end/index.html",
        include_str!("templates/cdrca-runtime/Front-end/index.html"),
    ),
    (
        "Front-end/index.css",
        include_str!("templates/cdrca-runtime/Front-end/index.css"),
    ),
    (
        "Front-end/index.js",
        include_str!("templates/cdrca-runtime/Front-end/index.js"),
    ),
    (
        "Front-end/Parser.js",
        include_str!("templates/cdrca-runtime/Front-end/Parser.js"),
    ),
    (
        "Front-end/Renderer.js",
        include_str!("templates/cdrca-runtime/Front-end/Renderer.js"),
    ),
    (
        "Front-end/three.js",
        include_str!("templates/cdrca-runtime/Front-end/three.js"),
    ),
    (
        "Front-end/Transpiler-Plugins/quark/quark-core.js",
        include_str!("templates/cdrca-runtime/Front-end/Transpiler-Plugins/quark/quark-core.js"),
    ),
    (
        "Front-end/Transpiler-Plugins/quark/quark-components.js",
        include_str!(
            "templates/cdrca-runtime/Front-end/Transpiler-Plugins/quark/quark-components.js"
        ),
    ),
    (
        "Front-end/Transpiler-Plugins/quark/quark-templates.js",
        include_str!(
            "templates/cdrca-runtime/Front-end/Transpiler-Plugins/quark/quark-templates.js"
        ),
    ),
    (
        // Pre-existing gap, found while adding animations-backdrop.js
        // below: index.html's own <script> tag for this file has always
        // pointed here, but this file's own BUNDLED_FILES list never
        // actually included it — a project relying on this fallback
        // bundled runtime (see installed_copy_has_plugin_system() above)
        // would 404 on it. Unrelated to the animations/backdrop work,
        // just adjacent and cheap to fix while already in this list.
        "Front-end/Transpiler-Plugins/quark/quark-families.js",
        include_str!(
            "templates/cdrca-runtime/Front-end/Transpiler-Plugins/quark/quark-families.js"
        ),
    ),
    (
        "Front-end/Transpiler-Plugins/quark/quark-ui.js",
        include_str!("templates/cdrca-runtime/Front-end/Transpiler-Plugins/quark/quark-ui.js"),
    ),
    (
        "Front-end/Transpiler-Plugins/animations/animations-backdrop.js",
        include_str!(
            "templates/cdrca-runtime/Front-end/Transpiler-Plugins/animations/animations-backdrop.js"
        ),
    ),
];

/// Quick, cheap probe: does this project's *currently installed*
/// `node_modules/cdrca` already have the plugin-hook system Quark (and any
/// future plugin) needs? Checks for the loader file's existence — the
/// same file `quark_patch.rs`'s `PLUGIN_LOADER_REL` checks — rather than
/// actually running a transpile, since this only needs to decide whether
/// to prefer the registry copy or fall back to the bundled one.
pub fn installed_copy_has_plugin_system(project_root: &Path) -> bool {
    project_root
        .join("node_modules/cdrca/Back-end/Transpiler/plugin.js")
        .is_file()
}

/// Writes the complete bundled runtime into `node_modules/cdrca/`,
/// overwriting anything already there (e.g. a stale/broken npm-installed
/// copy). Does NOT run `npm install` itself — the caller does that
/// afterward, in `node_modules/cdrca/`, to pull in the real `express`/
/// `prettier`/`vm` dependencies this bundled `package.json` declares;
/// keeping that as a separate, explicit step (rather than hiding it in
/// here) matches `npm.rs`'s existing convention of never running npm
/// silently inside a helper the caller can't see.
pub fn write_bundled_runtime(project_root: &Path) -> Result<()> {
    let cdrca_root = project_root.join("node_modules/cdrca");
    for (rel_path, contents) in BUNDLED_FILES {
        let full_path = cdrca_root.join(rel_path);
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::write(&full_path, contents)
            .with_context(|| format!("writing {}", full_path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_every_bundled_file_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        write_bundled_runtime(dir.path()).unwrap();
        for (rel_path, _) in BUNDLED_FILES {
            let full_path = dir.path().join("node_modules/cdrca").join(rel_path);
            assert!(full_path.is_file(), "expected {rel_path} to be written");
        }
    }

    #[test]
    fn bundled_plugin_js_contains_the_verified_fixes() {
        let dir = tempfile::tempdir().unwrap();
        write_bundled_runtime(dir.path()).unwrap();
        let plugin_js = std::fs::read_to_string(
            dir.path()
                .join("node_modules/cdrca/Back-end/Transpiler/Plugins/quark/plugin.js"),
        )
        .unwrap();
        assert!(
            plugin_js.contains("pluginAPI.register"),
            "must have the corrected register() call shape, not the old broken one"
        );
    }

    #[test]
    fn bundled_full_transpiler_contains_the_js_block_fix() {
        let dir = tempfile::tempdir().unwrap();
        write_bundled_runtime(dir.path()).unwrap();
        let full_transpiler = std::fs::read_to_string(
            dir.path()
                .join("node_modules/cdrca/Back-end/Transpiler/FullTranspiler.js"),
        )
        .unwrap();
        assert!(
            full_transpiler.contains("JS_BLOCK: []"),
            "must have the fix for JS_BLOCK statements being silently dropped"
        );
    }

    fn bundled(rel: &str) -> Option<&'static str> {
        BUNDLED_FILES.iter().find(|(p, _)| *p == rel).map(|(_, c)| *c)
    }

    /// Every plugin `plugins.json` registers has to be an actual file in the
    /// bundle — the loader doesn't complain about a registered-but-missing
    /// plugin, it just never runs it.
    #[test]
    fn every_registered_plugin_is_bundled() {
        let json = bundled("Back-end/Transpiler/Plugins/plugins.json").unwrap();
        let list: serde_json::Value = serde_json::from_str(json).unwrap();
        let mut checked = 0;
        for entry in list.as_array().unwrap() {
            let path = entry["path"].as_str().unwrap();
            let rel = format!("Back-end/Transpiler/Plugins/{path}");
            assert!(
                bundled(&rel).is_some(),
                "plugins.json registers {path:?} but {rel} is not in BUNDLED_FILES"
            );
            checked += 1;
        }
        assert!(checked >= 2, "expected at least animations + quark, saw {checked}");
    }

    /// Every local <script src> in the bundled page has to exist in the
    /// bundle, matched CASE-SENSITIVELY — a lowercase tag for a capitalised
    /// file works on Windows and 404s everywhere else.
    #[test]
    fn every_page_script_tag_is_bundled() {
        let html = bundled("Front-end/index.html").unwrap();
        let mut checked = 0;
        for line in html.lines() {
            let line = line.trim();
            if line.starts_with("<!--") || !line.contains("<script") {
                continue;
            }
            let Some(after) = line.split("src=\"").nth(1) else { continue };
            let Some(src) = after.split('"').next() else { continue };
            if src.starts_with("http") {
                continue;
            }
            let rel = format!("Front-end/{}", src.trim_start_matches("./"));
            assert!(
                bundled(&rel).is_some(),
                "index.html loads {src:?} but {rel} is not in BUNDLED_FILES (exact case)"
            );
            checked += 1;
        }
        assert!(checked >= 5, "expected several script tags, saw {checked}");
    }

    /// Every relative require("./x") between bundled back-end files has to
    /// resolve inside the bundle.
    #[test]
    fn every_relative_require_in_the_backend_is_bundled() {
        let mut checked = 0;
        for (rel, contents) in BUNDLED_FILES {
            if !rel.starts_with("Back-end/") || !rel.ends_with(".js") {
                continue;
            }
            let dir = std::path::Path::new(rel).parent().unwrap();
            for chunk in contents.split("require(\"").skip(1) {
                let Some(spec) = chunk.split('"').next() else { continue };
                if !spec.starts_with("./") && !spec.starts_with("../") {
                    continue;
                }
                let joined = dir.join(spec);
                let mut parts: Vec<String> = Vec::new();
                for c in joined.components() {
                    match c {
                        std::path::Component::ParentDir => {
                            parts.pop();
                        }
                        std::path::Component::Normal(p) => parts.push(p.to_string_lossy().into()),
                        _ => {}
                    }
                }
                let base = parts.join("/");
                let candidates = [base.clone(), format!("{base}.js"), format!("{base}/index.js")];
                assert!(
                    candidates.iter().any(|c| bundled(c).is_some()),
                    "{rel} requires {spec:?} but none of {candidates:?} is in BUNDLED_FILES"
                );
                checked += 1;
            }
        }
        assert!(checked >= 5, "expected several relative requires, saw {checked}");
    }

    /// Every library a bundled plugin declares in its cdrca.json has to be an
    /// actual file next to it, or `load <plugin>.<library>` resolves to
    /// nothing and the browser global never exists.
    #[test]
    fn every_declared_library_is_bundled() {
        let mut checked = 0;
        for (rel, contents) in BUNDLED_FILES {
            if !rel.starts_with("Back-end/Transpiler/Plugins/") || !rel.ends_with("/cdrca.json") {
                continue;
            }
            let dir = rel.trim_end_matches("cdrca.json");
            let manifest: serde_json::Value = serde_json::from_str(contents).unwrap();
            let Some(libs) = manifest["libraries"].as_object() else { continue };
            for (name, file) in libs {
                let file = file.as_str().unwrap();
                assert!(
                    bundled(&format!("{dir}{file}")).is_some(),
                    "{rel} declares library {name:?} -> {file} but it is not in BUNDLED_FILES"
                );
                checked += 1;
            }
        }
        assert!(checked >= 9, "expected ember + campfire + reactive-state libraries, saw {checked}");
    }

    #[test]
    fn detects_a_missing_plugin_system_correctly() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/cdrca")).unwrap();
        assert!(!installed_copy_has_plugin_system(dir.path()));

        write_bundled_runtime(dir.path()).unwrap();
        assert!(installed_copy_has_plugin_system(dir.path()));
    }
}
