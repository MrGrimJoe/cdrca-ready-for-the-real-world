use anyhow::{bail, Context, Result};
use std::path::Path;

use crate::manifest::Manifest;
use crate::registry::RegistryClient;

pub async fn run(project_root: &Path) -> Result<()> {
    let manifest_path = project_root.join("cdrca.json");
    let manifest = Manifest::load(&manifest_path).context("loading cdrca.json")?;

    // Fail fast locally before round-tripping a bad request to the registry.
    manifest.validate()?;
    if !manifest.entry_exists(project_root) {
        bail!(
            "manifest 'entry' field points to '{}' which does not exist in this project",
            manifest.entry
        );
    }

    let token = crate::auth::load_token()?;
    if token.is_none() {
        bail!("not logged in — run 'cdrca login' first");
    }

    let client = RegistryClient::new(token);
    client
        .publish(&manifest.name, &manifest)
        .await
        .context("publishing to registry")?;

    println!("Published {}@{}", manifest.name, manifest.version);
    Ok(())
}
