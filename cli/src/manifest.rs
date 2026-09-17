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
    /// A bundle that extends someone else's (or one's own) plugin —
    /// published as an independent package, resolved via `providesFor`.
    /// See PLUGIN-LIBRARIES.md for the full design and
    /// `plugin_frontend_patch.rs` for how an installed library actually
    /// gets loaded into a project's page.
    Library,
}

/// Which plugin + library-bundle-name slot a `type: "library"` package
/// fills — the counterpart to a `.cdrca` file's `@useLib <plugin>.<library>`
/// directive. Required (both fields non-empty) when `type` is `"library"`;
/// meaningless and ignored otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvidesFor {
    pub plugin: String,
    pub library: String,
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
    /// Optional, only meaningful on a `type: "plugin"` manifest: bundles
    /// the plugin ships itself, mapped `<libraryName> -> <path relative to
    /// this manifest>` (mirrors what `quark_library_file()` currently
    /// hardcodes for Quark). A `.cdrca` file's `@useLib <thisPlugin>.<name>`
    /// resolves against this map FIRST — see `plugin_frontend_patch.rs` —
    /// before falling back to checking installed `type: "library"`
    /// packages whose `providesFor` targets this plugin.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub libraries: HashMap<String, String>,
    /// Required (and only meaningful) when `type` is `"library"` — which
    /// plugin + library-bundle-name slot this package fills. See
    /// `ProvidesFor` and PLUGIN-LIBRARIES.md.
    #[serde(default, rename = "providesFor", skip_serializing_if = "Option::is_none")]
    pub provides_for: Option<ProvidesFor>,
}

/// Built-in plugins that ship inside the CLI itself rather than as a
/// published registry package: Quark (`quark_patch.rs`) and the
/// animations grammar (`Back-end/Transpiler/Plugins/animations/plugin.js`,
/// staged into every project's bundled `plugins.json` the same way Quark
/// is). A `type: "library"` package's `providesFor.plugin` is allowed to
/// name one of these even though `GET /api/packages/<name>` will never
/// resolve on the registry for either — see PLUGIN-LIBRARIES.md and the
/// site's own `server/api.ts` validation (mirrors this list; update both
/// together).
pub const BUILTIN_PLUGIN_NAMES: &[&str] = &["quark", "animations"];

pub fn is_builtin_plugin(name: &str) -> bool {
    BUILTIN_PLUGIN_NAMES.contains(&name)
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
        if self.package_type == PackageType::Library {
            let Some(provides_for) = &self.provides_for else {
                bail!("manifest type is 'library' but 'providesFor' is missing — a library must declare which plugin + library-bundle-name slot it fills, e.g. {{ \"plugin\": \"quark\", \"library\": \"icons\" }}");
            };
            if provides_for.plugin.trim().is_empty() {
                bail!("manifest field 'providesFor.plugin' is empty");
            }
            if provides_for.library.trim().is_empty() {
                bail!("manifest field 'providesFor.library' is empty");
            }
            // Whether `providesFor.plugin` names a REAL published plugin
            // can only be confirmed against the registry, which this
            // fast, offline check deliberately doesn't round-trip to
            // (see this function's own doc comment) — but the tiny
            // built-in allowlist IS checkable locally, so at least that
            // half gets a real answer instead of always deferring.
            if !is_builtin_plugin(&provides_for.plugin) {
                eprintln!(
                    "note: 'providesFor.plugin' is '{}', not one of this CLI's known \
                     built-ins ({BUILTIN_PLUGIN_NAMES:?}) — this offline check can't confirm \
                     it's a real published plugin; the registry validates that at publish time",
                    provides_for.plugin
                );
            }
        } else if self.provides_for.is_some() {
            eprintln!(
                "warning: manifest declares 'providesFor' but type is '{}', not 'library' — \
                 it will be ignored",
                self.package_type_label()
            );
        }
        if !self.libraries.is_empty() && self.package_type != PackageType::Plugin {
            eprintln!(
                "warning: manifest declares 'libraries' but type is '{}', not 'plugin' — \
                 it will be ignored",
                self.package_type_label()
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
            PackageType::Library => "library",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_manifest(package_type: PackageType) -> Manifest {
        Manifest {
            name: "test-pkg".to_string(),
            version: "1.0.0".to_string(),
            description: "test".to_string(),
            package_type,
            entry: "index.cdrca".to_string(),
            icon: "icon.png".to_string(),
            author: "tester".to_string(),
            license: "IOSL".to_string(),
            repository: String::new(),
            dependencies: HashMap::new(),
            permissions: Vec::new(),
            uses: Vec::new(),
            libraries: HashMap::new(),
            provides_for: None,
        }
    }

    #[test]
    fn library_without_provides_for_is_rejected() {
        let m = base_manifest(PackageType::Library);
        assert!(m.validate().is_err());
    }

    #[test]
    fn library_with_empty_provides_for_fields_is_rejected() {
        let mut m = base_manifest(PackageType::Library);
        m.provides_for = Some(ProvidesFor {
            plugin: String::new(),
            library: "icons".to_string(),
        });
        assert!(m.validate().is_err());

        let mut m2 = base_manifest(PackageType::Library);
        m2.provides_for = Some(ProvidesFor {
            plugin: "quark".to_string(),
            library: String::new(),
        });
        assert!(m2.validate().is_err());
    }

    #[test]
    fn library_with_valid_provides_for_passes() {
        let mut m = base_manifest(PackageType::Library);
        m.provides_for = Some(ProvidesFor {
            plugin: "quark".to_string(),
            library: "icons".to_string(),
        });
        assert!(m.validate().is_ok());
    }

    #[test]
    fn provides_for_on_a_non_library_manifest_is_a_warning_not_an_error() {
        let mut m = base_manifest(PackageType::Package);
        m.provides_for = Some(ProvidesFor {
            plugin: "quark".to_string(),
            library: "icons".to_string(),
        });
        // Warns to stderr but doesn't fail validation.
        assert!(m.validate().is_ok());
    }

    #[test]
    fn builtin_plugin_allowlist_recognizes_quark() {
        assert!(is_builtin_plugin("quark"));
        assert!(!is_builtin_plugin("some-random-third-party-plugin"));
    }

    #[test]
    fn builtin_plugin_allowlist_recognizes_animations() {
        // animations ships bundled the same way quark does (see
        // cdrca-runtime's plugins.json) — a third-party `type: "library"`
        // package targeting it via providesFor should get the same
        // "recognized built-in" treatment quark gets, not the "can't
        // confirm this is real" note meant for unknown plugin names.
        assert!(is_builtin_plugin("animations"));
    }

    #[test]
    fn providing_for_animations_is_not_flagged_as_unrecognized() {
        let mut m = base_manifest(PackageType::Library);
        m.provides_for = Some(ProvidesFor {
            plugin: "animations".to_string(),
            library: "easing-curves".to_string(),
        });
        assert!(m.validate().is_ok());
    }

    #[test]
    fn manifest_round_trips_through_json_with_new_fields() {
        let mut m = base_manifest(PackageType::Plugin);
        m.libraries.insert("icons".to_string(), "dist/icons.js".to_string());
        let raw = serde_json::to_string(&m).unwrap();
        let parsed: Manifest = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.libraries.get("icons"), Some(&"dist/icons.js".to_string()));
        assert_eq!(parsed.package_type, PackageType::Plugin);
    }

    #[test]
    fn old_manifests_without_new_fields_still_parse() {
        // A manifest written before `libraries`/`providesFor` existed —
        // #[serde(default)] must keep these backward compatible.
        let raw = r#"{
            "name": "old-pkg",
            "version": "1.0.0",
            "description": "d",
            "type": "plugin",
            "entry": "plugin.js",
            "icon": "icon.png",
            "author": "a",
            "license": "IOSL",
            "repository": ""
        }"#;
        let parsed: Manifest = serde_json::from_str(raw).unwrap();
        assert!(parsed.libraries.is_empty());
        assert!(parsed.provides_for.is_none());
    }
}
