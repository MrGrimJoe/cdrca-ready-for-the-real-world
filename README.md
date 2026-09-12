# CDRCA Tooling

A package ecosystem and native-app tooling suite for
[CDRCA](https://github.com/ISLAH-org/CDRCA), Muhammad Ayyan's
JavaScript-based animation DSL. This repo is the tooling layer — the CLI,
package manager, Windows installer, and VS Code extension — **not the
CDRCA language itself.** The language's own source, transpiler, and
authoritative syntax docs live in
[Ayyan's upstream repo](https://github.com/ISLAH-org/CDRCA); this repo
never modifies that source, it only installs and runs a local copy of it.

## What is CDRCA?

CDRCA is a small DSL for describing animation scenes: you declare a
scene, bring in objects, and drive them with actions. A CDRCA source file
(`.cdrca`) scaffolded by this tooling looks like this:

```
!--- SCENE Main :: Bouncing balls demo ---
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1
add new action bounce1 2000 500
def ACTION bounce1 ball1 modifyMesh ""
!---END---
```

A few things you can see directly from that example and from the
language's own syntax grammar (`extension/syntaxes/cdrca.tmLanguage.json`):

- A scene is bounded by a `!--- ... ---` / `!---END---` marker pair.
- `use <path> as <name>` pulls in an object (here, a prop from CDRCA's
  built-in animation-system namespace) under a local alias.
- `add new action <name> <args...>` declares an action; `def ACTION
  <name> <target> <verb> <args>` defines what it actually does.
- CDRCA also has a plugin system with its own DSL syntax —
  `@requires`, `@syntaxPlugin` directives, and inline
  `plugin <name> scope <scope> trusted <bool> { ... }` blocks — for
  hooking into the transpiler pipeline. See
  [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md) for what a
  plugin is allowed to do and how the CLI surfaces that to you.
- This tooling also ships **Quark**, a built-in library of prebuilt UI
  components applied with a one-line directive —
  `@sidebar sidebar.closable.edgy = value` — instead of hand-coding the
  component. Every `cdrca create app` / `cdrca install cdrca` stages it
  into your project automatically. See [docs/QUARK.md](./docs/QUARK.md)
  — including an important current caveat about what's actually active
  yet.

This repo's job is everything *around* that language: scaffolding
projects, installing packages/plugins written in it, running them, and
building them into distributable apps. For the language's full syntax
reference and runtime behavior, see the
[upstream CDRCA repo](https://github.com/ISLAH-org/CDRCA) — this repo
intentionally doesn't duplicate that documentation.

## What's in here

- **`cli/`** — the `cdrca` CLI: a fully custom, GitHub-backed package
  manager (search/install/publish/update packages, plugins, and apps),
  plus project scaffolding and a Tauri-based build pipeline that turns a
  CDRCA project into a distributable Windows `.exe`.
- **`extension/`** — a VS Code extension: syntax highlighting, a
  "Create New Project" command, and a run button. Bundled into the
  installer below rather than published to the Marketplace separately —
  **don't look for this on the VS Code Marketplace, it isn't there.**
- **`installer/`** — a Windows installer (Inno Setup) that bundles the
  CLI, a silent Rust toolchain install (so `cdrca build app` works
  immediately, zero extra setup), the CDRCA branding/icons, and,
  optionally, the VS Code extension.
- **`docs/`** — architecture, manifest spec, CLI reference, plugin
  security model, licensing notes, and contributor notes. See
  [Documentation](#documentation) below.

## Platform support

**Windows only**, by design, not as a current limitation to be lifted
later:

- The installer (`installer/cdrca-installer.iss`) is an Inno Setup
  script that produces a Windows `.exe`.
- `cdrca build app` packages a project into a distributable **Windows**
  `.exe` via Tauri.
- `cdrca login`'s token is stored in the **Windows Credential Manager**
  specifically (`cli/src/auth.rs`); non-Windows dev builds fall back to a
  plaintext config-dir file purely so `cargo run`/tests work off-Windows,
  and that fallback is never what ships.
- PATH is added via the Windows-specific `HKCU\Environment` registry key.

The CLI's Rust source isn't Windows-locked at the language level and can
be built on other platforms for local development (see
[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md#building-locally)), but
non-Windows is not a supported target for actual use.

## Install

**Option A — download the installer** (recommended): grab the latest
`cdrca-installer.exe` from this repo's
[Releases](../../releases) page and run it. It installs the `cdrca` CLI
to PATH, silently sets up a Rust toolchain, registers CDRCA's own icon
for `.cdrca` files in Explorer, and — if VS Code is detected on your
machine — offers to install the VS Code extension too (you can still opt
in manually later if VS Code isn't installed yet).

**Option B — build from source:** see
[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md#building-locally).

## Quick start

```
cdrca create app my-first-project
cd my-first-project
cdrca run              # launches it directly
cdrca build app         # packages it into a distributable .exe
```

Or from VS Code: `Ctrl+Shift+P` → **CDRCA: Create New Project** (folder
picker, then a name prompt — this path is independent of the terminal
one above), then use the ▶ run button in the editor toolbar on any
`.cdrca` file.

## CLI commands, at a glance

Full details, flags, and examples for every command are in
[docs/CLI-COMMANDS.md](./docs/CLI-COMMANDS.md) — this is just a map so
you know what exists.

| Command | What it does |
|---|---|
| `cdrca login` / `cdrca logout` | GitHub OAuth login to the registry; clears the stored token. |
| `cdrca search <query>` | Searches the registry for packages/plugins/apps. |
| `cdrca info <package>` | Shows manifest details for a registry package. |
| `cdrca install <package>[@version]` | Installs a package from the registry (or `cdrca` itself via npm — see below). |
| `cdrca update [package]` | Updates one package, or everything in the lockfile. |
| `cdrca remove <package>` | Removes a package from the local store and lockfile. |
| `cdrca list` | Lists everything installed in the local package store. |
| `cdrca outdated` | Compares your lockfile against the registry's latest versions. |
| `cdrca publish` | Validates and publishes the current project's package to the registry. |
| `cdrca create app <name>` | Scaffolds a new CDRCA app project, end to end. |
| `cdrca run` | Runs the current project's CDRCA server directly. |
| `cdrca build app` | Packages the current project into a distributable Windows `.exe`. |
| `cdrca doctor` | Diagnoses your local toolchain, login, registry, and store setup. |

## VS Code extension, at a glance

Full details in [extension/README.md](./extension/README.md).

- **Syntax highlighting** for `.cdrca` files.
- **`CDRCA: Create New Project`** command (Command Palette) — folder
  picker, name prompt, scaffolds via the CLI, opens the result.
- **Run button** (▶) in the editor toolbar for any open `.cdrca` file —
  runs the project, health-checks the port, opens a live preview panel
  beside your editor. A stop button (■) tears it down.
- Requires the `cdrca` CLI already on PATH, and only activates inside an
  actual CDRCA project or when a `.cdrca` file is open.
- Optional **CDRCA Icons** file icon theme for branded `.cdrca` icons in
  the Explorer — opt-in via *Preferences: File Icon Theme*, since it
  replaces rather than layers onto your existing icon theme.
- Not on the VS Code Marketplace — install it via the main installer, or
  package it yourself from `extension/` (see its README).

## What to expect (project status)

This is a working but early-stage tooling project, with a few things
worth knowing before you dig in:

- **The registry OAuth contract is unconfirmed.** `cdrca login`'s exact
  callback param names/shape are documented as an assumption pending
  sign-off from whoever maintains the registry site — see
  `cli/OAUTH-CONTRACT-TODO.md`.
- **No server-ready signal from CDRCA itself yet.** `cdrca run`'s
  Tauri build config and the VS Code run button both currently poll the
  port until it accepts a connection, rather than waiting for a real
  "ready" event — see
  [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#the-remaining-open-gap-server-ready-signaling).
- **`.cdrca` files get a real icon in Explorer, and now an optional
  branded one in VS Code too**, via the extension's opt-in **CDRCA
  Icons** file icon theme — see
  [extension/README.md#file-icons](./extension/README.md#file-icons)
  for why it's a separate theme you switch to rather than something
  blended into your existing one.
- **The manifest-level plugin permission model (`uses`) and CDRCA's
  in-DSL plugin syntax haven't been fully reconciled** — see
  [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md).
- **Quark (the built-in `@sidebar ...` UI directive plugin) is staged
  into every project but isn't active yet** — it depends on a
  plugin-hook system that exists on CDRCA's GitHub `main` branch but
  hasn't reached the published npm package. Verified directly, not
  assumed — see [docs/QUARK.md](./docs/QUARK.md).

None of these block normal use of `cdrca create app` / `run` / `build
app` day to day — they're the honest list of what's still settling. Run
`cdrca doctor` any time to check your own setup against the things that
can actually go wrong locally (toolchain, login, registry reachability,
local store health).

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the CLI, registry
  API, local package store, and installer fit together; the GitHub-backed
  install model; the local port-patching mechanism and why it exists.
- [docs/MANIFEST-SPEC.md](./docs/MANIFEST-SPEC.md) — the full
  `cdrca.json` contract, every field explained.
- [docs/CLI-COMMANDS.md](./docs/CLI-COMMANDS.md) — every `cdrca`
  subcommand, with examples.
- [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md) — the
  permissions/`uses` model for plugin-type packages.
- [docs/QUARK.md](./docs/QUARK.md) — the built-in `@directive` UI plugin:
  syntax, presets/modifiers, how it's wired in, and its current
  not-active-yet status.
- [docs/LICENSING.md](./docs/LICENSING.md) — this repo's license status,
  and a note on IOSLF, a broader license framework separately published
  by CDRCA's creator.
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) — building from source,
  repo layout, open items.
- [extension/README.md](./extension/README.md) — what the VS Code
  extension does and its requirements.

## License

Licensed under the **MrMIB License v1.0** — see
[LICENSE.md](./LICENSE.md) for the full text. Short version: free to use
and run, including commercially, with credit to MrMIB; no forking or
derivative works without explicit permission; the software itself can't
be resold or repackaged. This covers the tooling in this repo only — the
CDRCA language itself is licensed separately, on its own terms, in
[Ayyan's upstream repo](https://github.com/ISLAH-org/CDRCA). See also
[docs/LICENSING.md](./docs/LICENSING.md) for that distinction and a note
on IOSLF, a broader license framework separately published by CDRCA's
creator.
