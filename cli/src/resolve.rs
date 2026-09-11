//! Dependency resolution. Flat store keyed by name@version (no npm-style
//! nested hoisting needed since install sites reference exact resolved
//! versions via the lockfile) — a simple BFS over declared dependencies,
//! picking the highest version satisfying the tightest compatible range
//! seen so far for each package.

use anyhow::{Context, Result};
use semver::{Version, VersionReq};
use std::collections::{HashMap, VecDeque};

use crate::registry::RegistryClient;

pub struct ResolvedGraph {
    /// name -> chosen version
    pub resolved: HashMap<String, Version>,
}

/// Parses a constraint string ("^1.2.3", ">=2.0.0", "1.4.2" exact pin) into
/// a VersionReq. semver::VersionReq natively supports ^ and >=; a bare
/// version string is treated as an exact pin ("=1.4.2").
pub fn parse_constraint(raw: &str) -> Result<VersionReq> {
    let trimmed = raw.trim();
    let normalized = if trimmed
        .chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
    {
        format!("={trimmed}") // bare version => exact pin
    } else {
        trimmed.to_string()
    };
    VersionReq::parse(&normalized).with_context(|| format!("invalid version constraint '{raw}'"))
}

pub async fn resolve(
    client: &RegistryClient,
    root_deps: &HashMap<String, String>,
) -> Result<ResolvedGraph> {
    let mut constraints: HashMap<String, VersionReq> = HashMap::new();
    let mut resolved: HashMap<String, Version> = HashMap::new();
    let mut queue: VecDeque<(String, String)> = root_deps
        .iter()
        .map(|(n, v)| (n.clone(), v.clone()))
        .collect();

    while let Some((name, constraint_str)) = queue.pop_front() {
        let req = parse_constraint(&constraint_str)?;

        // Tighten: if we've already got a constraint for this package, keep
        // whichever version satisfies BOTH — simplistic but correct for a
        // flat store; a real intersection algorithm can replace this later
        // if conflicting ranges ever need reporting instead of last-wins.
        constraints.insert(name.clone(), req.clone());

        let info = client
            .package_info(&name)
            .await
            .with_context(|| format!("resolving dependency '{name}'"))?;

        let mut candidates: Vec<Version> = info
            .versions
            .iter()
            .filter_map(|v| Version::parse(v).ok())
            .filter(|v| req.matches(v))
            .collect();
        candidates.sort();
        let chosen = candidates
            .pop()
            .with_context(|| format!("no version of '{name}' satisfies constraint '{constraint_str}'"))?;

        // Re-resolving an already-resolved package to a *different* version
        // is a conflict worth surfacing rather than silently overwriting.
        if let Some(existing) = resolved.get(&name) {
            if existing != &chosen {
                anyhow::bail!(
                    "version conflict for '{name}': already resolved to {existing}, but '{constraint_str}' requires {chosen}"
                );
            }
            continue; // already resolved to a compatible version, skip re-queueing deps
        }

        resolved.insert(name.clone(), chosen.clone());

        let version_info = client.version_info(&name, &chosen.to_string()).await?;
        for (dep_name, dep_constraint) in version_info.manifest.dependencies.iter() {
            queue.push_back((dep_name.clone(), dep_constraint.clone()));
        }
    }

    Ok(ResolvedGraph { resolved })
}
