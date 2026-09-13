# Contributing

## Repo layout

- `cli/` — the Rust CLI/package manager (`cdrca` binary). See
  [docs/CLI-COMMANDS.md](./CLI-COMMANDS.md) for behavior,
  [docs/ARCHITECTURE.md](./ARCHITECTURE.md) for design rationale.
- `extension/` — the VS Code extension, bundled into the installer as a
  `.vsix` rather than published separately. See `extension/README.md`.
- `installer/` — the Inno Setup script and CI-staged assets that produce
  `cdrca-installer.exe`.
- `docs/` — this folder.
- `.github/workflows/release.yml` — builds the CLI, packages the
  extension, and compiles the installer on every tagged release (`v*`
  push) or manual `workflow_dispatch` run. A GitHub Release is only
  created on tag pushes (Releases require a tag to attach to); manual
  runs skip that step and just upload `cdrca-installer.exe` as a
  workflow artifact instead.

## Building locally

**CLI:**
```
cd cli
cargo build --release
```
Requires a reasonably current stable Rust toolchain — some transitive
dependencies require newer Cargo than very old distro-packaged Rust
provides. Run `cdrca doctor` after building to sanity-check your
toolchain, login state, and local package store in one pass — see
[docs/CLI-COMMANDS.md#cdrca-doctor](./CLI-COMMANDS.md#cdrca-doctor).

**Extension:**
```
cd extension
npm install
npx @vscode/vsce package
```

**Installer** (Windows only, requires Inno Setup 6):
```
cd installer
ISCC.exe cdrca-installer.iss
```
Note the installer script expects staged assets (`cdrca.exe`,
`rustup-init.exe`, the CDRCA logo — both the flat banner PNG and the
multi-resolution `.ico` — and the extension `.vsix`) under
`installer/staged/` — see `.github/workflows/release.yml` for exactly
how CI stages these before compiling.

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
