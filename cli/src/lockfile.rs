//! cdrca-lock.json — records exact resolved versions for reproducible installs.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const LOCKFILE_NAME: &str = "cdrca-lock.json";
const LOCKFILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedPackage {
    pub version: String,
    pub resolved: String,
    pub integrity: String, // "sha256-<hex>"
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lockfile {
    #[serde(rename = "lockfileVersion")]
    pub lockfile_version: u32,
    pub packages: HashMap<String, LockedPackage>,
}

impl Default for Lockfile {
    fn default() -> Self {
        Self {
            lockfile_version: LOCKFILE_VERSION,
            packages: HashMap::new(),
        }
    }
}

impl Lockfile {
    pub fn load_or_default(project_root: &Path) -> Result<Self> {
        let path = project_root.join(LOCKFILE_NAME);
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("reading lockfile at {}", path.display()))?;
        let lock: Lockfile = serde_json::from_str(&raw)
            .with_context(|| format!("parsing lockfile at {}", path.display()))?;
        Ok(lock)
    }

    pub fn save(&self, project_root: &Path) -> Result<()> {
        let path = project_root.join(LOCKFILE_NAME);
        let raw = serde_json::to_string_pretty(self)?;
        // write-to-temp-then-rename so a crash mid-write never corrupts the lockfile
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, raw)?;
        std::fs::rename(&tmp, &path)
            .with_context(|| format!("finalizing lockfile at {}", path.display()))?;
        Ok(())
    }

    pub fn upsert(&mut self, name: &str, entry: LockedPackage) {
        self.packages.insert(name.to_string(), entry);
    }

    pub fn remove(&mut self, name: &str) -> Option<LockedPackage> {
        self.packages.remove(name)
    }
}
