use anyhow::{bail, Context, Result};
use std::path::Path;

use crate::manifest::{Manifest, PackageType};
use crate::patch::{self, PatchOutcome};
use crate::project_state::ProjectState;
use crate::quark_patch::{self, QuarkPatchOutcome};

const STARTER_CDRCA: &str = include_str!("../templates/starter.cdrca");
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

    // Bake in the port this project will use for the lifetime of the
    // project (not renegotiated on every `cdrca run`), and record whether
    // the patch actually took — 'cdrca run'/'cdrca build app' both read
    // this back rather than re-deciding it themselves.
    let mut state = ProjectState::default();
    let port = state.ensure_port()?;
    state.port_patch_applied = outcome.is_ok();
    state.quark_patch_applied = quark_outcome.is_ok();
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
        println!("  (see warning above — @sidebar-style Quark directives won't work yet)");
    }
    println!("\nNext: cd {name} && cdrca build app");
    Ok(())
}

fn whoami_fallback() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string())
}
