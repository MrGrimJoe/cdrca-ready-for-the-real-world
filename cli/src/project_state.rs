//! Per-project local state — deliberately kept OUT of cdrca.json, which is
//! a fixed contract shared with the registry website and shouldn't grow
//! implementation-detail fields. Tracks things decided once at create/
//! install time, like the port baked into this project's patched local
//! CDRCA copy (see patch.rs) — not renegotiated on every `cdrca run`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const STATE_FILE: &str = ".cdrca-state.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectState {
    /// Port baked into this project via the CDRCA_PORT patch. None until
    /// a create/install step has run.
    pub port: Option<u16>,
    /// Whether patch::patch_port() succeeded for this project. If false,
    /// `port` may still be set, but CDRCA_PORT is silently ignored by the
    /// unpatched server and it falls back to its hardcoded 3000.
    pub port_patch_applied: bool,
    /// Whether quark_patch::patch_quark() reported a fully active state
    /// (QuarkPatchOutcome::is_ok()) for this project. False covers both
    /// "not staged" (npm install cdrca hasn't run) and "staged but inert"
    /// (this project's local CDRCA copy predates the plugin-hook system)
    /// — either way, `@id component.variant` directives won't work yet.
    pub quark_patch_applied: bool,
}

impl ProjectState {
    pub fn load_or_default(project_root: &Path) -> Result<Self> {
        let path = project_root.join(STATE_FILE);
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn save(&self, project_root: &Path) -> Result<()> {
        let path = project_root.join(STATE_FILE);
        let raw = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, raw).with_context(|| format!("writing {}", path.display()))
    }

    /// Allocates a fresh free port via bind-to-:0-then-release and stores it,
    /// only if one isn't already assigned (create/install shouldn't
    /// reassign a port an already-scaffolded project is relying on).
    pub fn ensure_port(&mut self) -> Result<u16> {
        if let Some(p) = self.port {
            return Ok(p);
        }
        let probe = std::net::TcpListener::bind("127.0.0.1:0")
            .context("allocating a port for this project")?;
        let port = probe.local_addr()?.port();
        drop(probe);
        self.port = Some(port);
        Ok(port)
    }
}
