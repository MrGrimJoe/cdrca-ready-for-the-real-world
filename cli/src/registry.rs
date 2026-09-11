//! HTTP client for the CDRCA registry API.
//! This is the FIXED contract shared with the separate website team — do not
//! add/rename endpoints here without confirming against their spec.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const REGISTRY_BASE_URL: &str = "https://registry.cdrca.dev"; // placeholder — set to the real deployed URL

#[derive(Debug, Deserialize)]
pub struct PackageInfo {
    pub manifest: crate::manifest::Manifest,
    #[serde(rename = "latestVersion")]
    pub latest_version: String,
    pub readme: String,
    pub versions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct VersionInfo {
    pub manifest: crate::manifest::Manifest,
    #[serde(rename = "githubReleaseAssetUrl")]
    pub github_release_asset_url: String,
    /// Not in the original contract text but required for the transactional
    /// install's checksum step — flag with the registry team if genuinely absent.
    pub integrity: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SearchResult {
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub package_type: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: String,
}

pub struct RegistryClient {
    http: reqwest::Client,
    base_url: String,
    token: Option<String>,
}

impl RegistryClient {
    pub fn new(token: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: REGISTRY_BASE_URL.to_string(),
            token,
        }
    }

    fn authed(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.token {
            Some(t) => builder.bearer_auth(t),
            None => builder,
        }
    }

    pub async fn search(&self, query: &str) -> Result<Vec<SearchResult>> {
        let url = format!("{}/api/search", self.base_url);
        let resp = self
            .http
            .get(&url)
            .query(&[("q", query)])
            .send()
            .await
            .context("GET /api/search failed")?
            .error_for_status()
            .context("registry returned an error for /api/search")?;
        resp.json().await.context("parsing /api/search response")
    }

    pub async fn package_info(&self, name: &str) -> Result<PackageInfo> {
        let url = format!("{}/api/packages/{}", self.base_url, name);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .with_context(|| format!("GET /api/packages/{name} failed"))?
            .error_for_status()
            .with_context(|| format!("registry returned an error for package '{name}'"))?;
        resp.json().await.context("parsing package info response")
    }

    pub async fn version_info(&self, name: &str, version: &str) -> Result<VersionInfo> {
        let url = format!("{}/api/packages/{}/{}", self.base_url, name, version);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .with_context(|| format!("GET /api/packages/{name}/{version} failed"))?
            .error_for_status()
            .with_context(|| format!("registry returned an error for {name}@{version}"))?;
        resp.json().await.context("parsing version info response")
    }

    pub async fn publish(&self, name: &str, manifest: &crate::manifest::Manifest) -> Result<()> {
        let url = format!("{}/api/packages/{}/releases", self.base_url, name);
        self.authed(self.http.post(&url))
            .json(manifest)
            .send()
            .await
            .with_context(|| format!("POST /api/packages/{name}/releases failed"))?
            .error_for_status()
            .context("registry rejected the publish request — check you're logged in (cdrca login)")?;
        Ok(())
    }

    /// Downloads a release asset (from GitHub, per the URL the registry returned)
    /// directly to the given path. Never goes through npm.
    pub async fn download_asset(&self, url: &str, dest: &std::path::Path) -> Result<()> {
        use futures_util::StreamExt;
        use std::io::Write;

        let resp = self
            .http
            .get(url)
            .send()
            .await
            .context("downloading release asset failed")?
            .error_for_status()
            .context("release asset download returned an error status")?;

        let mut file = std::fs::File::create(dest)?;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("reading download stream")?;
            file.write_all(&chunk)?;
        }
        Ok(())
    }
}

/// Placeholder used until the login flow is wired to a real HTTP callback server.
#[derive(Debug, Deserialize, Serialize)]
pub struct AuthCallbackResponse {
    pub token: String,
}

pub type DependencyMap = HashMap<String, String>;
