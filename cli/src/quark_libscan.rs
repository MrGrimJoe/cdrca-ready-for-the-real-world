//! Static `@useLib <pluginName>.<libraryName>` scanner.
//!
//! Why this exists instead of a runtime loader: a `.cdrca` file's
//! generated code (including any `Quark.__declareLib(...)` calls a
//! `@useLib` directive compiles to — see `templates/plugins/quark/plugin.js`)
//! all runs inside a single synchronous `eval()` in CDRCA's real
//! `Front-end/index.js` (`updateRenderer`). There's no point mid-script to
//! pause execution, inject a `<script>` tag, and wait for it to load before
//! continuing — by the time any generated code runs, the page's `<script>`
//! tags have already been decided. So library selection has to happen
//! ahead of time, based on the source text itself, not at eval-time.
//!
//! This scanner is deliberately a plain text scan, not a real tokenize/parse
//! pass — `@useLib <plugin>.<library>` is simple enough that a line-oriented
//! scan is robust and doesn't need CDRCA's actual tokenizer wired in here.
//! It only decides which library `<script>` tags a project's runtime page
//! copy needs; it never changes what the CLI stages for `plugin.js`/
//! `quark-ui.js` themselves (see `quark_patch.rs`), which are always staged
//! regardless, since they're the plugin's required engine, not an optional
//! library bundle.

use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::path::Path;

/// One `@useLib <pluginName>.<libraryName>` reference found in source.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct LibRef {
    pub plugin_name: String,
    pub library_name: String,
}

/// Scans every `.cdrca` file under `project_root` (recursively, skipping
/// `node_modules`) for `@useLib` directives. Best-effort: a malformed line
/// is skipped rather than failing the whole scan, since this runs as a
/// side step of `create`/`install`/`build`, not as validation — CDRCA's
/// own transpiler is what actually enforces correct `@useLib` syntax (see
/// `plugin.js`'s `parseUseLib`), with a real error, at build/run time.
pub fn scan_project(project_root: &Path) -> Result<BTreeSet<LibRef>> {
    let mut found = BTreeSet::new();
    scan_dir(project_root, &mut found)?;
    Ok(found)
}

fn scan_dir(dir: &Path, found: &mut BTreeSet<LibRef>) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("reading directory {}", dir.display()))?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|n| n.to_str()) == Some("node_modules") {
                continue;
            }
            scan_dir(&path, found)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("cdrca") {
            let contents = std::fs::read_to_string(&path)
                .with_context(|| format!("reading {}", path.display()))?;
            scan_source(&contents, found);
        }
    }
    Ok(())
}

/// `load <plugin>.<library>` — the v2 spelling of `@useLib`. Stricter than
/// the `@useLib` scan on purpose: `load` is an ordinary English word, so it
/// only counts when the WHOLE line is `load`, whitespace, one
/// `<name>.<name>`, and optionally a trailing `//` comment. Anything looser
/// could mistake a line of JavaScript for a library reference.
fn load_line_ref(trimmed: &str) -> Option<LibRef> {
    let rest = trimmed.strip_prefix("load")?;
    // `loader`, `loaded`, `load.x` etc. are not the keyword.
    if !rest.starts_with(|c: char| c == ' ' || c == '\t') {
        return None;
    }
    let rest = rest.trim();
    let rest = match rest.find("//") {
        Some(i) => rest[..i].trim_end(),
        None => rest,
    };
    let (plugin_name, library_name) = rest.split_once('.')?;
    let is_name = |s: &str| {
        let mut chars = s.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if !is_name(plugin_name) || !is_name(library_name) {
        return None;
    }
    Some(LibRef {
        plugin_name: plugin_name.to_string(),
        library_name: library_name.to_string(),
    })
}

fn scan_source(contents: &str, found: &mut BTreeSet<LibRef>) {
    for line in contents.lines() {
        let trimmed = line.trim();
        if let Some(lib) = load_line_ref(trimmed) {
            found.insert(lib);
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("@useLib") else {
            continue;
        };
        let rest = rest.trim();
        // Expect "<pluginName>.<libraryName>", nothing else on the line
        // beyond optional trailing whitespace/comment — anything odder is
        // left for the real transpiler to reject with a proper error.
        let Some((plugin_name, library_name)) = rest.split_once('.') else {
            continue;
        };
        let plugin_name = plugin_name.trim();
        let library_name = library_name
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim();
        if plugin_name.is_empty() || library_name.is_empty() {
            continue;
        }
        found.insert(LibRef {
            plugin_name: plugin_name.to_string(),
            library_name: library_name.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_v2_load_spelling() {
        let mut found = BTreeSet::new();
        scan_source("load quark.components\n", &mut found);
        assert_eq!(found.len(), 1);
        let lib = found.iter().next().unwrap();
        assert_eq!(lib.plugin_name, "quark");
        assert_eq!(lib.library_name, "components");
    }

    #[test]
    fn load_and_uselib_can_be_mixed_and_are_deduplicated() {
        let mut found = BTreeSet::new();
        scan_source(
            "@useLib quark.components\nload quark.components\nload quark.templates // extras\n  load mathcore.icons\n",
            &mut found,
        );
        let names: Vec<String> = found
            .iter()
            .map(|l| format!("{}.{}", l.plugin_name, l.library_name))
            .collect();
        assert_eq!(names, vec!["mathcore.icons", "quark.components", "quark.templates"]);
    }

    #[test]
    fn load_is_only_a_directive_when_the_whole_line_is_one() {
        let mut found = BTreeSet::new();
        scan_source(
            "loader.x\nloaded quark.components\nload.quark.components\nload quark\nload\nload quark.\nload .components\n// load quark.components\nconst a = 1; load quark.components\nload quark.components extra words\nload a b.c\n",
            &mut found,
        );
        assert!(found.is_empty(), "false positives: {:?}", found);
    }

    #[test]
    fn a_load_line_inside_a_js_block_body_shaped_like_a_directive_is_still_only_a_reference() {
        // Documented limitation: this is a text scan, not a parse. A line that
        // is exactly `load a.b` inside a JS block would be picked up; the
        // worst outcome is one extra <script> tag that fails to resolve with
        // a warning, never a wrong compile.
        let mut found = BTreeSet::new();
        scan_source("JS {\nload a.b\n}\n", &mut found);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn finds_a_single_directive() {
        let mut found = BTreeSet::new();
        scan_source("@useLib quark.components\n", &mut found);
        assert_eq!(found.len(), 1);
        assert!(found.contains(&LibRef {
            plugin_name: "quark".to_string(),
            library_name: "components".to_string(),
        }));
    }

    #[test]
    fn finds_multiple_directives_and_dedupes() {
        let mut found = BTreeSet::new();
        scan_source(
            "@useLib quark.components\n@useLib quark.templates\n@useLib quark.components\n",
            &mut found,
        );
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn ignores_unrelated_lines() {
        let mut found = BTreeSet::new();
        scan_source(
            "@mainNav navbar.glass\nuse Something() as x\n@useLib quark.components\n",
            &mut found,
        );
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn tolerates_malformed_lines_without_panicking() {
        let mut found = BTreeSet::new();
        scan_source("@useLib\n@useLib quark\n@useLib .components\n", &mut found);
        assert_eq!(found.len(), 0);
    }

    #[test]
    fn scan_project_finds_directives_across_multiple_files_and_skips_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.cdrca"), "@useLib quark.components\n").unwrap();
        let sub = dir.path().join("scenes");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("other.cdrca"), "@useLib quark.templates\n").unwrap();
        let nm = dir.path().join("node_modules");
        std::fs::create_dir_all(&nm).unwrap();
        std::fs::write(nm.join("ignored.cdrca"), "@useLib quark.components\n").unwrap();

        let found = scan_project(dir.path()).unwrap();
        assert_eq!(found.len(), 2);
    }
}

