//! Generalizes `quark_patch.rs`'s frontend-patching step beyond Quark —
//! plan-doc section 1.3. Quark's own patching (`quark_patch::patch_quark_frontend`)
//! is untouched here and still runs exactly as before, keeping its
//! already-verified behavior (the persistent `#quarkRoot` div, the
//! required core/ui load order) intact; this module ADDS the generic
//! path for every OTHER plugin's `@useLib` directives, which previously
//! had no resolution at all — `quark_libscan.rs`'s scanner already found
//! them (it was never Quark-specific), the result just got thrown away
//! for anything that wasn't `quark.*`.
//!
//! Resolution order for a `@useLib <plugin>.<library>` directive where
//! `<plugin>` isn't `"quark"`:
//! 1. The target plugin's OWN declared `libraries` map (staged
//!    alongside its `plugin.js` by `plugin_stage.rs` into
//!    `Plugins/<plugin>/cdrca.json` — read back from there, not
//!    re-fetched from the registry).
//! 2. Every installed `type: "library"` package whose `providesFor`
//!    matches (see `library_stage.rs`'s `libraries.json` index) — this
//!    is the piece that needs zero coordination from the target
//!    plugin's author.
//!
//! Unlike Quark, a generic plugin has no CLI-known concept of an
//! "always loaded core script" (Quark's `quark-core.js`/`quark-ui.js`)
//! — the manifest schema (plan-doc 1.2) only covers opt-in
//! `@useLib`-gated bundles. A plugin whose generated `JS_BLOCK` code
//! needs something loaded unconditionally has to ask its users to
//! `@useLib` a bundle it names for that purpose (e.g. `@useLib
//! myplugin.core`) — the same mechanism, used deliberately for the
//! "always" case. This is a real, documented limitation, not an
//! oversight — see docs/PLUGIN-LIBRARIES.md.

use crate::library_stage;
use crate::manifest::Manifest;
use crate::quark_libscan::{self, LibRef};
use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::path::Path;

const PLUGINS_DIR_REL: &str = "node_modules/cdrca/Back-end/Transpiler/Plugins";
const FRONTEND_PLUGINS_DIR_REL: &str = "node_modules/cdrca/Front-end/Transpiler-Plugins";
const FRONTEND_INDEX_HTML_REL: &str = "node_modules/cdrca/Front-end/index.html";
const BODY_CLOSE_TAG: &str = "</body>";

fn plugin_block_markers(plugin_name: &str) -> (String, String) {
    (
        format!("<!-- PLUGIN:{plugin_name}:START (managed by cdrca CLI — do not hand-edit, see cli/src/plugin_frontend_patch.rs) -->"),
        format!("<!-- PLUGIN:{plugin_name}:END -->"),
    )
}

#[derive(Debug, PartialEq, Eq)]
pub enum GenericLibraryResolution {
    /// Resolved via the target plugin's own declared `libraries` map.
    FromPluginOwnLibraries,
    /// Resolved via an installed `type: "library"` package's `providesFor`.
    FromInstalledLibraryPackage,
    /// Neither source had it — reported loudly, since there's no
    /// per-plugin parse-time check (unlike Quark's own `QUARK_LIBRARIES`)
    /// to catch this earlier for a third-party plugin.
    Unresolved,
}

/// Result for one non-Quark plugin referenced somewhere in this project's
/// `.cdrca` source.
#[derive(Debug)]
pub struct PluginFrontendResult {
    pub plugin_name: String,
    pub resolutions: Vec<(LibRef, GenericLibraryResolution)>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PluginFrontendPatchOutcome {
    /// index.html was found and patched (possibly with zero non-Quark
    /// plugin blocks, if none were referenced — still a normal outcome,
    /// not an error).
    Applied,
    IndexHtmlNotFound,
}

/// Convenience wrapper: scans this project's `.cdrca` source for
/// `@useLib` directives, runs Quark's own (unchanged) frontend patch for
/// `quark.*` references, and generically resolves + patches every other
/// plugin's references. This is the ONE call site `create.rs`/`install.rs`
/// should use — it supersedes calling
/// `quark_patch::scan_and_patch_quark_frontend` directly.
pub fn scan_and_patch_plugin_frontends(
    project_root: &Path,
) -> Result<(
    crate::quark_patch::QuarkFrontendPatchOutcome,
    PluginFrontendPatchOutcome,
    Vec<PluginFrontendResult>,
)> {
    let all_libs = quark_libscan::scan_project(project_root)?;

    // patch_quark_frontend() already filters internally for
    // `plugin_name == "quark"` (see its own body) — no need to
    // pre-filter here too; passing the full scan result through is both
    // simpler and exactly what `quark_patch::scan_and_patch_quark_frontend`
    // itself does.
    let quark_outcome = crate::quark_patch::patch_quark_frontend(project_root, &all_libs)?;

    let mut by_plugin: BTreeMap<String, Vec<LibRef>> = BTreeMap::new();
    for lib in all_libs.iter().filter(|l| l.plugin_name != "quark") {
        by_plugin.entry(lib.plugin_name.clone()).or_default().push(lib.clone());
    }

    let (generic_outcome, results) = patch_generic_plugin_frontends(project_root, &by_plugin)?;
    Ok((quark_outcome, generic_outcome, results))
}

/// Separated from the scan-based convenience wrapper above so tests can
/// exercise this with a hand-built `by_plugin` map, without needing real
/// `.cdrca` files on disk — same split as
/// `quark_patch::patch_quark_frontend` vs `scan_and_patch_quark_frontend`.
pub fn patch_generic_plugin_frontends(
    project_root: &Path,
    by_plugin: &BTreeMap<String, Vec<LibRef>>,
) -> Result<(PluginFrontendPatchOutcome, Vec<PluginFrontendResult>)> {
    let index_html_path = project_root.join(FRONTEND_INDEX_HTML_REL);
    if !index_html_path.is_file() {
        return Ok((PluginFrontendPatchOutcome::IndexHtmlNotFound, Vec::new()));
    }

    let staged_libraries = library_stage::read_staged_libraries(project_root)?;

    let mut contents = std::fs::read_to_string(&index_html_path)
        .with_context(|| format!("reading {}", index_html_path.display()))?;
    let mut results = Vec::new();

    for (plugin_name, libs) in by_plugin {
        let mut resolutions = Vec::new();
        let mut script_tags = Vec::new();

        for lib in libs {
            let resolution = resolve_and_stage_one(
                project_root,
                plugin_name,
                &lib.library_name,
                &staged_libraries,
                &mut script_tags,
            )?;
            resolutions.push((lib.clone(), resolution));
        }

        contents = replace_or_insert_block(&contents, plugin_name, &script_tags);
        results.push(PluginFrontendResult {
            plugin_name: plugin_name.clone(),
            resolutions,
        });
    }

    // Plugins that USED to be referenced but no longer are still need
    // their stale block removed — otherwise a removed @useLib line would
    // leave a dangling <script> tag pointing at a file that may no
    // longer even be staged. Scan for any existing "PLUGIN:<name>:START"
    // marker not in this run's `by_plugin` and strip it.
    contents = strip_stale_blocks(&contents, by_plugin);

    std::fs::write(&index_html_path, contents)
        .with_context(|| format!("writing patched {}", index_html_path.display()))?;

    Ok((PluginFrontendPatchOutcome::Applied, results))
}

fn resolve_and_stage_one(
    project_root: &Path,
    plugin_name: &str,
    library_name: &str,
    staged_libraries: &[library_stage::StagedLibrary],
    script_tags: &mut Vec<String>,
) -> Result<GenericLibraryResolution> {
    // 1. The target plugin's own declared `libraries` map, staged
    //    alongside its plugin.js by plugin_stage.rs.
    let plugin_manifest_path = project_root
        .join(PLUGINS_DIR_REL)
        .join(plugin_name)
        .join("cdrca.json");
    if plugin_manifest_path.is_file() {
        let raw = std::fs::read_to_string(&plugin_manifest_path)
            .with_context(|| format!("reading {}", plugin_manifest_path.display()))?;
        if let Ok(manifest) = serde_json::from_str::<Manifest>(&raw) {
            if let Some(rel_path) = manifest.libraries.get(library_name) {
                let src = project_root
                    .join(PLUGINS_DIR_REL)
                    .join(plugin_name)
                    .join(rel_path);
                if src.is_file() {
                    let filename = Path::new(rel_path)
                        .file_name()
                        .map(|f| f.to_string_lossy().to_string())
                        .unwrap_or_else(|| format!("{library_name}.js"));
                    let dst_dir = project_root.join(FRONTEND_PLUGINS_DIR_REL).join(plugin_name);
                    std::fs::create_dir_all(&dst_dir)
                        .with_context(|| format!("creating {}", dst_dir.display()))?;
                    let dst = dst_dir.join(&filename);
                    std::fs::copy(&src, &dst)
                        .with_context(|| format!("copying {} to {}", src.display(), dst.display()))?;
                    script_tags.push(format!(
                        "    <script src=\"./Transpiler-Plugins/{plugin_name}/{filename}\"></script>"
                    ));
                    return Ok(GenericLibraryResolution::FromPluginOwnLibraries);
                }
            }
        }
    }

    // 2. Fall back to an installed `type: "library"` package whose
    //    `providesFor` matches — already staged under
    //    Front-end/Transpiler-Plugins/_libraries/, so no copy needed,
    //    just reference it directly.
    if let Some(staged) = staged_libraries
        .iter()
        .find(|s| s.plugin == plugin_name && s.library == library_name)
    {
        script_tags.push(format!(
            "    <script src=\"./{}/{}\"></script>",
            library_stage::BROWSER_REL_PATH_PREFIX,
            staged.rel_path
        ));
        return Ok(GenericLibraryResolution::FromInstalledLibraryPackage);
    }

    Ok(GenericLibraryResolution::Unresolved)
}

fn replace_or_insert_block(contents: &str, plugin_name: &str, script_tags: &[String]) -> String {
    let (start_marker, end_marker) = plugin_block_markers(plugin_name);
    let mut block_lines = vec![start_marker.clone()];
    block_lines.extend(script_tags.iter().cloned());
    block_lines.push(end_marker.clone());
    let block = block_lines.join("\n");

    if let Some(start) = contents.find(&start_marker) {
        if let Some(rel_end) = contents[start..].find(&end_marker) {
            let end = start + rel_end + end_marker.len();
            return format!("{}{}{}", &contents[..start], block, &contents[end..]);
        }
    }
    match contents.find(BODY_CLOSE_TAG) {
        Some(idx) => format!("{}{}\n{}", &contents[..idx], block, &contents[idx..]),
        // No </body> tag at all — same "CDRCA's structure may have
        // changed upstream" situation quark_patch.rs already handles as
        // NoInsertionPoint; here, just leave contents untouched for this
        // plugin's block rather than corrupting the file.
        None => contents.to_string(),
    }
}

/// Removes any existing `PLUGIN:<name>:START/END` block whose `<name>`
/// isn't a key in this run's `by_plugin` map — i.e. a plugin that used to
/// have `@useLib` references but no longer does.
fn strip_stale_blocks(contents: &str, by_plugin: &BTreeMap<String, Vec<LibRef>>) -> String {
    let mut result = contents.to_string();
    let mut search_from = 0;
    loop {
        let Some(rel_start) = result[search_from..].find("<!-- PLUGIN:") else {
            break;
        };
        let start = search_from + rel_start;
        let Some(rel_name_end) = result[start..].find(":START") else {
            search_from = start + 1;
            continue;
        };
        let name = result[start + "<!-- PLUGIN:".len()..start + rel_name_end].to_string();
        if by_plugin.contains_key(&name) {
            // Still referenced — leave it (already rewritten above) and
            // keep scanning after it.
            search_from = start + rel_name_end;
            continue;
        }
        let (_, end_marker) = plugin_block_markers(&name);
        let Some(rel_end) = result[start..].find(&end_marker) else {
            search_from = start + 1;
            continue;
        };
        let end = start + rel_end + end_marker.len();
        result = format!("{}{}", &result[..start], &result[end..]);
        search_from = start;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{PackageType, ProvidesFor};
    use std::collections::HashMap;

    fn fake_frontend(dir: &Path, initial_html: &str) {
        let frontend_dir = dir.join("node_modules/cdrca/Front-end");
        std::fs::create_dir_all(&frontend_dir).unwrap();
        std::fs::write(frontend_dir.join("index.html"), initial_html).unwrap();
    }

    fn stage_fake_plugin_with_library(dir: &Path, plugin_name: &str, library_name: &str, rel_path: &str, contents: &str) {
        let plugin_dir = dir.join(PLUGINS_DIR_REL).join(plugin_name);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("plugin.js"), "module.exports = function(){};").unwrap();
        std::fs::create_dir_all(plugin_dir.join(rel_path).parent().unwrap()).ok();
        std::fs::write(plugin_dir.join(rel_path), contents).unwrap();
        let mut libraries = HashMap::new();
        libraries.insert(library_name.to_string(), rel_path.to_string());
        let manifest = Manifest {
            name: plugin_name.to_string(),
            version: "1.0.0".to_string(),
            description: "d".to_string(),
            package_type: PackageType::Plugin,
            entry: "plugin.js".to_string(),
            icon: "icon.png".to_string(),
            author: "a".to_string(),
            license: "IOSL".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: Vec::new(),
            libraries,
            provides_for: None,
        };
        std::fs::write(plugin_dir.join("cdrca.json"), serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
    }

    #[test]
    fn resolves_via_the_plugins_own_declared_libraries() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");
        stage_fake_plugin_with_library(dir.path(), "mathcore", "icons", "dist-icons.js", "/* icons */");

        let mut by_plugin = BTreeMap::new();
        by_plugin.insert(
            "mathcore".to_string(),
            vec![LibRef { plugin_name: "mathcore".to_string(), library_name: "icons".to_string() }],
        );

        let (outcome, results) = patch_generic_plugin_frontends(dir.path(), &by_plugin).unwrap();
        assert_eq!(outcome, PluginFrontendPatchOutcome::Applied);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].resolutions[0].1, GenericLibraryResolution::FromPluginOwnLibraries);

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("Transpiler-Plugins/mathcore/dist-icons.js"));
        let copied = dir.path().join(FRONTEND_PLUGINS_DIR_REL).join("mathcore/dist-icons.js");
        assert!(copied.is_file());
    }

    #[test]
    fn resolves_via_an_installed_library_package() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");

        // Stage a type:"library" package targeting "mathcore.charts",
        // with no matching declared library on mathcore's own manifest.
        let lib_dir = library_stage::staged_library_dir(dir.path()).join("mathcore-charts");
        std::fs::create_dir_all(&lib_dir).unwrap();
        std::fs::write(lib_dir.join("bundle.js"), "/* charts */").unwrap();
        let libraries_json_dir = dir.path().join(PLUGINS_DIR_REL);
        std::fs::create_dir_all(&libraries_json_dir).unwrap();
        std::fs::write(
            libraries_json_dir.join("libraries.json"),
            serde_json::to_string_pretty(&serde_json::json!([{
                "name": "mathcore-charts",
                "providesFor": { "plugin": "mathcore", "library": "charts" },
                "path": "mathcore-charts/bundle.js"
            }])).unwrap(),
        )
        .unwrap();

        let mut by_plugin = BTreeMap::new();
        by_plugin.insert(
            "mathcore".to_string(),
            vec![LibRef { plugin_name: "mathcore".to_string(), library_name: "charts".to_string() }],
        );

        let (_, results) = patch_generic_plugin_frontends(dir.path(), &by_plugin).unwrap();
        assert_eq!(results[0].resolutions[0].1, GenericLibraryResolution::FromInstalledLibraryPackage);

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("Transpiler-Plugins/_libraries/mathcore-charts/bundle.js"));
    }

    #[test]
    fn unresolvable_reference_is_reported_not_silently_dropped() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");

        let mut by_plugin = BTreeMap::new();
        by_plugin.insert(
            "nonexistent-plugin".to_string(),
            vec![LibRef { plugin_name: "nonexistent-plugin".to_string(), library_name: "whatever".to_string() }],
        );

        let (_, results) = patch_generic_plugin_frontends(dir.path(), &by_plugin).unwrap();
        assert_eq!(results[0].resolutions[0].1, GenericLibraryResolution::Unresolved);
    }

    #[test]
    fn removing_a_useLib_line_removes_its_stale_block() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");
        stage_fake_plugin_with_library(dir.path(), "mathcore", "icons", "dist-icons.js", "/* icons */");

        let mut by_plugin = BTreeMap::new();
        by_plugin.insert(
            "mathcore".to_string(),
            vec![LibRef { plugin_name: "mathcore".to_string(), library_name: "icons".to_string() }],
        );
        patch_generic_plugin_frontends(dir.path(), &by_plugin).unwrap();

        // Second run: the @useLib line was removed from source entirely.
        let empty_by_plugin = BTreeMap::new();
        patch_generic_plugin_frontends(dir.path(), &empty_by_plugin).unwrap();

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(!html.contains("mathcore"), "stale plugin block must be removed once no longer referenced");
    }

    #[test]
    fn missing_index_html_is_reported_not_panicked() {
        let dir = tempfile::tempdir().unwrap();
        let by_plugin = BTreeMap::new();
        let (outcome, results) = patch_generic_plugin_frontends(dir.path(), &by_plugin).unwrap();
        assert_eq!(outcome, PluginFrontendPatchOutcome::IndexHtmlNotFound);
        assert!(results.is_empty());
    }

    #[test]
    fn full_scan_end_to_end_from_real_cdrca_source_covers_both_quark_and_generic() {
        let dir = tempfile::tempdir().unwrap();
        fake_frontend(dir.path(), "<html><body></body></html>");
        stage_fake_plugin_with_library(dir.path(), "mathcore", "icons", "dist-icons.js", "/* icons */");
        std::fs::write(
            dir.path().join("main.cdrca"),
            "@useLib quark.components\n@useLib mathcore.icons\n@mainNav navbar.glass\n",
        )
        .unwrap();

        let (quark_outcome, generic_outcome, results) =
            scan_and_patch_plugin_frontends(dir.path()).unwrap();
        assert_eq!(quark_outcome, crate::quark_patch::QuarkFrontendPatchOutcome::Applied);
        assert_eq!(generic_outcome, PluginFrontendPatchOutcome::Applied);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].plugin_name, "mathcore");

        let html = std::fs::read_to_string(dir.path().join(FRONTEND_INDEX_HTML_REL)).unwrap();
        assert!(html.contains("quark-components.js"), "quark's own path must still work unchanged");
        assert!(html.contains("Transpiler-Plugins/mathcore/dist-icons.js"), "generic path must also work");
    }
}
