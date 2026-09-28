# Contributing

## Repo layout

- `cli/` — the Rust CLI/package manager (`cdrca` binary). See
  [docs/CLI-COMMANDS.md](./CLI-COMMANDS.md) for behavior,
  [docs/ARCHITECTURE.md](./ARCHITECTURE.md) for design rationale.
- `extension/` — the VS Code extension, bundled into the installer as a
  `.vsix` rather than published separately. See `extension/README.md`.
- `installer/` — the Windows and Linux installer sources: the Inno Setup
  script (`cdrca-installer.iss`) that produces `cdrca-installer.exe`,
  and `installer/linux/install.sh`, the Linux counterpart packaged into
  `cdrca-installer-linux.tar.gz`. CI-staged assets for both live under
  their respective `staged/` directories at build time, not committed.
- `docs/` — this folder.
- `.github/workflows/release.yml` — two independent jobs,
  `build-windows-installer` and `build-linux-installer`, each building
  the CLI for its own platform, packaging the extension, and compiling
  its own installer on every tagged release (`v*` push) or manual
  `workflow_dispatch` run. A GitHub Release is only created on tag
  pushes (Releases require a tag to attach to); manual runs skip that
  step and just upload each platform's installer as a workflow artifact
  instead (`cdrca-installer-windows`, `cdrca-installer-linux`).

## Building locally

**CLI:**
```
cd cli
cargo build --release
```
Requires a reasonably current stable Rust toolchain — some transitive
dependencies require newer Cargo than very old distro-packaged Rust
provides (this repo's `Cargo.toml` already pins several dependencies
down for exactly this reason — see
[docs/ARCHITECTURE.md#building-on-linux](./ARCHITECTURE.md#building-on-linux)
if you hit this and need to understand or extend those pins, e.g. on a
sandboxed Linux environment with no `rustup` access). Run `cdrca doctor`
after building to sanity-check your toolchain, login state, and local
package store in one pass — see
[docs/CLI-COMMANDS.md#cdrca-doctor](./CLI-COMMANDS.md#cdrca-doctor).

## Testing a plugin or library locally before publishing

`cdrca create plugin <name>` scaffolds a package, but there's no
registry entry for it yet to `cdrca install` normally. To test it
against a real host project before `cdrca publish`:

1. `cdrca create app <test-project>` somewhere, to get a real host with
   a working CDRCA runtime.
2. Copy your plugin's directory (with a real `cdrca.json`) into that
   project's local package store at the exact path `cdrca install`
   would have created it — `<store root>/store/<name>/<version>/`,
   where `<store root>` is whatever `directories::ProjectDirs::from("",
   "", "CDRCA").data_local_dir()` resolves to on your OS (typically
   `%LOCALAPPDATA%\CDRCA` on Windows, `~/.local/share/CDRCA` on Linux —
   see `cli/src/store.rs`, not a hardcoded path).
3. Call `plugin_stage::stage_plugin()` (or `package_stage::stage_package`
   / `library_stage::stage_library`, depending on your package's `type`)
   directly against that project — there's no CLI subcommand for "stage
   an arbitrary local directory as if it were installed" yet, so this
   currently means either a small throwaway Rust test/binary calling the
   function directly, or hand-replicating what it does (see that
   module's own source — each one is a straightforward, well-commented
   file copy + JSON index update).
4. `cdrca install <your-plugin>` in the test project once it's actually
   in the store this way, so the version-lockfile/staging path itself
   also gets exercised, not just the staging function in isolation.

This is a real gap worth closing with an actual CLI subcommand (e.g.
`cdrca link <path>`, mirroring `npm link`) — not done here since it's
outside plan-doc section 1's scope, called out for whoever picks up the
2.5 "Build a Plugin" guide page work on the website side, since the
guide will want a real answer for this step.

**Extension:**
```
cd extension
npm install
npx @vscode/vsce package
```

**Windows installer** (requires Inno Setup 6):
```
cd installer
ISCC.exe cdrca-installer.iss
```
Note the installer script expects staged assets (`cdrca.exe`,
`rustup-init.exe`, the CDRCA logo — both the flat banner PNG and the
multi-resolution `.ico` — and the extension `.vsix`) under
`installer/staged/` — see the `build-windows-installer` job in
`.github/workflows/release.yml` for exactly how CI stages these before
compiling.

**Linux installer** (any platform that can produce a Linux `cdrca`
binary and has `tar`):
```
mkdir -p installer/linux/staged
cp cli/target/release/cdrca installer/linux/staged/
cp installer/linux/install.sh installer/linux/staged/
cp LICENSE.md installer/linux/staged/
cp extension/cdrca-extension.vsix installer/linux/staged/   # optional
tar czf cdrca-installer-linux.tar.gz -C installer/linux/staged .
```
This is just what `build-linux-installer` automates in CI — there's no
compile step like Inno Setup, it's a plain tarball. See the comments at
the top of `installer/linux/install.sh` for what it does and doesn't
try to do (no bundled Rust toolchain, no VS Code registry-key
detection — see [docs/ARCHITECTURE.md#building-on-linux-and-what-actually-ships-there](./ARCHITECTURE.md#building-on-linux-and-what-actually-ships-there)).

## Fixed contracts — don't change without coordinating

Two things in this repo are shared contracts with other people's work
and should not be redesigned unilaterally:

- **`cdrca.json`'s shape** ([docs/MANIFEST-SPEC.md](./MANIFEST-SPEC.md))
  — shared with the registry website team.
- **The OAuth login callback shape** (`cli/OAUTH-CONTRACT-TODO.md`) —
  still pending confirmation from the registry team as of this writing.

## Open items worth knowing before you dig in

- `cli/OAUTH-CONTRACT-TODO.md` — login flow param names/shapes need
  registry-side confirmation.
- The server-ready-signal gap described in
  [docs/ARCHITECTURE.md](./ARCHITECTURE.md#the-remaining-open-gap-server-ready-signaling)
  — both the build pipeline and the extension's run button currently
  poll a port rather than waiting for a real readiness signal.
- The manifest-level `uses` permission model and CDRCA's in-DSL
  `@requires`/`plugin { ... }` syntax haven't been fully reconciled —
  see [docs/PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md).
- **Quark, the built-in UI component directive layer
  (`cli/src/quark_patch.rs`), is staged into every project but isn't
  active yet** — verified directly against the published npm `cdrca`
  package, which doesn't yet contain the plugin-hook system it depends
  on. See [docs/QUARK.md](./QUARK.md).
- **`.cdrca` files now get a CDRCA-branded icon in VS Code, via a small
  opt-in File Icon Theme** (`extension/icons/theme/`), not by hooking
  into whatever icon theme the user already has active — VS Code has no
  API for "just add one icon" to an existing theme. Selecting **CDRCA
  Icons** (Command Palette → *Preferences: File Icon Theme*) replaces
  the user's current icon theme with this one, which is a real tradeoff:
  it only ships generic file/folder icons plus the CDRCA-specific one,
  not full coverage of every language extension the way something like
  Material Icon Theme has. That's an intentional, minimal scope — see
  `extension/README.md#file-icons`.
