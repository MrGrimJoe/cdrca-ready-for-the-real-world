//! Login token storage. Uses the Windows Credential Manager via the `keyring`
//! crate rather than a plaintext file. On non-Windows dev builds falls back
//! to a config-dir file so `cargo run`/tests work off-Windows too — the
//! shipped Windows build always uses Credential Manager.

use anyhow::{Context, Result};

const SERVICE: &str = "cdrca-cli";
const USER: &str = "default";

#[cfg(windows)]
pub fn store_token(token: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, USER)?;
    entry.set_password(token).context("storing token in Windows Credential Manager")?;
    Ok(())
}

#[cfg(windows)]
pub fn load_token() -> Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, USER)?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("reading token from Windows Credential Manager"),
    }
}

#[cfg(windows)]
pub fn clear_token() -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, USER)?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("deleting token from Windows Credential Manager"),
    }
}

// --- non-Windows fallback: plaintext file instead of a system keyring ---
//
// This is the actually-correct choice for Linux dev/CI/sandbox use, not
// a compromise: `keyring`'s Linux backend needs a Secret Service/D-Bus
// session, which a headless container (a Claude Code sandbox, most CI
// runners) doesn't have — that would fail outright, not degrade
// gracefully. `cdrca publish`/`cdrca login` are the only commands that
// ever read this; every other command (`create`, `install` from a
// pre-existing lockfile, `run`, `build app`, `doctor`) needs no token at
// all, so this only matters for the narrow slice of testing that
// actually touches the registry. See docs/ARCHITECTURE.md's "Building on
// Linux" section.

#[cfg(not(windows))]
fn token_path() -> Result<std::path::PathBuf> {
    let dirs = directories::ProjectDirs::from("", "", "CDRCA")
        .context("could not determine config dir")?;
    std::fs::create_dir_all(dirs.config_dir())?;
    Ok(dirs.config_dir().join("token.dev-fallback"))
}

#[cfg(not(windows))]
pub fn store_token(token: &str) -> Result<()> {
    std::fs::write(token_path()?, token)?;
    Ok(())
}

#[cfg(not(windows))]
pub fn load_token() -> Result<Option<String>> {
    let path = token_path()?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(path)?))
}

#[cfg(not(windows))]
pub fn clear_token() -> Result<()> {
    let path = token_path()?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
