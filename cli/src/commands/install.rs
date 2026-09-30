use anyhow::{bail, Context, Result};
use std::io::{self, Write};
use std::path::Path;

use crate::fulltranspiler_patch;
use crate::js_block_semicolon_patch;
use crate::library_stage;
use crate::lockfile::{Lockfile, LockedPackage};
use crate::manifest::PackageType;
use crate::package_stage;
use crate::parser_spacing_patch;
use crate::patch;
use crate::cdrca_bundle;
use crate::plugin_frontend_patch;
use crate::plugin_stage;
use crate::project_state::ProjectState;
use crate::quark_patch;
use crate::registry::RegistryClient;
use crate::store::Store;

/// `cdrca install <package>[@version]`, or `cdrca install <path>.mrmib` /
/// `<path>.tar.gz` to side-load a local archive instead of going through
/// the registry — the counterpart to `cdrca export`/`cdrca pack`: what one
/// project exports, another can install directly, no publish step needed.
pub async fn run(spec: &str, project_root: &Path) -> Result<()> {
    if spec.ends_with(".mrmib") || spec.ends_with(".tar.gz") {
        return install_local_archive(spec, project_root).await;
    }

    let (name, version_req) = match spec.split_once('@') {
        Some((n, v)) => (n, Some(v)),
        None => (spec, None),
    };

    // The CDRCA language runtime itself is a real npm package, not part of
    // the ecosystem registry — reinstalling/updating it goes through npm
    // directly and re-applies the port patch, rather than the registry flow
    // below (which is for ecosystem packages/plugins/apps only).
    if name == "cdrca" {
        return reinstall_cdrca_runtime(project_root, version_req).await;
    }

    let client = RegistryClient::new(crate::auth::load_token()?);
    let store = Store::open()?;

    let pkg_info = client
        .package_info(name)
        .await
        .with_context(|| format!("looking up package '{name}'"))?;
    let version = version_req.unwrap_or(&pkg_info.latest_version).to_string();

    let version_info = client.version_info(name, &version).await?;

    // Security-relevant plugin confirmation prompt, before any download happens.
    if version_info.manifest.package_type == PackageType::Plugin {
        confirm_plugin_install(name, &version, &version_info.manifest)?;
    }

    if store.is_installed(name, &version) {
        println!("{name}@{version} is already installed.");
    } else {
        println!("Downloading {name}@{version} ...");
        let tmp_dir = tempfile::tempdir()?;
        let tarball_path = tmp_dir.path().join(format!("{name}-{version}.tar.gz"));
        client
            .download_asset(&version_info.github_release_asset_url, &tarball_path)
            .await
            .context("downloading release asset from GitHub")?;

        if let Some(integrity) = &version_info.integrity {
            Store::verify_checksum(&tarball_path, integrity)
                .context("integrity check failed — refusing to install")?;
        } else {
            eprintln!("warning: registry did not provide an integrity hash for {name}@{version}; skipping checksum verification");
        }

        store
            .install_from_tarball(name, &version, &tarball_path)
            .context("installing package into local store")?;
        println!("Installed {name}@{version}");
    }

    // Verified bug fix (see docs/REACTIVE-STATE.md, bug #4): a plugin
    // package used to be downloaded/verified/locked and then never
    // actually wired up — no Plugins/<name>/plugin.js, no plugins.json
    // entry, indistinguishable from "not installed" to the transpiler.
    // `package_dir` is resolved either way (freshly installed, or already
    // present from a previous run) so staging always has a real path to
    // copy the entry file from.
    //
    // The same underlying gap applied to `type: "package"` and
    // `type: "library"` too (plan-doc section 1.1's closing note) — each
    // gets its own staging step, since each needs to land somewhere
    // different (package_stage.rs / library_stage.rs).
    let package_dir = store.package_dir(name, &version);
    match version_info.manifest.package_type {
        PackageType::Plugin => {
            let stage_outcome = plugin_stage::stage_plugin(project_root, &package_dir, &version_info.manifest)?;
            plugin_stage::report_outcome(name, &stage_outcome);
        }
        PackageType::Package => {
            let stage_outcome = package_stage::stage_package(project_root, &package_dir, &version_info.manifest)?;
            package_stage::report_outcome(name, &stage_outcome);
        }
        PackageType::Library => {
            let stage_outcome = library_stage::stage_library(project_root, &package_dir, &version_info.manifest)?;
            library_stage::report_outcome(name, &stage_outcome);
        }
        PackageType::App => {
            // Apps aren't a dependency another project installs — nothing
            // to stage.
        }
    }

    // Re-scan every time, not just for plugin installs: installing a
    // type:"library" package can resolve an @useLib reference that was
    // previously unresolved, and installing a plugin can bring in
    // libraries: {} entries a starter file already references.
    let (quark_frontend_outcome, generic_frontend_outcome, generic_frontend_results) =
        plugin_frontend_patch::scan_and_patch_plugin_frontends(project_root)?;
    quark_patch::report_quark_frontend_outcome(&quark_frontend_outcome);
    crate::commands::create::report_generic_frontend_results(&generic_frontend_outcome, &generic_frontend_results);

    // Update the project's lockfile.
    let mut lock = Lockfile::load_or_default(project_root)?;
    lock.upsert(
        name,
        LockedPackage {
            version: version.clone(),
            resolved: version_info.github_release_asset_url.clone(),
            integrity: version_info.integrity.clone().unwrap_or_default(),
            dependencies: version_info.manifest.dependencies.clone(),
        },
    );
    lock.save(project_root)?;

    Ok(())
}

/// Installs directly from a local `.mrmib` archive (or a plain
/// registry-shaped `.tar.gz`, in case someone kept one around from before
/// `.mrmib` existed) instead of resolving through the registry. Reuses
/// every staging/lockfile step `run()` already does for a registry
/// install by extracting into the exact same content-addressed store
/// location a registry download would have used, so nothing downstream
/// needs to know the difference.
async fn install_local_archive(path_str: &str, project_root: &Path) -> Result<()> {
    let archive_path = Path::new(path_str);
    if !archive_path.is_file() {
        bail!("'{path_str}' does not exist");
    }

    let manifest = if path_str.ends_with(".mrmib") {
        crate::mrmib::verify_payload_hash(archive_path)
            .context("archive failed integrity verification — refusing to install")?;
        crate::mrmib::read_meta(archive_path)?.manifest
    } else {
        // Plain .tar.gz: no self-contained meta entry to read a manifest
        // from ahead of extraction, so peek by extracting to a throwaway
        // temp dir first, matching how a fresh registry tarball is
        // discovered by store.rs today (checksum verified by the caller
        // before this point in that path; a local .tar.gz has no registry
        // checksum to check against, so it's trusted at face value, same
        // as any other local file the user chose to run this on).
        let peek_dir = tempfile::tempdir()?;
        let file = std::fs::File::open(archive_path)?;
        let decompressed = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decompressed);
        archive.unpack(peek_dir.path())?;
        crate::manifest::Manifest::load(&peek_dir.path().join("cdrca.json"))?
    };
    manifest.validate()?;

    if manifest.package_type == PackageType::Plugin {
        confirm_plugin_install(&manifest.name, &manifest.version, &manifest)?;
    }

    let store = Store::open()?;
    let package_dir = if store.is_installed(&manifest.name, &manifest.version) {
        println!("{}@{} is already installed.", manifest.name, manifest.version);
        store.package_dir(&manifest.name, &manifest.version)
    } else if path_str.ends_with(".mrmib") {
        // install_from_tarball expects a plain .tar.gz on disk (it decides
        // format by content, not extension — flate2/tar don't care what
        // the file is named), but its atomic extract-to-temp-then-rename
        // still wraps the raw payload we need, not the .mrmib-meta.json
        // wrapper — so decompress into a throwaway .tar.gz first, then let
        // the store handle the atomic install exactly like any other one.
        let payload_tmp = tempfile::tempdir()?;
        let extracted = payload_tmp.path().join("payload");
        crate::mrmib::extract_payload(archive_path, &extracted)?;
        let repacked = payload_tmp.path().join("repacked.tar.gz");
        repack_dir_as_tar_gz(&extracted, &repacked)?;
        store
            .install_from_tarball(&manifest.name, &manifest.version, &repacked)
            .context("installing package into local store")?
    } else {
        store
            .install_from_tarball(&manifest.name, &manifest.version, archive_path)
            .context("installing package into local store")?
    };
    println!("Installed {}@{} (from {path_str})", manifest.name, manifest.version);

    match manifest.package_type {
        PackageType::Plugin => {
            let outcome = plugin_stage::stage_plugin(project_root, &package_dir, &manifest)?;
            plugin_stage::report_outcome(&manifest.name, &outcome);
        }
        PackageType::Package => {
            let outcome = package_stage::stage_package(project_root, &package_dir, &manifest)?;
            package_stage::report_outcome(&manifest.name, &outcome);
        }
        PackageType::Library => {
            let outcome = library_stage::stage_library(project_root, &package_dir, &manifest)?;
            library_stage::report_outcome(&manifest.name, &outcome);
        }
        PackageType::App => {}
    }

    let (quark_frontend_outcome, generic_frontend_outcome, generic_frontend_results) =
        plugin_frontend_patch::scan_and_patch_plugin_frontends(project_root)?;
    quark_patch::report_quark_frontend_outcome(&quark_frontend_outcome);
    crate::commands::create::report_generic_frontend_results(&generic_frontend_outcome, &generic_frontend_results);

    // Locally-installed archives have no registry resolved-URL to record —
    // the lockfile's `resolved` field carries the local path instead, so
    // `cdrca-lock.json` still shows honestly where this came from rather
    // than a fabricated URL.
    let mut lock = Lockfile::load_or_default(project_root)?;
    lock.upsert(
        &manifest.name,
        LockedPackage {
            version: manifest.version.clone(),
            resolved: format!("local:{path_str}"),
            integrity: String::new(),
            dependencies: manifest.dependencies.clone(),
        },
    );
    lock.save(project_root)?;

    Ok(())
}

/// Re-packs an already-extracted directory as a plain `.tar.gz` so
/// `Store::install_from_tarball` (which only knows how to extract a plain
/// tar.gz, not a `.mrmib`'s meta-entry-first layout) can be reused
/// unchanged rather than duplicating its atomic extract-to-temp-then-
/// rename logic here.
fn repack_dir_as_tar_gz(src_dir: &Path, dest_path: &Path) -> Result<()> {
    let file = std::fs::File::create(dest_path)?;
    let gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut builder = tar::Builder::new(gz);
    builder.append_dir_all(".", src_dir)?;
    builder.into_inner()?.finish()?;
    Ok(())
}

async fn reinstall_cdrca_runtime(project_root: &Path, version_req: Option<&str>) -> Result<()> {
    let spec = match version_req {
        Some(v) => format!("cdrca@{v}"),
        None => "cdrca".to_string(),
    };
    println!("Installing/updating CDRCA language runtime (npm install {spec})...");
    let status = crate::npm::install_or_update(project_root, &spec)?;
    if !status.success() {
        bail!("npm install {spec} failed with status {status}");
    }

    ensure_working_runtime(project_root)?;

    // Re-apply the port patch — idempotent, so this is safe whether or not
    // it was already applied. A version bump could plausibly change the
    // exact source line, so this is not skipped just because a previous
    // create/install already patched it once.
    let outcome = patch::patch_port(project_root)?;
    patch::report_outcome(&outcome);

    // Re-stage Quark too — same reasoning as the port patch: a version
    // bump could be exactly what brings in the plugin-hook system Quark
    // depends on (see quark_patch.rs), so this always re-checks rather
    // than trusting a previously-recorded state.
    let quark_outcome = quark_patch::patch_quark(project_root)?;
    quark_patch::report_quark_outcome(&quark_outcome);

    // Re-scan for @useLib directives on every install too — this is the
    // command a user re-runs after adding a new @useLib line to pick up
    // a library they didn't need before. Generalized beyond Quark now
    // (plan-doc section 1.3) — see plugin_frontend_patch.rs.
    let (quark_frontend_outcome, generic_frontend_outcome, generic_frontend_results) =
        plugin_frontend_patch::scan_and_patch_plugin_frontends(project_root)?;
    quark_patch::report_quark_frontend_outcome(&quark_frontend_outcome);
    crate::commands::create::report_generic_frontend_results(&generic_frontend_outcome, &generic_frontend_results);

    // Same four "make plugins work" patches applied in create.rs — a
    // fresh `npm install cdrca` here could just as easily bring in an
    // unpatched copy, so these are always re-checked, not skipped just
    // because a previous create/install already applied them once.
    let fulltranspiler_outcome = fulltranspiler_patch::patch_js_block_output(project_root)?;
    fulltranspiler_patch::report_outcome(&fulltranspiler_outcome);
    let parser_spacing_outcome = parser_spacing_patch::patch_js_block_spacing(project_root)?;
    parser_spacing_patch::report_outcome(&parser_spacing_outcome);
    let js_block_semicolon_outcome = js_block_semicolon_patch::patch_js_block_semicolon(project_root)?;
    js_block_semicolon_patch::report_outcome(&js_block_semicolon_outcome);

    let mut state = ProjectState::load_or_default(project_root)?;
    state.ensure_port()?;
    state.port_patch_applied = outcome.is_ok();
    state.quark_patch_applied = quark_outcome.is_ok();
    state.plugin_pipeline_patch_applied = fulltranspiler_outcome.is_ok()
        && parser_spacing_outcome.is_ok()
        && js_block_semicolon_outcome.is_ok();
    state.save(project_root)?;

    println!("CDRCA runtime updated.");
    Ok(())
}

/// After `npm install cdrca` completes, checks whether the installed copy
/// actually has the plugin-hook system Quark (and any future plugin)
/// depends on. As of this CLI version, the published npm package does
/// NOT — confirmed directly by running a real transpile against it, not
/// assumed — so this falls back to writing this CLI's own bundled, fixed
/// copy of CDRCA over the npm-installed one, then runs a plain
/// `npm install` inside it to pull in that bundled copy's own
/// express/prettier/vm dependencies (the npm-installed copy already has
/// these from the first `npm install cdrca` above in most cases, but this
/// is run regardless since the bundled package.json is the source of
/// truth for what this exact copy needs).
///
/// This is the same category of decision as `patch.rs`'s port patch and
/// `quark_patch.rs`'s Quark patch — a local, per-project fix for a gap in
/// the published package — just larger in scope, since the gap here is a
/// whole missing subsystem rather than one line.
pub fn ensure_working_runtime(project_root: &Path) -> Result<()> {
    if cdrca_bundle::installed_copy_has_plugin_system(project_root) {
        return Ok(());
    }

    eprintln!();
    eprintln!("*** The published npm 'cdrca' package is missing the plugin-hook system ***");
    eprintln!(
        "(Back-end/Transpiler/plugin.js) that Quark and other built-in plugins depend on. \
         Falling back to this CLI's own bundled, fixed copy of CDRCA instead — see \
         cli/src/cdrca_bundle.rs for exactly what's fixed and why."
    );
    eprintln!();

    cdrca_bundle::write_bundled_runtime(project_root)
        .context("writing bundled CDRCA runtime")?;

    let cdrca_dir = project_root.join("node_modules/cdrca");
    let status = crate::npm::install_dependencies(&cdrca_dir)
        .context("installing bundled runtime's dependencies")?;
    if !status.success() {
        bail!("npm install (bundled CDRCA runtime dependencies) failed with status {status}");
    }

    println!("Installed the bundled CDRCA runtime (with the plugin-hook system Quark needs).");
    Ok(())
}

fn confirm_plugin_install(name: &str, version: &str, manifest: &crate::manifest::Manifest) -> Result<()> {
    println!("\n'{name}@{version}' is a PLUGIN. It requests:\n");
    println!("Permissions:");
    if manifest.permissions.is_empty() {
        println!("  (none declared)");
    }
    for p in &manifest.permissions {
        let flag = if p.is_elevated() { "  [ELEVATED]" } else { "" };
        println!("  - {p:?}{flag}: {}", p.describe());
    }
    println!("\nAllowed transpiler hooks (uses):");
    if manifest.uses.is_empty() {
        println!("  (none declared — plugin will be seized if it tries to register any hook)");
    }
    for (hook_type, hook_process) in &manifest.uses {
        println!("  - {hook_type} :: {hook_process}");
    }
    print!("\nInstall this plugin with the permissions above? [y/N] ");
    io::stdout().flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    if !answer.trim().eq_ignore_ascii_case("y") {
        anyhow::bail!("installation cancelled by user");
    }
    Ok(())
}
