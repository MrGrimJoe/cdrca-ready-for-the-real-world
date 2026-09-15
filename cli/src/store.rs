//! Local package store, in this OS's standard local-data directory (via
//! the `directories` crate — already cross-platform: `%LOCALAPPDATA%\CDRCA\`
//! on Windows, `~/.local/share/cdrca` on Linux, `~/Library/Application
//! Support/CDRCA` on macOS — see docs/ARCHITECTURE.md's "Building on
//! Linux" section):
//!
//!   cache\            downloaded, verified tarballs, content-addressed by sha256
//!   store\<name>\<version>\   extracted packages, immutable once installed
//!
//! Installs are transactional: download to temp -> verify checksum ->
//! extract to a temp dir -> atomic rename into place. A failed/interrupted
//! install must never leave a half-installed package in the real store.

use anyhow::{bail, Context, Result};
use directories::ProjectDirs;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn open() -> Result<Self> {
        let dirs = ProjectDirs::from("", "", "CDRCA")
            .context("could not determine this OS's local data directory")?;
        let root = dirs.data_local_dir().to_path_buf();
        std::fs::create_dir_all(root.join("cache"))?;
        std::fs::create_dir_all(root.join("store"))?;
        Ok(Self { root })
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }

    pub fn package_dir(&self, name: &str, version: &str) -> PathBuf {
        self.root.join("store").join(name).join(version)
    }

    pub fn is_installed(&self, name: &str, version: &str) -> bool {
        self.package_dir(name, version).is_dir()
    }

    /// Verifies a downloaded file's sha256 against the registry-provided integrity string
    /// ("sha256-<hex>").
    pub fn verify_checksum(path: &Path, expected: &str) -> Result<()> {
        let expected_hex = expected
            .strip_prefix("sha256-")
            .context("integrity string must be in 'sha256-<hex>' form")?;
        let bytes = std::fs::read(path)?;
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hex = hex::encode(hasher.finalize());
        if actual_hex != expected_hex {
            bail!(
                "checksum mismatch: expected {expected_hex}, got {actual_hex} — refusing to install a corrupted/tampered package"
            );
        }
        Ok(())
    }

    /// Extracts a verified .tar.gz into the store atomically: extract to a
    /// sibling temp dir, then rename into place. Never partially populates
    /// the final package_dir.
    pub fn install_from_tarball(&self, name: &str, version: &str, tarball: &Path) -> Result<PathBuf> {
        let final_dir = self.package_dir(name, version);
        if final_dir.exists() {
            bail!("{name}@{version} is already installed — remove it first to reinstall");
        }
        let parent = final_dir.parent().unwrap();
        std::fs::create_dir_all(parent)?;

        let tmp_dir = parent.join(format!(".tmp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp_dir)?;

        let extract_result = (|| -> Result<()> {
            let file = std::fs::File::open(tarball)?;
            let decompressed = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(decompressed);
            archive.unpack(&tmp_dir)?;
            Ok(())
        })();

        if let Err(e) = extract_result {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(e.context("extracting package tarball"));
        }

        // Atomic on the same NTFS volume — this is the transaction boundary.
        std::fs::rename(&tmp_dir, &final_dir)
            .with_context(|| format!("finalizing install of {name}@{version}"))?;

        Ok(final_dir)
    }

    pub fn remove_package(&self, name: &str, version: &str) -> Result<()> {
        let dir = self.package_dir(name, version);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }

    pub fn list_installed(&self) -> Result<Vec<(String, String)>> {
        let mut out = Vec::new();
        let store_dir = self.root.join("store");
        if !store_dir.exists() {
            return Ok(out);
        }
        for name_entry in std::fs::read_dir(&store_dir)? {
            let name_entry = name_entry?;
            if !name_entry.file_type()?.is_dir() {
                continue;
            }
            let name = name_entry.file_name().to_string_lossy().to_string();
            for version_entry in std::fs::read_dir(name_entry.path())? {
                let version_entry = version_entry?;
                if version_entry.file_type()?.is_dir() {
                    let version = version_entry.file_name().to_string_lossy().to_string();
                    out.push((name.clone(), version));
                }
            }
        }
        Ok(out)
    }
}
