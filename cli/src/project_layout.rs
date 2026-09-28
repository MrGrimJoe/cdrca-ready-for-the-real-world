//! The part of `cdrca.json` that describes a project's own page: `html` (one
//! page) or `pages` (several).
//!
//! These fields are deliberately NOT on [`crate::manifest::Manifest`]. That
//! struct is the contract shared with the registry site, and `cdrca publish`
//! serialises it, so a field added there is a field the registry receives. A
//! page layout is local to a project, so it is read from the same file
//! separately: `Manifest` ignores what it doesn't declare, and `publish`
//! never sends it.
//!
//! The rules here mirror `templates/cdrca-runtime/project-server.js`
//! (`readLayout`), which is what actually serves the pages. This side exists
//! to decide which server `cdrca run` starts, and to fail early with a clear
//! message rather than serving a broken page.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::path::Path;

/// One page: the URL it is served at, its HTML file, and the `.cdrca`
/// program added to it (if it names one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub url: String,
    pub html: String,
    pub entry: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectLayout {
    pub pages: Vec<Page>,
}

impl ProjectLayout {
    /// Read `html` / `pages` from `<project_root>/cdrca.json`. `pages` wins
    /// over `html`; with only `html`, the single page is `/` and its program
    /// is the manifest's `entry`. Neither present means an empty layout (the
    /// project has no page of its own).
    pub fn load(project_root: &Path) -> Result<Self> {
        let file = project_root.join("cdrca.json");
        let raw = std::fs::read_to_string(&file)
            .with_context(|| format!("reading {}", file.display()))?;
        Self::from_json(&raw).with_context(|| format!("in {}", file.display()))
    }

    pub fn from_json(raw: &str) -> Result<Self> {
        let root: Value = serde_json::from_str(raw).context("cdrca.json is not valid JSON")?;
        let mut pages = Vec::new();

        if let Some(pages_value) = root.get("pages") {
            let map = pages_value.as_object().with_context(|| {
                "'pages' must be an object like { \"/\": { \"html\": \"public/index.html\" } }"
            })?;
            for (url, page) in map {
                if !url.starts_with('/') {
                    bail!("page URL '{url}' must start with '/'");
                }
                let obj = page
                    .as_object()
                    .with_context(|| format!("page '{url}' must be an object with an 'html' field"))?;
                let html = clean_path(obj.get("html"), &format!("pages['{url}'].html"))?;
                let entry = match obj.get("entry") {
                    None => None,
                    Some(v) => Some(clean_path(Some(v), &format!("pages['{url}'].entry"))?),
                };
                pages.push(Page {
                    url: normalize_url(url),
                    html,
                    entry,
                });
            }
        } else if let Some(html) = root.get("html") {
            let html = clean_path(Some(html), "'html'")?;
            let entry = match root.get("entry") {
                Some(v) if v.is_string() => Some(clean_path(Some(v), "'entry'")?),
                _ => None,
            };
            pages.push(Page {
                url: "/".to_string(),
                html,
                entry,
            });
        }
        Ok(Self { pages })
    }

    /// Does this project serve its own page (so `cdrca run` should start the
    /// project server rather than the preview page)?
    pub fn owns_page(&self) -> bool {
        !self.pages.is_empty()
    }

    /// Check that everything the layout points at exists.
    pub fn validate(&self, project_root: &Path) -> Result<()> {
        for page in &self.pages {
            if !project_root.join(&page.html).is_file() {
                bail!(
                    "page '{}' points at '{}', which does not exist in this project",
                    page.url,
                    page.html
                );
            }
            if let Some(entry) = &page.entry {
                if !entry.ends_with(".cdrca") {
                    bail!(
                        "page '{}': program '{}' is not a .cdrca file",
                        page.url,
                        entry
                    );
                }
                if !project_root.join(entry).is_file() {
                    bail!(
                        "page '{}': program '{}' does not exist in this project",
                        page.url,
                        entry
                    );
                }
            }
        }
        Ok(())
    }
}

fn normalize_url(url: &str) -> String {
    if url.len() > 1 && url.ends_with('/') {
        let t = url.trim_end_matches('/');
        return if t.is_empty() { "/".to_string() } else { t.to_string() };
    }
    url.to_string()
}

/// A path written in `cdrca.json`: relative, inside the project.
fn clean_path(value: Option<&Value>, what: &str) -> Result<String> {
    let s = match value.and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => bail!("{what} must be a non-empty path"),
    };
    let p = s.replace('\\', "/");
    let p = p.strip_prefix("./").unwrap_or(&p).to_string();
    let drive = p.len() >= 2 && p.as_bytes()[1] == b':' && p.as_bytes()[0].is_ascii_alphabetic();
    if p.starts_with('/') || drive || p.split('/').any(|seg| seg == "..") {
        bail!("{what} '{s}' must be a path inside the project (no leading '/', no '..')");
    }
    Ok(p)
}

/// Add `"html": "<path>"` to the end of a `cdrca.json` that was written by
/// `serde_json::to_string_pretty`, keeping every existing field where it is
/// (re-serialising through a generic JSON value would sort the keys).
pub fn add_html_field(json: &str, html: &str) -> Result<String> {
    let trimmed = json.trim_end();
    let body = trimmed
        .strip_suffix('}')
        .with_context(|| "cdrca.json doesn't end with '}'")?
        .trim_end();
    let value = serde_json::to_string(html)?;
    let joined = if body.ends_with('{') {
        format!("{body}\n  \"html\": {value}\n}}\n")
    } else {
        format!("{body},\n  \"html\": {value}\n}}\n")
    };
    // Refuse to hand back something that isn't the object we started with.
    let parsed: Value = serde_json::from_str(&joined).context("produced invalid JSON")?;
    if parsed.get("html").and_then(Value::as_str) != Some(html) {
        bail!("could not add the html field");
    }
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(json: &str) -> Result<ProjectLayout> {
        ProjectLayout::from_json(json)
    }

    #[test]
    fn no_html_or_pages_means_no_page_of_its_own() {
        let l = layout(r#"{"name":"x","entry":"src/main.cdrca"}"#).unwrap();
        assert!(!l.owns_page());
        assert!(l.pages.is_empty());
    }

    #[test]
    fn html_alone_is_one_page_at_root_using_the_manifest_entry() {
        let l = layout(r#"{"entry":"src/main.cdrca","html":"public/index.html"}"#).unwrap();
        assert!(l.owns_page());
        assert_eq!(
            l.pages,
            vec![Page {
                url: "/".into(),
                html: "public/index.html".into(),
                entry: Some("src/main.cdrca".into())
            }]
        );
    }

    #[test]
    fn pages_gives_one_page_per_url_and_wins_over_html() {
        let l = layout(
            r#"{"html":"ignored.html","entry":"e.cdrca","pages":{
                "/":{"html":"public/index.html","entry":"src/home.cdrca"},
                "/about/":{"html":"public/about.html"}}}"#,
        )
        .unwrap();
        let urls: Vec<&str> = l.pages.iter().map(|p| p.url.as_str()).collect();
        assert_eq!(urls, vec!["/", "/about"], "trailing slash normalised");
        assert_eq!(l.pages[0].entry.as_deref(), Some("src/home.cdrca"));
        assert_eq!(l.pages[1].entry, None, "a page's program is its own, not the manifest's");
        assert!(!l.pages.iter().any(|p| p.html == "ignored.html"));
    }

    #[test]
    fn empty_pages_object_owns_nothing() {
        assert!(!layout(r#"{"pages":{}}"#).unwrap().owns_page());
    }

    #[test]
    fn backslashes_and_leading_dot_slash_are_tidied() {
        let l = layout(r#"{"html":".\\public\\index.html"}"#).unwrap();
        assert_eq!(l.pages[0].html, "public/index.html");
        let l = layout(r#"{"html":"./public/index.html"}"#).unwrap();
        assert_eq!(l.pages[0].html, "public/index.html");
    }

    #[test]
    fn paths_that_leave_the_project_are_refused_and_the_field_is_named() {
        for (json, needle) in [
            (r#"{"html":"../x.html"}"#, "'html'"),
            (r#"{"html":"/etc/passwd"}"#, "'html'"),
            (r#"{"html":"C:/x.html"}"#, "'html'"),
            (r#"{"html":"a/../../x.html"}"#, "'html'"),
            (r#"{"html":""}"#, "'html'"),
            (r#"{"html":5}"#, "'html'"),
            (r#"{"pages":{"/a":{"html":"../a.html"}}}"#, "pages['/a'].html"),
            (r#"{"pages":{"/a":{"html":"a.html","entry":"/abs.cdrca"}}}"#, "pages['/a'].entry"),
        ] {
            let err = layout(json).unwrap_err().to_string();
            assert!(err.contains(needle), "{json} -> {err}");
        }
    }

    #[test]
    fn malformed_pages_are_refused() {
        assert!(layout(r#"{"pages":[]}"#).unwrap_err().to_string().contains("'pages' must be an object"));
        assert!(layout(r#"{"pages":{"about":{"html":"a.html"}}}"#).unwrap_err().to_string().contains("must start with '/'"));
        assert!(layout(r#"{"pages":{"/a":"a.html"}}"#).unwrap_err().to_string().contains("must be an object"));
        assert!(layout("not json").is_err());
    }

    #[test]
    fn validate_checks_every_file_it_points_at() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let l = layout(r#"{"entry":"src/main.cdrca","html":"public/index.html"}"#).unwrap();
        assert!(l.validate(root).unwrap_err().to_string().contains("public/index.html"));
        std::fs::create_dir_all(root.join("public")).unwrap();
        std::fs::write(root.join("public/index.html"), "<p>").unwrap();
        assert!(l.validate(root).unwrap_err().to_string().contains("src/main.cdrca"));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.cdrca"), "").unwrap();
        l.validate(root).unwrap();
    }

    #[test]
    fn validate_rejects_a_program_that_is_not_a_cdrca_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.html"), "").unwrap();
        std::fs::write(dir.path().join("a.js"), "").unwrap();
        let l = layout(r#"{"pages":{"/":{"html":"a.html","entry":"a.js"}}}"#).unwrap();
        assert!(l.validate(dir.path()).unwrap_err().to_string().contains("not a .cdrca file"));
    }

    /// The registry contract: `cdrca publish` serialises `Manifest` and sends
    /// it. A cdrca.json carrying page-layout fields must still load, and those
    /// fields must never appear in what gets sent.
    #[test]
    fn layout_fields_load_fine_but_are_never_part_of_what_publish_sends() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cdrca.json");
        std::fs::write(
            &path,
            r#"{"name":"site","version":"0.1.0","description":"d","type":"app",
                "entry":"src/main.cdrca","icon":"icon.png","author":"a","license":"MIT",
                "repository":"","dependencies":{},"permissions":[],"uses":[],
                "html":"public/index.html",
                "pages":{"/":{"html":"public/index.html"}},
                "assets":{"include":["x"]}}"#,
        )
        .unwrap();
        let manifest = crate::manifest::Manifest::load(&path).expect("layout fields must not break loading");
        let sent = serde_json::to_string(&manifest).unwrap();
        for local_only in ["\"html\"", "\"pages\"", "\"assets\""] {
            assert!(!sent.contains(local_only), "{local_only} would have been sent to the registry: {sent}");
        }
        assert!(ProjectLayout::load(dir.path()).unwrap().owns_page());
    }

    #[test]
    fn add_html_field_keeps_key_order_and_adds_one_field_at_the_end() {
        let before = serde_json::to_string_pretty(&serde_json::json!({"name":"x","version":"0.1.0","entry":"e.cdrca"})).unwrap();
        let after = add_html_field(&before, "public/index.html").unwrap();
        // serde_json sorts a json! object, so `before` is alphabetical: entry, name, version
        let keys: Vec<String> = serde_json::from_str::<serde_json::Map<String, Value>>(&after).unwrap().keys().cloned().collect();
        assert!(keys.contains(&"html".to_string()));
        assert!(after.find("\"name\"").unwrap() < after.find("\"html\"").unwrap(), "existing fields stay before the new one");
        assert!(after.ends_with("}\n"));
        assert_eq!(after.matches("\"html\"").count(), 1);
    }

    #[test]
    fn add_html_field_survives_awkward_input() {
        assert_eq!(
            serde_json::from_str::<Value>(&add_html_field("{}", "a.html").unwrap()).unwrap()["html"],
            "a.html"
        );
        assert!(add_html_field("[1]", "a.html").is_err());
        assert!(add_html_field("", "a.html").is_err());
        let tricky = add_html_field("{\n  \"a\": \"}\"\n}\n", "we\"ird.html").unwrap();
        assert_eq!(serde_json::from_str::<Value>(&tricky).unwrap()["html"], "we\"ird.html");
    }
}
