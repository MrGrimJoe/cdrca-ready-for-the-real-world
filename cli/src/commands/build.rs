use anyhow::{bail, Context, Result};
use serde_json::json;
use std::path::Path;

use crate::manifest::Manifest;
use crate::project_state::ProjectState;

const DEFAULT_LOGO: &[u8] = include_bytes!("../templates/assets/cdrca-logo.png");

/// `cdrca build app` — generates tauri.conf.json from cdrca.json into a
/// scratch dir, resolves the icon (falling back to the bundled default CDRCA
/// logo), and invokes the Tauri build pipeline. The user never hand-writes
/// Tauri config themselves.
pub fn run(project_root: &Path) -> Result<()> {
    let manifest = Manifest::load(&project_root.join("cdrca.json")).context("loading cdrca.json")?;

    let scratch = project_root.join(".cdrca-build");
    std::fs::create_dir_all(&scratch)?;
    std::fs::create_dir_all(scratch.join("icons"))?;

    // Resolve icon relative to project root; fall back to the bundled
    // default CDRCA logo if missing, so we never ship a blank/generic icon.
    let icon_src = project_root.join(&manifest.icon);
    let resolved_icon = scratch.join("icons").join("icon.png");
    if icon_src.is_file() {
        std::fs::copy(&icon_src, &resolved_icon)
            .context("copying project icon into build scratch dir")?;
    } else {
        eprintln!(
            "warning: icon '{}' not found — using bundled default CDRCA logo",
            manifest.icon
        );
        std::fs::write(&resolved_icon, DEFAULT_LOGO)?;
    }

    // NOTE: Tauri wants multiple icon sizes (32/128/256/ico). In the real
    // build this should shell into `tauri icon <resolved_icon>` (bundled
    // with the Tauri CLI) to generate the full icon set before continuing.
    // Left as an explicit TODO rather than silently skipped.
    println!("TODO: run `tauri icon {}` to generate the full icon set", resolved_icon.display());

    let state = ProjectState::load_or_default(project_root)?;
    let port = state.port.context(
        "no port assigned to this project yet — run 'cdrca create app' or 'cdrca install cdrca' first",
    )?;
    if !state.port_patch_applied {
        eprintln!(
            "warning: this project's local CDRCA copy was not successfully patched for \
             per-project ports — the packaged app may fail to reach CDRCA on port {port} if \
             CDRCA falls back to its hardcoded default (3000) instead."
        );
    }

    let tauri_conf = json!({
        "productName": manifest.name,
        "version": manifest.version,
        "identifier": format!("dev.cdrca.{}", sanitize_identifier(&manifest.name)),
        "app": {
            "windows": [{
                "title": manifest.name,
                "width": 1024,
                "height": 768
            }]
        },
        "bundle": {
            "active": true,
            "targets": ["nsis"],
            "icon": ["icons/icon.png"]
        },
        // Port is baked in at create/install time (see patch.rs +
        // project_state.rs) — not renegotiated here. The remaining open gap
        // is CDRCA's server-ready signal (see build.rs history / the CLI
        // design discussion): there's still no clean "ready" event from
        // Servers.main.init(), so the packaged app's own startup sequence
        // needs a readiness poll against this fixed port rather than a
        // runtime port-negotiation step.
        "build": {
            "devUrl": format!("http://127.0.0.1:{port}"),
            "beforeDevCommand": "",
            "beforeBuildCommand": ""
        }
    });

    let conf_path = scratch.join("tauri.conf.json");
    std::fs::write(&conf_path, serde_json::to_string_pretty(&tauri_conf)?)
        .context("writing generated tauri.conf.json")?;

    println!("Generated Tauri config at {}", conf_path.display());
    println!("Invoking Tauri build...");

    let status = std::process::Command::new("cargo")
        .args(["tauri", "build", "--config", conf_path.to_str().unwrap()])
        .current_dir(project_root)
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("Build complete. Distributable .exe is under {}/target/release/bundle/", project_root.display());
            Ok(())
        }
        Ok(s) => bail!("tauri build exited with status {s}"),
        Err(e) => bail!(
            "failed to invoke `cargo tauri build` ({e}) — is the Tauri CLI installed? \
             It's bundled by the CDRCA installer's Rust toolchain step."
        ),
    }
}

fn sanitize_identifier(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect()
}
