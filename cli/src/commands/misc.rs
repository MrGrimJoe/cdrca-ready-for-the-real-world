use anyhow::{Context, Result};
use std::path::Path;

use crate::lockfile::Lockfile;
use crate::registry::RegistryClient;
use crate::store::Store;

pub async fn search(query: &str) -> Result<()> {
    let client = RegistryClient::new(crate::auth::load_token()?);
    let results = client.search(query).await?;
    if results.is_empty() {
        println!("No packages found for '{query}'.");
        return Ok(());
    }
    for r in results {
        println!("{:<24} {:<8} {:<10} {}", r.name, r.latest_version, r.package_type, r.description);
    }
    Ok(())
}

pub async fn info(name: &str) -> Result<()> {
    let client = RegistryClient::new(crate::auth::load_token()?);
    let info = client.package_info(name).await?;
    println!("{}  ({})", info.manifest.name, info.manifest.package_type_label());
    println!("Latest version: {}", info.latest_version);
    println!("Description:    {}", info.manifest.description);
    println!("Author:         {}", info.manifest.author);
    println!("License:        {}", info.manifest.license);
    println!("Repository:     {}", info.manifest.repository);

    if info.manifest.package_type_label() == "plugin" {
        println!("\n*** PLUGIN — permissions/uses ***");
        println!("Permissions:");
        for p in &info.manifest.permissions {
            println!("  - {p:?}: {}", p.describe());
        }
        println!("Uses (allowed hooks):");
        for (t, p) in &info.manifest.uses {
            println!("  - {t} :: {p}");
        }
    }

    println!("\nAvailable versions: {}", info.versions.join(", "));
    Ok(())
}

pub fn list() -> Result<()> {
    let store = Store::open()?;
    let installed = store.list_installed()?;
    if installed.is_empty() {
        println!("No packages installed.");
        return Ok(());
    }
    for (name, version) in installed {
        println!("{name}@{version}");
    }
    Ok(())
}

pub async fn outdated(project_root: &Path) -> Result<()> {
    let lock = Lockfile::load_or_default(project_root)?;
    let client = RegistryClient::new(crate::auth::load_token()?);
    let mut any = false;
    for (name, locked) in &lock.packages {
        let info = client.package_info(name).await?;
        if info.latest_version != locked.version {
            any = true;
            println!("{name}: {} -> {}", locked.version, info.latest_version);
        }
    }
    if !any {
        println!("Everything is up to date.");
    }
    Ok(())
}

pub async fn update(project_root: &Path, name: Option<&str>) -> Result<()> {
    let lock = Lockfile::load_or_default(project_root)?;
    let names: Vec<String> = match name {
        Some(n) => vec![n.to_string()],
        None => lock.packages.keys().cloned().collect(),
    };
    for name in names {
        println!("Updating {name}...");
        super::install::run(&name, project_root).await?;
    }
    Ok(())
}

pub fn remove(project_root: &Path, name: &str) -> Result<()> {
    let mut lock = Lockfile::load_or_default(project_root)?;
    match lock.remove(name) {
        Some(locked) => {
            let store = Store::open()?;
            store.remove_package(name, &locked.version)
                .context("removing package from local store")?;
            lock.save(project_root)?;
            println!("Removed {name}@{}", locked.version);
        }
        None => println!("{name} is not installed in this project."),
    }
    Ok(())
}
