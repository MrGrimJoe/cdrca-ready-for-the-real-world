//! `cdrca doctor` — a read-only diagnostic sweep of the local environment.
//! Every check is independent and best-effort: one failing check must never
//! stop the rest from running, since the whole point is to show the user
//! everything that's wrong (or not) in one pass. Nothing here mutates state.

use std::path::Path;
use std::process::Command as Proc;
use std::time::Duration;

const REGISTRY_BASE_URL: &str = "https://registry.cdrca.dev";

enum Status {
    Ok,
    Warn,
    Fail,
    Info,
}

impl Status {
    fn tag(&self) -> &'static str {
        match self {
            Status::Ok => "[ OK ]",
            Status::Warn => "[WARN]",
            Status::Fail => "[FAIL]",
            Status::Info => "[INFO]",
        }
    }
}

fn report(status: Status, line: impl AsRef<str>) -> bool {
    println!("{} {}", status.tag(), line.as_ref());
    matches!(status, Status::Warn | Status::Fail)
}

/// Runs `program args...` (typically a `--version` probe) and returns the
/// first line of stdout if the process ran *and* exited successfully.
/// `None` covers both "couldn't run it at all" (not found, no permission)
/// and "ran but reported failure" (e.g. `cargo tauri --version` when the
/// Tauri CLI subcommand isn't installed) — both mean "not available", and
/// conflating them would misreport a missing subcommand as present.
fn probe(program: &str, args: &[&str]) -> Option<String> {
    let output = Proc::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line)
    }
}

pub async fn run(cwd: &Path) -> anyhow::Result<()> {
    println!("cdrca doctor — checking your CDRCA environment\n");
    let mut warnings_or_failures = 0usize;

    // --- cdrca itself -------------------------------------------------
    report(
        Status::Info,
        format!("cdrca CLI version {}", env!("CARGO_PKG_VERSION")),
    );

    // --- Rust toolchain (needed for `cdrca build app`) -----------------
    match probe("rustc", &["--version"]) {
        Some(v) => {
            report(Status::Ok, format!("Rust toolchain found: {v}"));
        }
        None => {
            warnings_or_failures += report(
                Status::Fail,
                "rustc not found on PATH — `cdrca build app` will not work. \
                 The CDRCA installer sets this up silently; if you installed \
                 some other way, reinstall via cdrca-installer.exe or install \
                 Rust manually.",
            ) as usize;
        }
    }
    match probe("cargo", &["--version"]) {
        Some(v) => {
            report(Status::Ok, format!("cargo found: {v}"));
        }
        None => {
            warnings_or_failures += report(Status::Fail, "cargo not found on PATH.") as usize;
        }
    }

    // --- Tauri CLI (needed specifically for `cdrca build app`) ---------
    match probe("cargo", &["tauri", "--version"]) {
        Some(v) => {
            report(Status::Ok, format!("Tauri CLI found: {v}"));
        }
        None => {
            warnings_or_failures += report(
                Status::Warn,
                "`cargo tauri` not available — `cdrca build app` will fail until \
                 this is installed. It's normally bundled by the Windows installer's \
                 Rust toolchain step.",
            ) as usize;
        }
    }

    // --- login / auth ---------------------------------------------------
    match crate::auth::load_token() {
        Ok(Some(_)) => {
            report(Status::Ok, "Logged in (a registry token is stored).");
        }
        Ok(None) => {
            warnings_or_failures += report(
                Status::Warn,
                "Not logged in — `cdrca publish` and anything requiring auth \
                 will fail. Run `cdrca login`.",
            ) as usize;
        }
        Err(e) => {
            warnings_or_failures += report(
                Status::Fail,
                format!("Could not read stored login token: {e}"),
            ) as usize;
        }
    }

    // --- registry reachability ------------------------------------------
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(client) => match client.get(REGISTRY_BASE_URL).send().await {
            Ok(resp) => {
                report(
                    Status::Ok,
                    format!("Registry reachable at {REGISTRY_BASE_URL} (HTTP {}).", resp.status()),
                );
            }
            Err(e) => {
                warnings_or_failures += report(
                    Status::Warn,
                    format!(
                        "Could not reach the registry at {REGISTRY_BASE_URL}: {e}. \
                         Note this base URL is still a placeholder pending the real \
                         deployed address (see registry.rs) — this may not mean \
                         anything is broken on your end."
                    ),
                ) as usize;
            }
        },
        Err(e) => {
            warnings_or_failures +=
                report(Status::Fail, format!("Could not build an HTTP client: {e}")) as usize;
        }
    }

    // --- local package store ---------------------------------------------
    match crate::store::Store::open() {
        Ok(store) => match store.list_installed() {
            Ok(installed) => {
                report(
                    Status::Ok,
                    format!("Local package store OK — {} package(s) installed.", installed.len()),
                );
                if let Some(stray) = find_stray_tmp_dirs(&store) {
                    warnings_or_failures += report(
                        Status::Warn,
                        format!(
                            "Found {stray} leftover .tmp-* dir(s) in the local store, likely \
                             from an interrupted install. Safe to delete by hand; a future \
                             install won't touch them."
                        ),
                    ) as usize;
                }
            }
            Err(e) => {
                warnings_or_failures +=
                    report(Status::Fail, format!("Could not read local package store: {e}")) as usize;
            }
        },
        Err(e) => {
            warnings_or_failures +=
                report(Status::Fail, format!("Could not open local package store: {e}")) as usize;
        }
    }

    // --- VS Code ------------------------------------------------------
    match probe("code", &["--version"]) {
        Some(v) => {
            report(Status::Ok, format!("VS Code found on PATH (version {v})."));
            match vscode_extension_installed() {
                Some(true) => {
                    report(Status::Ok, "CDRCA VS Code extension appears to be installed.");
                }
                Some(false) => {
                    warnings_or_failures += report(
                        Status::Warn,
                        "VS Code is installed but the CDRCA extension wasn't found. \
                         Reinstall via cdrca-installer.exe, or package it yourself \
                         from extension/ (see extension/README.md).",
                    ) as usize;
                }
                None => {
                    report(
                        Status::Info,
                        "Couldn't determine whether the CDRCA extension is installed \
                         (could not locate the VS Code extensions folder).",
                    );
                }
            }
        }
        None => {
            report(
                Status::Info,
                "VS Code not found on PATH — skipping extension check (this is fine if \
                 you don't use VS Code).",
            );
        }
    }

    // --- current project, if any ------------------------------------------
    let manifest_path = cwd.join("cdrca.json");
    if manifest_path.is_file() {
        println!("\nCurrent directory looks like a CDRCA project:");
        match crate::project_state::ProjectState::load_or_default(cwd) {
            Ok(state) => match state.port {
                Some(port) => {
                    report(Status::Ok, format!("Project port assigned: {port}"));
                    if !state.port_patch_applied {
                        warnings_or_failures += report(
                            Status::Warn,
                            format!(
                                "Port patch was not successfully applied for this project — \
                                 the local CDRCA copy may ignore CDRCA_PORT and fall back to \
                                 its hardcoded default (3000) instead of {port}."
                            ),
                        ) as usize;
                    }
                    if state.quark_patch_applied {
                        report(Status::Ok, "Quark UI directive plugin is active for this project.");
                    } else {
                        warnings_or_failures += report(
                            Status::Warn,
                            "Quark is not active for this project — either `cdrca install cdrca` \
                             hasn't run, or this project's local CDRCA copy predates the \
                             plugin-hook system Quark depends on. `@id component.variant` \
                             directives will throw \"Unexpected token\" until this is resolved. \
                             Run `cdrca install cdrca` to re-check.",
                        ) as usize;
                    }
                }
                None => {
                    report(
                        Status::Info,
                        "No port assigned yet — run `cdrca install cdrca` or `cdrca create app`.",
                    );
                }
            },
            Err(e) => {
                warnings_or_failures += report(
                    Status::Fail,
                    format!("Could not read project state (.cdrca-state.json): {e}"),
                ) as usize;
            }
        }
    }

    println!();
    if warnings_or_failures == 0 {
        println!("Everything checks out.");
    } else {
        println!("{warnings_or_failures} item(s) above may need attention.");
    }

    Ok(())
}

fn find_stray_tmp_dirs(store: &crate::store::Store) -> Option<usize> {
    let store_root = store.cache_dir().parent()?.join("store");
    if !store_root.is_dir() {
        return None;
    }
    let mut count = 0;
    for name_entry in std::fs::read_dir(&store_root).ok()?.flatten() {
        if !name_entry.file_type().ok()?.is_dir() {
            continue;
        }
        for version_entry in std::fs::read_dir(name_entry.path()).ok()?.flatten() {
            let file_name = version_entry.file_name();
            if file_name.to_string_lossy().starts_with(".tmp-") {
                count += 1;
            }
        }
    }
    if count > 0 {
        Some(count)
    } else {
        None
    }
}

/// Best-effort check for the CDRCA extension under the user's VS Code
/// extensions folder (~/.vscode/extensions on all platforms, including
/// Windows). Returns None if we can't even locate the folder.
fn vscode_extension_installed() -> Option<bool> {
    let home = directories::UserDirs::new()?.home_dir().to_path_buf();
    let ext_dir = home.join(".vscode").join("extensions");
    if !ext_dir.is_dir() {
        return None;
    }
    let found = std::fs::read_dir(ext_dir).ok()?.flatten().any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .starts_with("islah.cdrca-vscode")
    });
    Some(found)
}
