//! The `.MrMIB` package format — a single-file, distributable archive for a
//! CDRCA package/plugin/app/library, and the missing counterpart to
//! `install_from_tarball` (store.rs): there is currently no command
//! anywhere in this CLI that *produces* the `.tar.gz` a registry release
//! points at (`publish.rs` only sends the manifest JSON). `cdrca pack`
//! (commands/pack.rs) fills that gap; this module is the archive format
//! itself, usable independently of the registry — e.g. to side-load a
//! plugin or hand someone a demo project without publishing anything.
//!
//! Layout (a gzip'd tar stream, so it opens with any standard tool even
//! though the extension is `.mrmib` — same approach `store.rs` already
//! uses for registry tarballs, no new archive dependency needed):
//!
//!   .mrmib-meta.json   <- always the FIRST entry (see why, below)
//!   cdrca.json
//!   <entry file, icon, libraries/*, ...>   <- whatever the manifest points at
//!
//! `.mrmib-meta.json` first matters for two reasons:
//!   1. A reader can learn the format version and manifest by reading just
//!      the first tar entry, without decompressing/extracting the whole
//!      archive — useful for a registry crawler or `cdrca info` on a local
//!      file.
//!   2. Its `payloadSha256` covers every byte written after it, so a
//!      corrupted or truncated archive is caught locally, the same
//!      integrity guarantee `Store::verify_checksum` gives a
//!      registry-downloaded tarball, but self-contained — no separate
//!      checksum has to travel alongside the file out-of-band.

use crate::manifest::Manifest;
use anyhow::{bail, Context, Result};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

pub const MRMIB_FORMAT_VERSION: u32 = 1;
const META_ENTRY_NAME: &str = ".mrmib-meta.json";
const MANIFEST_ENTRY_NAME: &str = "cdrca.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrmibMeta {
    #[serde(rename = "mrmibFormatVersion")]
    pub format_version: u32,
    pub manifest: Manifest,
    /// "sha256-<hex>" over every byte of the archive after this entry's own
    /// tar header+body — i.e. the rest of the tar stream, pre-gzip. Same
    /// string shape as the registry's `integrity` field (store.rs) so
    /// existing verification code/tests can treat them uniformly.
    #[serde(rename = "payloadSha256")]
    pub payload_sha256: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PackOutcome {
    /// Archive written to the given path.
    Written(PathBuf),
}

/// Builds a `.mrmib` archive from `project_dir` (a directory containing a
/// `cdrca.json` at its root) and writes it to `dest_path`. Mirrors the
/// checks `publish.rs` already does before trusting a manifest enough to
/// send it anywhere — fail fast locally, same as that command's own
/// rationale.
pub fn pack(project_dir: &Path, dest_path: &Path) -> Result<PackOutcome> {
    let manifest_path = project_dir.join("cdrca.json");
    let manifest = Manifest::load(&manifest_path)
        .with_context(|| format!("loading cdrca.json from {}", project_dir.display()))?;
    manifest.validate()?;

    if !manifest.entry_exists(project_dir) {
        bail!(
            "manifest 'entry' field points to '{}' which does not exist in {}",
            manifest.entry,
            project_dir.display()
        );
    }
    let icon_path = project_dir.join(&manifest.icon);
    if !manifest.icon.trim().is_empty() && !icon_path.is_file() {
        bail!(
            "manifest 'icon' field points to '{}' which does not exist in {} \
             (cdrca build app silently falls back to the default logo for a *missing* icon at \
             build time, but cdrca pack refuses to silently ship a broken reference — fix the \
             path or remove the field)",
            manifest.icon,
            project_dir.display()
        );
    }
    for (lib_name, lib_path) in &manifest.libraries {
        if !project_dir.join(lib_path).is_file() {
            bail!(
                "manifest 'libraries.{}' points to '{}' which does not exist in {}",
                lib_name,
                lib_path,
                project_dir.display()
            );
        }
    }

    // Build the payload tar (everything except the meta entry) as its own
    // complete, standalone tar byte buffer — including the tar format's
    // own trailing end-of-archive padding, written by `Builder::into_inner`
    // when it finishes. Hashing THESE EXACT BYTES (rather than
    // reconstructing an equivalent-looking tar later, which the `tar`
    // crate does not guarantee is byte-identical — header checksums and
    // end-of-archive padding are regenerated, not preserved) is what makes
    // `verify_payload_hash` able to reproduce the same hash later: it
    // simply re-reads this same span of bytes out of the final file
    // rather than re-deriving them from parsed entries.
    let payload_tar = build_payload_tar(project_dir, &manifest)?;
    let payload_hash = sha256_hex(&payload_tar);

    let meta = MrmibMeta {
        format_version: MRMIB_FORMAT_VERSION,
        manifest: manifest.clone(),
        payload_sha256: format!("sha256-{payload_hash}"),
    };
    let meta_json = serde_json::to_vec_pretty(&meta).context("serializing .mrmib-meta.json")?;

    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let out_file = std::fs::File::create(dest_path)
        .with_context(|| format!("creating {}", dest_path.display()))?;
    let mut gz = GzEncoder::new(out_file, Compression::default());

    // Write the meta entry's raw header+data bytes directly, WITHOUT going
    // through `tar::Builder::finish`/`into_inner` — those unconditionally
    // append the tar format's 1024-byte end-of-archive marker (see
    // `tar::Builder::finish`), which would land between the meta entry and
    // the payload and throw off exactly where the payload the hash covers
    // actually starts. Building a single-entry tar by hand like this is a
    // few lines (header, size, checksum, content, pad to 512) and keeps
    // the byte layout fully under our control, which `split_meta_and_payload`
    // below depends on.
    let mut meta_header = tar::Header::new_gnu();
    meta_header.set_path(META_ENTRY_NAME)?;
    meta_header.set_size(meta_json.len() as u64);
    meta_header.set_mode(0o644);
    meta_header.set_cksum();
    gz.write_all(meta_header.as_bytes())
        .context("writing .mrmib meta header")?;
    gz.write_all(&meta_json).context("writing .mrmib meta content")?;
    let meta_padding = (512 - (meta_json.len() % 512)) % 512;
    gz.write_all(&vec![0u8; meta_padding])
        .context("writing .mrmib meta padding")?;

    // Write the payload tar's exact bytes right after — this buffer
    // already ends with its own end-of-archive marker (from
    // `build_payload_tar`'s own `Builder::finish`), which is correct here:
    // this whole file's tar stream should end with exactly one such
    // marker, not one after the meta entry AND one at the very end.
    gz.write_all(&payload_tar)
        .context("writing .mrmib payload bytes")?;
    gz.finish().context("finalizing .mrmib gzip stream")?;

    Ok(PackOutcome::Written(dest_path.to_path_buf()))
}

/// Builds the payload (non-meta) portion of the archive as an uncompressed
/// tar byte buffer: `cdrca.json`, the manifest's `entry` file, its `icon`
/// (if any), and every `libraries` bundle — deliberately narrow (not "copy
/// the whole directory") so a project's `node_modules`, `.git`, or a build
/// scratch dir never ends up inside a package by accident. `entry`'s
/// directory is walked (not just the single file) so a `.cdrca` project
/// that imports sibling files under `src/` is packed whole, matching what
/// `package_stage::stage_package` already assumes on the install side.
fn build_payload_tar(project_dir: &Path, manifest: &Manifest) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    {
        let mut builder = tar::Builder::new(&mut buf);

        let manifest_json = std::fs::read(project_dir.join("cdrca.json"))?;
        append_bytes(&mut builder, MANIFEST_ENTRY_NAME, &manifest_json)?;

        let mut already_added: HashSet<PathBuf> = HashSet::new();
        already_added.insert(PathBuf::from("cdrca.json"));

        // The entry file's own directory, walked recursively, covers a
        // typical `src/` with imports. If `entry` has no parent (it's at
        // the project root) only the file itself is added.
        let entry_rel = PathBuf::from(&manifest.entry);
        if let Some(entry_dir) = entry_rel.parent().filter(|p| !p.as_os_str().is_empty()) {
            add_dir_recursive(
                &mut builder,
                project_dir,
                entry_dir,
                &mut already_added,
            )?;
        } else if !already_added.contains(&entry_rel) {
            add_file(&mut builder, project_dir, &entry_rel, &mut already_added)?;
        }

        if !manifest.icon.trim().is_empty() {
            add_file(
                &mut builder,
                project_dir,
                Path::new(&manifest.icon),
                &mut already_added,
            )?;
        }
        for lib_path in manifest.libraries.values() {
            add_file(
                &mut builder,
                project_dir,
                Path::new(lib_path),
                &mut already_added,
            )?;
        }

        builder.finish()?;
    }
    Ok(buf)
}

fn add_file<W: Write>(
    builder: &mut tar::Builder<W>,
    project_dir: &Path,
    rel_path: &Path,
    already_added: &mut HashSet<PathBuf>,
) -> Result<()> {
    if already_added.contains(rel_path) {
        return Ok(());
    }
    let full = project_dir.join(rel_path);
    let data = std::fs::read(&full)
        .with_context(|| format!("reading {} for packing", full.display()))?;
    append_bytes(builder, &tar_path_string(rel_path), &data)?;
    already_added.insert(rel_path.to_path_buf());
    Ok(())
}

fn add_dir_recursive<W: Write>(
    builder: &mut tar::Builder<W>,
    project_dir: &Path,
    rel_dir: &Path,
    already_added: &mut HashSet<PathBuf>,
) -> Result<()> {
    const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", "build"];
    let full_dir = project_dir.join(rel_dir);
    if !full_dir.is_dir() {
        // `entry`'s parent doesn't exist as a directory on disk (unusual,
        // but `entry_exists` only checked the file itself) — nothing more
        // to walk.
        return Ok(());
    }
    for entry in std::fs::read_dir(&full_dir)
        .with_context(|| format!("reading directory {}", full_dir.display()))?
    {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if file_type.is_dir() {
            if SKIP_DIRS.contains(&name_str.as_ref()) || name_str.starts_with('.') {
                continue;
            }
            add_dir_recursive(builder, project_dir, &rel_dir.join(&name), already_added)?;
        } else if file_type.is_file() {
            add_file(builder, project_dir, &rel_dir.join(&name), already_added)?;
        }
    }
    Ok(())
}

fn append_bytes<W: Write>(builder: &mut tar::Builder<W>, name: &str, data: &[u8]) -> Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, name, Cursor::new(data))
        .with_context(|| format!("writing archive entry '{name}'"))
}

/// Tar entries always use forward slashes regardless of host OS, matching
/// what `tar::Builder::append_data` expects and what a Windows-built
/// archive extracted on Linux (or vice versa) needs to round-trip.
fn tar_path_string(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Reads just `.mrmib-meta.json` from an archive without extracting
/// anything else — the "learn what this is without unpacking it" path
/// `cdrca info <file>.mrmib` (or a registry crawler) uses. Fails loudly if
/// the first entry isn't the meta file, since a `.mrmib` where that's not
/// true isn't one this CLI wrote, or is corrupted.
pub fn read_meta(archive_path: &Path) -> Result<MrmibMeta> {
    split_meta_and_payload(archive_path).map(|(meta, _)| meta)
}

/// Decompresses the whole archive and splits it into (meta entry's raw tar
/// bytes, everything after it — the exact payload byte span `pack` hashed
/// and wrote). Tar entries are always padded to 512-byte boundaries and
/// the meta entry is always exactly one entry, so its total on-disk size
/// is directly computable from its header without needing to re-encode
/// anything — this is what lets `verify_payload_hash` reproduce the exact
/// bytes `pack` hashed, rather than an equivalent-looking reconstruction.
fn split_meta_and_payload(archive_path: &Path) -> Result<(MrmibMeta, Vec<u8>)> {
    let file = std::fs::File::open(archive_path)
        .with_context(|| format!("opening {}", archive_path.display()))?;
    let mut decompressed = Vec::new();
    GzDecoder::new(file)
        .read_to_end(&mut decompressed)
        .context("decompressing .mrmib archive")?;

    if decompressed.len() < 512 {
        bail!("'{}' is too small to be a valid .mrmib archive", archive_path.display());
    }
    let header = tar::Header::from_byte_slice(&decompressed[0..512]);
    let path = header
        .path()
        .context("reading first archive entry's header")?
        .into_owned();
    if path != Path::new(META_ENTRY_NAME) {
        bail!(
            "'{}' is not a valid .mrmib archive: expected '{META_ENTRY_NAME}' as the first entry, found '{}'",
            archive_path.display(),
            path.display()
        );
    }
    let entry_size = header
        .size()
        .context("reading first archive entry's size")? as usize;
    let padded_size = ((entry_size + 511) / 512) * 512;
    let meta_total = 512 + padded_size; // header block + padded content
    if decompressed.len() < meta_total {
        bail!("'{}' is truncated: meta entry is incomplete", archive_path.display());
    }

    let meta_json = &decompressed[512..512 + entry_size];
    let meta: MrmibMeta =
        serde_json::from_slice(meta_json).with_context(|| format!("parsing {META_ENTRY_NAME}"))?;
    let payload = decompressed[meta_total..].to_vec();
    Ok((meta, payload))
}

/// Verifies the archive's self-contained integrity hash (distinct from
/// `Store::verify_checksum`, which checks a tarball against an
/// externally-supplied hash from the registry — here the hash travels
/// inside the file itself, so this re-derives what the payload's hash
/// *should* be and compares).
pub fn verify_payload_hash(archive_path: &Path) -> Result<()> {
    let (meta, payload) = split_meta_and_payload(archive_path)?;
    let expected_hex = meta
        .payload_sha256
        .strip_prefix("sha256-")
        .context("payloadSha256 must be in 'sha256-<hex>' form")?;
    let actual_hex = sha256_hex(&payload);
    if actual_hex != expected_hex {
        bail!(
            "payload integrity check failed: expected {expected_hex}, got {actual_hex} — \
             archive may be corrupted or tampered with"
        );
    }
    Ok(())
}

/// Extracts a `.mrmib` archive's payload (everything except the meta
/// entry) into `dest_dir`, verifying the self-contained hash first. Shape
/// matches `Store::install_from_tarball`'s atomic extract-to-temp-then-
/// rename pattern so a `.mrmib` can be installed through the exact same
/// staging path (`plugin_stage`/`package_stage`/`library_stage`) as a
/// registry-downloaded tarball — see commands/pack.rs's `install` support.
pub fn extract_payload(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    let (meta, payload) = split_meta_and_payload(archive_path)?;
    let expected_hex = meta
        .payload_sha256
        .strip_prefix("sha256-")
        .context("payloadSha256 must be in 'sha256-<hex>' form")?;
    let actual_hex = sha256_hex(&payload);
    if actual_hex != expected_hex {
        bail!(
            "refusing to extract a .mrmib archive that failed integrity verification: \
             expected {expected_hex}, got {actual_hex}"
        );
    }

    std::fs::create_dir_all(dest_dir)?;
    let mut archive = tar::Archive::new(Cursor::new(&payload));
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let dest = dest_dir.join(&path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry
            .unpack(&dest)
            .with_context(|| format!("extracting {}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_project(dir: &Path, manifest_json: &str, extra_files: &[(&str, &str)]) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("cdrca.json"), manifest_json).unwrap();
        for (rel, content) in extra_files {
            let p = dir.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(p, content).unwrap();
        }
    }

    fn sample_manifest() -> &'static str {
        r#"{
            "name": "demo-pack",
            "version": "1.0.0",
            "description": "a packing test fixture",
            "type": "app",
            "entry": "src/main.cdrca",
            "icon": "icon.png",
            "author": "test",
            "license": "IOSL",
            "repository": ""
        }"#
    }

    #[test]
    fn packs_and_round_trips_a_simple_project() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            sample_manifest(),
            &[
                ("src/main.cdrca", "!--- SCENE Main :: t ---\n!---END---\n"),
                ("icon.png", "fake-png-bytes"),
            ],
        );

        let dest = tmp.path().join("out.mrmib");
        let outcome = pack(&project, &dest).unwrap();
        assert_eq!(outcome, PackOutcome::Written(dest.clone()));
        assert!(dest.is_file());

        let meta = read_meta(&dest).unwrap();
        assert_eq!(meta.format_version, MRMIB_FORMAT_VERSION);
        assert_eq!(meta.manifest.name, "demo-pack");
        assert!(meta.payload_sha256.starts_with("sha256-"));

        verify_payload_hash(&dest).expect("freshly packed archive must verify");

        let extract_dir = tmp.path().join("extracted");
        extract_payload(&dest, &extract_dir).unwrap();
        assert_eq!(
            fs::read_to_string(extract_dir.join("src/main.cdrca")).unwrap(),
            "!--- SCENE Main :: t ---\n!---END---\n"
        );
        assert_eq!(
            fs::read_to_string(extract_dir.join("icon.png")).unwrap(),
            "fake-png-bytes"
        );
        let repacked_manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(extract_dir.join("cdrca.json")).unwrap())
                .unwrap();
        assert_eq!(repacked_manifest["name"], "demo-pack");
    }

    #[test]
    fn packs_and_round_trips_a_realistically_sized_multi_file_project() {
        // Regression coverage for a real integrity-check failure found
        // while packing the actual pythonmaster plugin: the smaller
        // fixtures above (one or two files) didn't exercise enough entries
        // to catch a pack/verify byte-layout mismatch. This fixture is
        // deliberately bigger and nested, closer to a real plugin package,
        // and is repacked/reverified several times to catch anything
        // that depends on incidental byte alignment rather than being
        // correct for any payload size.
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            r#"{
                "name": "multi-file-demo",
                "version": "2.3.4",
                "description": "a bigger packing fixture",
                "type": "plugin",
                "entry": "src/plugin.js",
                "icon": "icon.png",
                "author": "test",
                "license": "IOSL",
                "repository": ""
            }"#,
            &[
                ("src/plugin.js", &"// a plugin\n".repeat(200)),
                ("src/README.md", "# multi-file-demo\n\nSome docs.\n"),
                ("src/lib/helpers.js", &"// helper code\n".repeat(50)),
                ("src/templates/python-project/main.py", "print('hello')\n"),
                ("src/templates/python-project/db.py", "# db stuff\n"),
                (
                    "src/templates/python-project/requirements.txt",
                    "fastapi\nuvicorn\n",
                ),
                (
                    "src/templates/python-project/assets/style.css",
                    "body { margin: 0; }\n",
                ),
                ("icon.png", "fake-icon-bytes"),
            ],
        );
        // Outside the entry directory and not the icon/a library — should
        // NOT be packed (only entry/icon/libraries are ever included).
        std::fs::write(project.join("extra.js"), "not referenced by the manifest at all").unwrap();

        for attempt in 0..3 {
            let dest = tmp.path().join(format!("out-{attempt}.mrmib"));
            pack(&project, &dest).unwrap();
            verify_payload_hash(&dest)
                .unwrap_or_else(|e| panic!("attempt {attempt}: freshly packed archive must verify: {e}"));

            let extract_dir = tmp.path().join(format!("extracted-{attempt}"));
            extract_payload(&dest, &extract_dir).unwrap();
            assert!(extract_dir.join("src/plugin.js").is_file());
            assert!(extract_dir.join("src/README.md").is_file());
            assert!(extract_dir.join("src/lib/helpers.js").is_file());
            assert!(extract_dir
                .join("src/templates/python-project/assets/style.css")
                .is_file());
            assert!(extract_dir.join("icon.png").is_file());
            assert!(!extract_dir.join("extra.js").exists());
        }
    }

    #[test]
    fn walks_the_entry_directory_so_sibling_imports_survive() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            sample_manifest(),
            &[
                ("src/main.cdrca", "require sibling\n"),
                ("src/sibling.cdrca", "!--- SCENE Sibling :: t ---\n!---END---\n"),
                ("icon.png", "x"),
            ],
        );
        let dest = tmp.path().join("out.mrmib");
        pack(&project, &dest).unwrap();
        let extract_dir = tmp.path().join("extracted");
        extract_payload(&dest, &extract_dir).unwrap();
        assert!(extract_dir.join("src/sibling.cdrca").is_file());
    }

    #[test]
    fn packs_a_root_level_entry_like_pythonmasters_real_shape() {
        // pythonmaster's actual cdrca.json has entry="plugin.js" at the
        // project root (no parent dir to walk) alongside other root-level
        // files (README, LICENSE, tests/, bin/, templates/) that are
        // correctly NOT part of the package. Mirrors that exact layout.
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            r#"{
                "name": "pythonmaster-like",
                "version": "0.1.0",
                "description": "mirrors pythonmaster's real layout",
                "type": "plugin",
                "entry": "plugin.js",
                "icon": "",
                "author": "",
                "license": "IOSL",
                "repository": ""
            }"#,
            &[
                ("plugin.js", &"module.exports = function (pluginAPI) {};\n".repeat(80)),
                ("README.md", "# pythonmaster-like\n"),
                ("LICENSE.md", "some license text\n"),
                ("bin/pythonmaster.js", "#!/usr/bin/env node\n"),
                ("templates/python-project/main.py", "print('hi')\n"),
                ("tests/plugin.test.js", "// tests, not shipped\n"),
            ],
        );

        for attempt in 0..3 {
            let dest = tmp.path().join(format!("root-out-{attempt}.mrmib"));
            pack(&project, &dest).unwrap();
            verify_payload_hash(&dest)
                .unwrap_or_else(|e| panic!("attempt {attempt}: must verify: {e}"));
            let extract_dir = tmp.path().join(format!("root-extracted-{attempt}"));
            extract_payload(&dest, &extract_dir).unwrap();
            assert!(extract_dir.join("plugin.js").is_file());
            assert!(extract_dir.join("cdrca.json").is_file());
            assert!(!extract_dir.join("README.md").exists());
            assert!(!extract_dir.join("bin").exists());
            assert!(!extract_dir.join("tests").exists());
        }
    }

    #[test]
    fn node_modules_and_dotfiles_under_the_entry_dir_are_never_packed() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            sample_manifest(),
            &[
                ("src/main.cdrca", "x"),
                ("src/node_modules/junk.js", "should not be packed"),
                ("src/.hidden/secret.txt", "should not be packed either"),
                ("icon.png", "x"),
            ],
        );
        let dest = tmp.path().join("out.mrmib");
        pack(&project, &dest).unwrap();
        let extract_dir = tmp.path().join("extracted");
        extract_payload(&dest, &extract_dir).unwrap();
        assert!(!extract_dir.join("src/node_modules").exists());
        assert!(!extract_dir.join("src/.hidden").exists());
    }

    #[test]
    fn missing_entry_file_is_refused_at_pack_time_not_shipped_broken() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(&project, sample_manifest(), &[("icon.png", "x")]);
        // src/main.cdrca deliberately not written.
        let dest = tmp.path().join("out.mrmib");
        let err = pack(&project, &dest).unwrap_err();
        assert!(err.to_string().contains("entry"));
        assert!(!dest.exists(), "must not leave a partial file behind");
    }

    #[test]
    fn missing_icon_is_refused_rather_than_silently_shipped_without_one() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(&project, sample_manifest(), &[("src/main.cdrca", "x")]);
        // icon.png deliberately not written.
        let dest = tmp.path().join("out.mrmib");
        let err = pack(&project, &dest).unwrap_err();
        assert!(err.to_string().contains("icon"));
    }

    #[test]
    fn tampering_with_the_archive_after_packing_is_detected() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            sample_manifest(),
            &[("src/main.cdrca", "original"), ("icon.png", "x")],
        );
        let dest = tmp.path().join("out.mrmib");
        pack(&project, &dest).unwrap();

        // Flip some bytes well past the gzip header/meta entry so the
        // archive still opens but its payload no longer matches the hash
        // recorded in .mrmib-meta.json.
        let mut bytes = fs::read(&dest).unwrap();
        let len = bytes.len();
        for b in bytes.iter_mut().skip(len.saturating_sub(64)) {
            *b ^= 0xFF;
        }
        fs::write(&dest, &bytes).unwrap();

        let meta_result = read_meta(&dest);
        let verify_result = verify_payload_hash(&dest);
        // Either the corruption breaks the tar/gzip framing enough that
        // read_meta itself fails, or it doesn't and verify_payload_hash
        // catches the mismatch — either way, something must error, since
        // silently accepting a tampered archive is the failure this
        // function exists to prevent.
        assert!(
            meta_result.is_err() || verify_result.is_err(),
            "corrupted archive must be rejected by read_meta or verify_payload_hash"
        );
    }

    #[test]
    fn extract_refuses_a_failed_verification_and_writes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        write_project(
            &project,
            sample_manifest(),
            &[("src/main.cdrca", "original"), ("icon.png", "x")],
        );
        let dest = tmp.path().join("out.mrmib");
        pack(&project, &dest).unwrap();

        let mut bytes = fs::read(&dest).unwrap();
        let len = bytes.len();
        for b in bytes.iter_mut().skip(len.saturating_sub(64)) {
            *b ^= 0xFF;
        }
        fs::write(&dest, &bytes).unwrap();

        let extract_dir = tmp.path().join("extracted");
        // If the corruption broke framing badly enough that even read_meta
        // fails, extraction must still fail (never partially succeed) —
        // this asserts the failure rather than which specific error fired.
        let result = extract_payload(&dest, &extract_dir);
        assert!(result.is_err());
        assert!(
            !extract_dir.exists() || fs::read_dir(&extract_dir).unwrap().next().is_none(),
            "a failed extraction must not leave partial output behind"
        );
    }

    #[test]
    fn a_plain_tar_gz_that_is_not_a_mrmib_archive_is_rejected_not_misread() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("plain.mrmib");
        let file = fs::File::create(&dest).unwrap();
        let gz = GzEncoder::new(file, Compression::default());
        let mut builder = tar::Builder::new(gz);
        let mut header = tar::Header::new_gnu();
        header.set_size(5);
        header.set_cksum();
        builder
            .append_data(&mut header, "cdrca.json", Cursor::new(b"{}xyz" as &[u8]))
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();

        let err = read_meta(&dest).unwrap_err();
        assert!(err.to_string().contains("not a valid .mrmib archive"));
    }
}

