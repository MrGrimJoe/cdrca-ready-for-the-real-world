//! The cdrca.json manifest — a fixed contract shared with the registry website.
//! DO NOT add/rename/remove fields here without confirming against the registry API spec.

use anyhow::{bail, Context, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageType {
    Package,
    Plugin,
    App,
}

/// Real permission values from CDRCA's plugin system.
/// `Trusted`/`TrustedSys` grant real/unsandboxed fs + child_process access.
/// Everything else is permission-gated and sandboxed (throws on unauthorized calls).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Trusted,
    TrustedSys,
    Embedded,
    FileRead,
    FileWrite,
    MpdRead,
    MpdWrite,
    SpawnProcess,
}

impl Permission {
    pub fn is_elevated(self) -> bool {
        matches!(self, Permission::Trusted | Permission::TrustedSys)
    }

    pub fn describe(self) -> &'static str {
        match self {
            Permission::Trusted => "Real, unsandboxed fs/child_process access",
            Permission::TrustedSys => "Raw, unsandboxed fs/child_process access (system level)",
            Permission::Embedded => "May embed/spawn additional in-process resources",
            Permission::FileRead => "Sandboxed file read access",
            Permission::FileWrite => "Sandboxed file write access",
            Permission::MpdRead => "Sandboxed MPD (project data) read access",
            Permission::MpdWrite => "Sandboxed MPD (project data) write access",
            Permission::SpawnProcess => "May spawn sandboxed child processes",
        }
    }
}

/// A single (hookType, hookProcess) pair a plugin is allowed to register for.
/// CDRCA's runtime PERMANENTLY seizes (disables) a plugin that registers
/// outside its declared `uses` — this allowlist is security-relevant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookUse {
    pub hook_type: String,
    pub hook_process: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(rename = "type")]
    pub package_type: PackageType,
    pub entry: String,
    pub icon: String,
    pub author: String,
    pub license: String,
    pub repository: String,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub uses: Vec<(String, String)>,
}

impl Manifest {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("reading manifest at {}", path.display()))?;
        let manifest: Manifest = serde_json::from_str(&raw)
            .with_context(|| format!("parsing manifest at {}", path.display()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let raw = serde_json::to_string_pretty(self)?;
        std::fs::write(path, raw)
            .with_context(|| format!("writing manifest to {}", path.display()))?;
        Ok(())
    }

    /// Validates required fields + version format before publish/install.
    /// Fail fast locally rather than round-tripping a bad request to the registry.
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            bail!("manifest field 'name' is empty");
        }
        Version::parse(&self.version)
            .with_context(|| format!("manifest field 'version' ('{}') is not valid semver", self.version))?;
        if self.entry.trim().is_empty() {
            bail!("manifest field 'entry' is empty");
        }
        if self.license != "IOSL" {
            // Not a hard failure — CDRCA-ecosystem packages could theoretically use
            // another license — but flag it since IOSL is the expected default.
            eprintln!(
                "warning: manifest license is '{}', expected 'IOSL' for CDRCA-ecosystem packages",
                self.license
            );
        }
        if self.package_type == PackageType::Plugin && self.uses.is_empty() && !self.permissions.is_empty() {
            eprintln!(
                "warning: plugin '{}' declares permissions but no 'uses' hooks — it will be seized on first hook registration attempt",
                self.name
            );
        }
        Ok(())
    }

    pub fn entry_exists(&self, project_root: &Path) -> bool {
        project_root.join(&self.entry).is_file()
    }

    pub fn package_type_label(&self) -> &'static str {
        match self.package_type {
            PackageType::Package => "package",
            PackageType::Plugin => "plugin",
            PackageType::App => "app",
        }
    }
}
