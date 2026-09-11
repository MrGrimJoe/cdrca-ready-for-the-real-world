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
  extension, and compiles the installer on every tagged release.

## Building locally

**CLI:**
```
cd cli
cargo build --release
```
Requires a reasonably current stable Rust toolchain — some transitive
dependencies require newer Cargo than very old distro-packaged Rust
provides.

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
- **`.cdrca` files show VS Code's generic file icon, not a CDRCA-branded
  one.** Deliberately not fixed in this pass: VS Code has no way for an
  extension to add "just one" file icon to whatever theme the user has
  active — contributing a `fileIconTheme` means defining icons for every
  file type, or every file *without* a rule loses its icon entirely when
  a user selects it. A single-language extension shipping a full icon
  theme is a known anti-pattern for exactly that reason. If this is
  worth doing properly, it likely means a from-scratch icon theme
  (covering common file types, not just `.cdrca`) as its own separate
  effort, not a quick addition here.
