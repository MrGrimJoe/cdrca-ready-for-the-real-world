use anyhow::{bail, Context, Result};
use std::io::{self, Write};
use std::path::Path;

use crate::lockfile::{Lockfile, LockedPackage};
use crate::manifest::PackageType;
use crate::patch;
use crate::project_state::ProjectState;
use crate::registry::RegistryClient;
use crate::store::Store;

/// `cdrca install <package>[@version]`
pub async fn run(spec: &str, project_root: &Path) -> Result<()> {
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

    // Re-apply the port patch — idempotent, so this is safe whether or not
    // it was already applied. A version bump could plausibly change the
    // exact source line, so this is not skipped just because a previous
    // create/install already patched it once.
    let outcome = patch::patch_port(project_root)?;
    patch::report_outcome(&outcome);

    let mut state = ProjectState::load_or_default(project_root)?;
    state.ensure_port()?;
    state.port_patch_applied = outcome.is_ok();
    state.save(project_root)?;

    println!("CDRCA runtime updated.");
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
