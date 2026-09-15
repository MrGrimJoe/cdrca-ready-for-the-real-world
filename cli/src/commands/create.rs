use anyhow::{bail, Context, Result};
use std::path::Path;

use crate::fulltranspiler_patch;
use crate::js_block_semicolon_patch;
use crate::manifest::{Manifest, PackageType};
use crate::parser_spacing_patch;
use crate::patch::{self, PatchOutcome};
use crate::plugin_frontend_patch::{self, GenericLibraryResolution, PluginFrontendPatchOutcome, PluginFrontendResult};
use crate::project_state::ProjectState;
use crate::quark_patch::{self, QuarkPatchOutcome};

const STARTER_CDRCA: &str = include_str!("../templates/starter.cdrca");
const STARTER_PLUGIN_JS: &str = include_str!("../templates/starter-plugin.js");
const STARTER_PLUGIN_LIBRARY_JS: &str = include_str!("../templates/starter-plugin-library.js");
const DEFAULT_LOGO: &[u8] = include_bytes!("../templates/assets/cdrca-logo.png");

pub fn run(name: &str) -> Result<()> {
    let root = Path::new(name);
    if root.exists() {
        bail!("directory '{name}' already exists");
    }
    std::fs::create_dir_all(root).context("creating project directory")?;
    std::fs::create_dir_all(root.join("src")).context("creating src directory")?;

    // Bundled default CDRCA logo, used until the user supplies their own PNG.
    let icon_path = root.join("icon.png");
    std::fs::write(&icon_path, DEFAULT_LOGO).context("writing default icon")?;

    let entry_rel = "src/main.cdrca";
    std::fs::write(root.join(entry_rel), STARTER_CDRCA).context("writing starter .cdrca file")?;

    let manifest = Manifest {
        name: name.to_string(),
        version: "0.1.0".to_string(),
        description: format!("A CDRCA app: {name}"),
        package_type: PackageType::App,
        entry: entry_rel.to_string(),
        icon: "icon.png".to_string(),
        author: whoami_fallback(),
        license: "IOSL".to_string(),
        repository: String::new(),
        dependencies: Default::default(),
        permissions: Vec::new(),
        uses: Vec::new(),
        libraries: Default::default(),
        provides_for: None,
    };
    manifest.save(&root.join("cdrca.json")).context("writing cdrca.json")?;

    // .cdrca-state.json holds a locally-bound port — machine/instance
    // specific, shouldn't leak into a repo or a published package tarball.
    std::fs::write(
        root.join(".gitignore"),
        "node_modules/\n.cdrca-state.json\n.cdrca-build/\n",
    )
    .context("writing .gitignore")?;

    // Pull the actual CDRCA language runtime into this project's own
    // node_modules — it's a real npm package with no bin field, so this is
    // the only way to get a runnable copy in place. This is separate from
    // the ecosystem package manager pipeline (registry.rs/store.rs), which
    // never touches npm.
    println!("Installing CDRCA language runtime (npm install cdrca)...");
    let npm_status = crate::npm::install_or_update(root, "cdrca")?;
    if !npm_status.success() {
        bail!("npm install cdrca failed with status {npm_status}");
    }

    // As of this CLI version, the published npm 'cdrca' package is
    // missing the plugin-hook system Quark (and any future built-in
    // plugin) depends on entirely — not just missing Quark itself, the
    // whole subsystem. This falls back to a bundled, fixed copy when
    // that's the case. See cdrca_bundle.rs and
    // crate::commands::install::ensure_working_runtime for the full
    // reasoning and the current-status caveat.
    crate::commands::install::ensure_working_runtime(root)?;

    // Patch this project's own local CDRCA copy so it honors a per-project
    // CDRCA_PORT instead of the hardcoded port 3000 — verified directly
    // against CDRCA's real source, which does not support this natively.
    // Local, per-project patch only — never touches Ayyan's repo or any
    // shared/global install. See patch.rs for why this approach was chosen.
    let outcome = patch::patch_port(root)?;
    patch::report_outcome(&outcome);

    // Installs Quark — the built-in `@id preset.mod.mod = value` UI
    // directive plugin — into this project's own local CDRCA copy.
    // Built-in by design: no cdrca.json dependency entry, no registry
    // involvement, no install-time confirmation prompt. See
    // quark_patch.rs for why, and for the current-npm-package caveat.
    let quark_outcome = quark_patch::patch_quark(root)?;
    quark_patch::report_quark_outcome(&quark_outcome);

    // Loads Quark's runtime (quark-core.js, quark-ui.js, and any
    // @useLib-referenced library bundles) into this project's actual
    // Front-end/index.html — the page the transpiled JS_BLOCK code
    // eval()s into — AND, generically, resolves + loads any OTHER
    // plugin's @useLib-referenced libraries too (plan-doc section 1.3;
    // see plugin_frontend_patch.rs). Scans the freshly-written starter
    // .cdrca file, so a starter that already uses @useLib gets the right
    // scripts from the very first `cdrca create app`.
    let (quark_frontend_outcome, generic_frontend_outcome, generic_frontend_results) =
        plugin_frontend_patch::scan_and_patch_plugin_frontends(root)?;
    quark_patch::report_quark_frontend_outcome(&quark_frontend_outcome);
    report_generic_frontend_results(&generic_frontend_outcome, &generic_frontend_results);

    // Four more bugs verified directly against CDRCA's real source block
    // ANY plugin, including built-in Quark, from working end-to-end —
    // not just Quark-specific gaps. Applied here (not just in
    // install.rs) so a fresh project comes out already patched, before
    // the user ever runs `cdrca install` on anything. See
    // docs/REACTIVE-STATE.md for the full repro + fix of each. (A fifth
    // bug this project's own CDRCA copy in
    // Back-end/Transpiler/plugin.js is verified to already be free of —
    // see that doc's "bug #3" note — so there's no fourth Rust patch
    // module for it.)
    let fulltranspiler_outcome = fulltranspiler_patch::patch_js_block_output(root)?;
    fulltranspiler_patch::report_outcome(&fulltranspiler_outcome);
    let parser_spacing_outcome = parser_spacing_patch::patch_js_block_spacing(root)?;
    parser_spacing_patch::report_outcome(&parser_spacing_outcome);
    let js_block_semicolon_outcome = js_block_semicolon_patch::patch_js_block_semicolon(root)?;
    js_block_semicolon_patch::report_outcome(&js_block_semicolon_outcome);
    let plugin_pipeline_patch_applied = fulltranspiler_outcome.is_ok()
        && parser_spacing_outcome.is_ok()
        && js_block_semicolon_outcome.is_ok();

    // Bake in the port this project will use for the lifetime of the
    // project (not renegotiated on every `cdrca run`), and record whether
    // the patch actually took — 'cdrca run'/'cdrca build app' both read
    // this back rather than re-deciding it themselves.
    let mut state = ProjectState::default();
    let port = state.ensure_port()?;
    state.port_patch_applied = outcome.is_ok();
    state.quark_patch_applied = quark_outcome.is_ok();
    state.plugin_pipeline_patch_applied = plugin_pipeline_patch_applied;
    state.save(root)?;

    println!("Created CDRCA app '{name}' in ./{name}");
    println!("  {name}/cdrca.json");
    println!("  {name}/.gitignore        (excludes node_modules/, .cdrca-state.json, .cdrca-build/)");
    println!("  {name}/icon.png            (default CDRCA logo — replace with your own PNG)");
    println!("  {name}/{entry_rel}");
    println!("  {name}/.cdrca-state.json   (assigned port: {port})");
    if !matches!(outcome, PatchOutcome::AlreadyPatched | PatchOutcome::Applied) {
        println!("  (see warning above — this project will fall back to CDRCA's default port 3000)");
    }
    if !matches!(
        quark_outcome,
        QuarkPatchOutcome::AlreadyPatched | QuarkPatchOutcome::Applied
    ) {
        println!("  (see warning above — Quark directives won't work yet)");
    }
    if !plugin_pipeline_patch_applied {
        println!("  (see warning(s) above — some plugin directives may produce invalid JS)");
    }
    println!("\nNext: cd {name} && cdrca build app");
    Ok(())
}

/// `cdrca create plugin <name> [--library <libraryName>]` — plan-doc
/// section 1.4. A first-timer should never have to hand-write
/// `plugin.js` from the docs alone: even Quark's own reference
/// implementation had a real, verified bug in the register-call shape
/// until it was caught against a live transpile (see
/// docs/REACTIVE-STATE.md's bug #3 note) — this scaffold's starter
/// already has that shape right, so a new plugin author starts from a
/// file that's known to load, not one they have to debug into that state
/// themselves.
///
/// Unlike `run()` (the app scaffold), this does NOT `npm install cdrca`,
/// port-patch, or stage Quark — a plugin package has no runtime of its
/// own to launch; it's tested against a HOST app project (`cdrca create
/// app <name>` elsewhere, then `cdrca install <this-plugin>` — or, before
/// this is ever published, by pointing that host project's
/// `cdrca-lock.json`/local store at this directory manually).
pub fn run_plugin(name: &str, library: Option<&str>) -> Result<()> {
    let root = Path::new(name);
    if root.exists() {
        bail!("directory '{name}' already exists");
    }
    std::fs::create_dir_all(root).context("creating project directory")?;

    let icon_path = root.join("icon.png");
    std::fs::write(&icon_path, DEFAULT_LOGO).context("writing default icon")?;

    std::fs::write(root.join("plugin.js"), STARTER_PLUGIN_JS)
        .context("writing starter plugin.js")?;

    let mut libraries = std::collections::HashMap::new();
    if let Some(library_name) = library {
        // "Optionally a stub library JS file + matching libraries entry
        // if they say up front they want to ship one" — plan-doc 1.4.
        // The `{{PLUGIN_NAME_GLOBAL}}` placeholder is a best-effort
        // UpperCamelCase guess at the plugin's own runtime namespace —
        // deliberately left as an obvious TODO rather than guessed
        // silently, since there's no way to know the real one from the
        // plugin's name alone.
        let global_name = to_upper_camel_case(name);
        let lib_filename = format!("{name}-{library_name}.js");
        let lib_contents = STARTER_PLUGIN_LIBRARY_JS
            .replace("{{PLUGIN_NAME}}", name)
            .replace("{{LIBRARY_NAME}}", library_name)
            .replace("{{PLUGIN_NAME_GLOBAL}}", &global_name);
        std::fs::write(root.join(&lib_filename), lib_contents)
            .with_context(|| format!("writing starter library {lib_filename}"))?;
        libraries.insert(library_name.to_string(), lib_filename);
    }

    let manifest = Manifest {
        name: name.to_string(),
        version: "0.1.0".to_string(),
        description: format!("A CDRCA plugin: {name}"),
        package_type: PackageType::Plugin,
        entry: "plugin.js".to_string(),
        icon: "icon.png".to_string(),
        author: whoami_fallback(),
        license: "IOSL".to_string(),
        repository: String::new(),
        dependencies: Default::default(),
        // Empty on purpose — the scaffolded plugin.js's stub customRule
        // never actually does anything unsafe yet, and permissions should
        // be added deliberately as real functionality needs them, not
        // pre-granted speculatively. See docs/PLUGIN-PERMISSIONS.md.
        permissions: Vec::new(),
        // Matches the one hook the starter plugin.js registers for —
        // keep this in sync if you add or remove pluginAPI.register(...)
        // calls, or CDRCA's runtime will seize your plugin on its first
        // registration attempt outside this list (see
        // docs/PLUGIN-PERMISSIONS.md).
        uses: vec![("syntax".to_string(), "customRule".to_string())],
        libraries,
        provides_for: None,
    };
    manifest.save(&root.join("cdrca.json")).context("writing cdrca.json")?;

    std::fs::write(root.join(".gitignore"), "node_modules/\n").context("writing .gitignore")?;

    println!("Created CDRCA plugin '{name}' in ./{name}");
    println!("  {name}/cdrca.json          (type: \"plugin\", uses: [[\"syntax\",\"customRule\"]])");
    println!("  {name}/icon.png            (default CDRCA logo — replace with your own PNG)");
    println!("  {name}/plugin.js           (edit myCustomRule — see its comments for the real, verified hook list)");
    if let Some(library_name) = library {
        println!("  {name}/{name}-{library_name}.js   (stub library bundle — edit {{{{PLUGIN_NAME_GLOBAL}}}} placeholder inside)");
    }
    println!("\nTest it against a real app before publishing: create one with 'cdrca create app <name>' elsewhere — see docs/CONTRIBUTING.md's 'Testing a plugin or library locally before publishing' section for how to load this into it before it's published. 'cdrca publish' once you're ready for others to install it.");
    Ok(())
}

fn to_upper_camel_case(name: &str) -> String {
    name.split(|c: char| c == '-' || c == '_')
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// Reports any generic (non-Quark) plugin `@useLib` reference that
/// couldn't be resolved — loud, since there's no earlier parse-time check
/// for a third-party plugin's library names the way Quark has its own
/// `QUARK_LIBRARIES` match. A brand-new `cdrca create app` normally has
/// zero non-Quark plugins installed yet, so this is a no-op in the
/// common case — it only fires for a starter template that already
/// references a plugin.
pub fn report_generic_frontend_results(
    outcome: &PluginFrontendPatchOutcome,
    results: &[PluginFrontendResult],
) {
    if *outcome == PluginFrontendPatchOutcome::IndexHtmlNotFound {
        // Same underlying cause as the Quark IndexHtmlNotFound case
        // (already reported above, in report_quark_frontend_outcome) —
        // don't double-warn about the same missing file.
        return;
    }
    for result in results {
        for (lib, resolution) in &result.resolutions {
            if *resolution == GenericLibraryResolution::Unresolved {
                eprintln!();
                eprintln!(
                    "*** WARNING: @useLib {}.{} could NOT be resolved ***",
                    lib.plugin_name, lib.library_name
                );
                eprintln!(
                    "Neither plugin \"{}\"'s own declared libraries, nor any installed \
                     type:\"library\" package's providesFor, has a \"{}\" entry. This directive \
                     will fail at transpile time.",
                    lib.plugin_name, lib.library_name
                );
                eprintln!();
            }
        }
    }
}

fn whoami_fallback() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod plugin_scaffold_tests {
    use super::*;
    use crate::manifest::Manifest;

    #[test]
    fn upper_camel_case_handles_hyphens_and_underscores() {
        assert_eq!(to_upper_camel_case("my-test-plugin"), "MyTestPlugin");
        assert_eq!(to_upper_camel_case("my_test_plugin"), "MyTestPlugin");
        assert_eq!(to_upper_camel_case("mathcore"), "Mathcore");
    }

    #[test]
    fn scaffolds_a_valid_plugin_without_a_library() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_path = dir.path().join("my-plugin");
        run_plugin(plugin_path.to_str().unwrap(), None).unwrap();

        assert!(plugin_path.join("plugin.js").is_file());
        assert!(!plugin_path.join("my-plugin-icons.js").is_file());

        let manifest = Manifest::load(&plugin_path.join("cdrca.json")).unwrap();
        assert!(manifest.validate().is_ok());
        assert!(manifest.entry_exists(&plugin_path));
        assert_eq!(manifest.uses, vec![("syntax".to_string(), "customRule".to_string())]);
    }

    #[test]
    fn scaffolds_a_valid_plugin_with_a_library() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_path = dir.path().join("my-plugin");
        run_plugin(plugin_path.to_str().unwrap(), Some("icons")).unwrap();

        let manifest = Manifest::load(&plugin_path.join("cdrca.json")).unwrap();
        assert!(manifest.validate().is_ok());
        let lib_rel_path = manifest.libraries.get("icons").expect("icons library declared");
        assert!(plugin_path.join(lib_rel_path).is_file());
        // The scaffolded library file itself must be valid JS syntax —
        // checked by the real repo-wide `node --check` sweep in CI/manual
        // testing, not re-parsed here (no JS engine embedded in this
        // Rust test), but this at least confirms every placeholder got
        // substituted, not left dangling.
        let contents = std::fs::read_to_string(plugin_path.join(lib_rel_path)).unwrap();
        assert!(!contents.contains("{{"), "unsubstituted template placeholder left in scaffolded file");
    }

    #[test]
    fn refuses_to_overwrite_an_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let plugin_path = dir.path().join("my-plugin");
        std::fs::create_dir_all(&plugin_path).unwrap();
        assert!(run_plugin(plugin_path.to_str().unwrap(), None).is_err());
    }
}
