# Architecture

## The pieces, at a glance

```
                    ┌─────────────────────────┐
                    │   Registry website        │
                    │   (built separately,      │
                    │    Google AI Studio)      │
                    │                            │
                    │  GET  /api/packages/:name  │
                    │  GET  /api/packages/:n/:v  │
                    │  GET  /api/search          │
                    │  POST /api/packages        │
                    │  POST /api/.../releases    │
                    │  GET  /api/auth/github/... │
                    └─────────────┬──────────────┘
                                  │ HTTP (fixed API contract)
                                  ▼
┌──────────────┐        ┌──────────────────┐        ┌────────────────────┐
│  GitHub       │◄───────│   cdrca CLI       │───────►│  Local package      │
│  (release     │download│   (cli/, Rust)    │        │  store + lockfile   │
│  assets, npm  │        │                   │        │  %LOCALAPPDATA%\   │
│  for the      │        │  search/info/     │        │  CDRCA\             │
│  language     │        │  install/publish/ │        └────────────────────┘
│  itself)      │        │  create/build/run │
└──────────────┘        └─────────┬─────────┘
                                  │ spawns / wraps
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             ┌───────────┐ ┌───────────┐ ┌──────────────┐
             │  Tauri     │ │  node     │ │  VS Code      │
             │  build     │ │  (runs    │ │  extension    │
             │  pipeline  │ │  CDRCA's  │ │  (extension/) │
             │  (`build   │ │  server)  │ │  spawns the   │
             │  app`)     │ │           │ │  same CLI     │
             └───────────┘ └───────────┘ └──────────────┘
```

Everything in this repo (`cli/`, `extension/`, `installer/`) is
**tooling for CDRCA**, not CDRCA itself. The CDRCA language (the actual
DSL, transpiler, and server) lives in Muhammad Ayyan's separate repo —
this repo never modifies that upstream source; it only installs and
patches a *local, per-project copy* of it (see
[Port patching](#port-patching) below).

## The GitHub-backed install model

The custom package manager (`cdrca search`/`info`/`install`/`update`/
`publish`) deliberately never shells out to or depends on npm anywhere in
its resolve/download/cache pipeline. The flow:

1. `cdrca install <name>[@version]` calls the registry API
   (`GET /api/packages/:name` or `/:name/:version`) to resolve which
   version to install and get a `githubReleaseAssetUrl`.
2. The CLI downloads that asset **directly from GitHub** — not through
   npm, not through any package manager wrapper.
3. The download is verified against a checksum the registry provided,
   then extracted into a local, content-addressed store under
   `%LOCALAPPDATA%\CDRCA\store\<name>\<version>\`.
4. Installs are transactional: download → verify → extract to a temp
   directory → atomic rename into the store. A failed or interrupted
   install can never leave a half-installed package behind.
5. The project's `cdrca-lock.json` records exactly what was resolved
   (version, resolved URL, integrity hash, dependencies) for reproducible
   installs elsewhere.

Dependency version constraints (`^1.2.3`, `>=2.0.0`, exact pins) are
resolved via the `semver` crate against the registry's reported version
list — see `cli/src/resolve.rs`.

**One exception to "never npm":** the CDRCA *language runtime itself* is
a real npm package (it isn't distributed through the ecosystem registry
the same way libraries/plugins/apps are, and it has no `bin` field). So
`cdrca create app` and `cdrca install cdrca` do call `npm install`
specifically to pull the runtime into a project's own `node_modules` —
this is intentionally separate from, and doesn't touch, the
GitHub-backed pipeline above.

## Port patching

**The problem:** CDRCA's real server
(`Back-end/Servers/main/index.js`) hardcodes `const PORT = 3000;` with
no configurability. Verified directly against the actual source. This
means:

- A `CDRCA_PORT` env var, if you tried to set one, is silently ignored.
- Two CDRCA projects can never run at the same time — the second one
  fails to bind `:3000`.

**Why not just ask for an upstream fix:** deliberately not pursued —
avoids needing Ayyan's involvement in this tooling project at all.

**Why not a singleton shared server instead:** rejected — it would need
an equivalent code change anyway (to make CDRCA multi-project-aware
internally), without the benefit of genuinely independent, simultaneous
projects.

**The actual fix — patch the local copy, per project:** exactly like a
tool such as `patch-package`, `cli/src/patch.rs` rewrites *this
project's own* `node_modules/cdrca/Back-end/Servers/main/index.js` right
after `npm install cdrca` completes:

```
const PORT = 3000;
```
becomes
```
const PORT = process.env.CDRCA_PORT || 3000;
```

This is:
- **Local only** — it touches a project's own `node_modules`, never
  Ayyan's GitHub repo, never a shared/global CDRCA install.
- **Idempotent** — if the line's already patched (checked by searching
  for `process.env.CDRCA_PORT`), the patch step is skipped rather than
  double-patching or failing.
- **Loud on failure, not silent** — if a future CDRCA version changes
  that exact line (upstream refactor, or CDRCA adding its own port
  config), the patch can't find what it expects and prints an unmissable
  warning rather than pretending it worked. The project falls back to
  CDRCA's hardcoded 3000, and `cdrca run`/`cdrca build app` both warn
  about this every time until it's fixed.

**Where the port itself lives:** assigned once, at `cdrca create app` /
`cdrca install cdrca` time (bind `:0`, read back the OS-assigned port,
release it), and persisted in `.cdrca-state.json` at the project root —
deliberately **not** part of `cdrca.json` (see
[MANIFEST-SPEC.md](./MANIFEST-SPEC.md#whats-not-in-this-file), since
that's a fixed cross-team contract). `.cdrca-state.json` is gitignored by
default. `cdrca run` and `cdrca build app` both read this same stored
port rather than renegotiating one on every invocation, which is what
makes the patch meaningful in the first place — the port has to be
*stable* for a project, not re-randomized each run.

## Bundled CDRCA runtime fallback

The published npm `cdrca` package is missing more than just Quark support
— it's missing the entire plugin-hook subsystem
(`Back-end/Transpiler/plugin.js`, the `pluginAPI` wiring in `Parser.js`)
that Quark and any future built-in plugin depend on, even though that
subsystem exists on CDRCA's GitHub `main` branch under the same version
number. Verified directly, not assumed: installing the real package and
running an `@id ...` directive through its actual `transpile()` throws
`Unexpected token`.

A missing subsystem isn't something the line-level find-and-replace style
of `patch.rs`/`quark_patch.rs` can restore — there's no existing line to
rewrite. So `cli/src/cdrca_bundle.rs` bundles a complete, fixed copy of
CDRCA directly into the CLI binary (`include_str!`, same pattern as
Quark's own files) and `cli/src/commands/install.rs`'s
`ensure_working_runtime()` installs it in place of the broken npm copy
whenever `node_modules/cdrca/Back-end/Transpiler/plugin.js` is missing
after `npm install cdrca` runs. This bundled copy also carries the fix
for a second, deeper bug found by actually running CDRCA's real
transpiler end-to-end (not by reading source): `FullTranspiler.js` was
silently dropping every `JS_BLOCK` statement — what every Quark directive
compiles to — from final output, with no error. See
`cli/src/cdrca_bundle.rs`'s own module docs for the full verification
trail, and for what's deliberately excluded (the ~100MB Monaco-based
visual editor, since a CLI-driven `.cdrca` build/run doesn't need the
browser IDE).

This runs automatically as part of `cdrca create app` and
`cdrca install cdrca` — no separate command, no extra confirmation
prompt, since it's fixing a broken dependency rather than installing new
capability the user needs to approve.

## Quark UI directive patching

Same category of local, per-project patch as port patching above, applied
right after it in `cdrca create app` / `cdrca install cdrca` — but staging
a *built-in* component layer (`quark`) into a project's `node_modules/cdrca`
copy rather than rewriting an existing line. Quark lets `.cdrca` files apply
prebuilt UI components to real DOM elements with a one-line directive
(`@mainNav navbar.glass`, `@sidebar sidebar.closable.edgy = value`) instead
of hand-coding them. Full syntax, the target/component/variant/modifier
model, and the full component reference are in [QUARK.md](./QUARK.md) —
this section is just where it sits in the overall install flow and why.

**Why built-in rather than an ecosystem plugin:** distributing it through
the registry (like any other `type: "plugin"` package — see
[PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md)) would mean a
`cdrca.json` dependency entry, an install-time `y/N` confirmation prompt,
and depending on the registry being reachable. None of that fits a
component library meant to be available in every project by default —
so `cli/src/quark_patch.rs` bundles Quark's files directly into the
compiled CLI binary (`include_str!`) and writes them out itself, the same
way the installer bundles the Rust toolchain rather than fetching it
per-project.

**Two separate patch steps, not one:** `quark_patch::patch_quark()` handles
the *server-side* piece — staging `plugin.js` (the only Quark file that
actually runs in Node; CDRCA's own `Back-end/Transpiler/plugin.js`
`require()`s it directly) and merging the `"quark"` entry into
`plugins.json`. `quark_patch::scan_and_patch_quark_frontend()` handles the
*browser-side* piece — it's what actually loads `Quark`/`Quark.UI` into
the page CDRCA's `Front-end/index.js` `eval()`s generated code into,
since staging files alone doesn't make a project's `node_modules/cdrca`
copy actually reference them. This function first runs
`cli/src/quark_libscan.rs`, a plain text scan across the project's
`.cdrca` files for `@useLib <plugin>.<library>` directives, then writes a
managed, fully-replaced `<!-- QUARK:START -->...<!-- QUARK:END -->` block
into `Front-end/index.html` containing a persistent `#quarkRoot` div plus
only the `<script>` tags for libraries actually referenced (`quark-core.js`
and `quark-ui.js` are always included — they're Quark's required engine
and compatibility shim, not optional). See
[PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md) for why library selection has
to be resolved this way (statically, ahead of page load) rather than at
runtime — the short version is that a `.cdrca` file's entire generated
output runs inside one synchronous `eval()`, with no natural pause point
to inject a script tag mid-script.

**Current important caveat, verified directly (not assumed):** installing
the real npm `cdrca` package and running an `@id ...` directive through
its actual transpiler throws `Unexpected token at position 0: @`. The
plugin-hook system Quark depends on
(`Back-end/Transpiler/plugin.js`, `pluginAPI` wired into `Parser.js`)
exists on CDRCA's GitHub `main` branch but is **not in the currently
published npm package**, even though the version string matches. The
patch stages Quark's files and `plugins.json` entry regardless (harmless
— they just sit inert until a project's CDRCA copy catches up), but
reports `QuarkPatchOutcome::PluginSystemNotPresent` rather than a plain
success, and `cdrca doctor` surfaces the same thing. See
[QUARK.md](./QUARK.md) for the up-to-date status.

## Making ANY plugin actually work: four bugs beyond Quark itself

Verifying Quark end-to-end (see above) surfaced bugs in CDRCA's plugin
system generally — not specific to Quark, and not specific to any one
plugin. Building a second real plugin
([`cdrca-reactive-state`](../plugins/cdrca-reactive-state), see
[REACTIVE-STATE.md](./REACTIVE-STATE.md)) as an independent check
against the same source surfaced three more. Each was reproduced
directly against this repo's actual CDRCA source (bundled copy and/or
a project's separately-installed `node_modules/cdrca` copy) before
being patched — full repro + fix for every one of these lives in
REACTIVE-STATE.md's "Verified bugs" section, including one candidate
bug from that investigation that turned out **not** to apply here once
checked directly, called out rather than silently dropped.

Same two-tier structure as the port patch and Quark patch above:

1. This CLI's own bundled fallback copy of CDRCA
   (`cli/src/templates/cdrca-runtime/...`) has three of these fixed
   directly at the source — `FullTranspiler.js` (JS_BLOCK dropped from
   output), `Parser.js` (token-joining corruption), and
   `Partial_transpiler.js` (missing JS_BLOCK semicolon). Since the
   published npm package currently lacks the plugin-hook system
   entirely (see the Quark caveat above), this bundled copy is what
   every project actually runs today — these three fixes are already
   live for everyone, with no separate patch step needed.
2. `cli/src/fulltranspiler_patch.rs`, `cli/src/parser_spacing_patch.rs`,
   and `cli/src/js_block_semicolon_patch.rs` apply the identical fixes
   to a project's separately-installed `node_modules/cdrca` copy —
   forward-looking protection for whenever the published npm package
   catches up and includes the plugin-hook system but not yet these
   fixes, same reasoning as the port patch's local rewrite. Each is
   idempotent and reports loudly (never a silent no-op) if the expected
   code shape isn't found. Run from `create.rs` and `install.rs`
   alongside the port/Quark patches.
3. `cli/src/plugin_stage.rs` is a different kind of gap: `cdrca install
   <plugin>` downloaded a package, verified its checksum, and recorded
   it in the lockfile — but never copied its entry file into
   `Plugins/<name>/plugin.js` or added a `plugins.json` entry, so an
   installed plugin's hooks never actually loaded. Fixed generically
   (not Quark-specific — Quark ships built into the CLI and is staged
   by `quark_patch.rs` instead, since it never goes through the
   registry download path at all).

A fourth candidate bug from the same investigation — a claimed
mismatch between how `plugin.js`'s `initializePlugin` calls a loaded
plugin's `module.exports` and the calling convention Quark's own
template uses — was checked directly against this repo's actual
`Back-end/Transpiler/plugin.js` and found to already be consistent
(both sides agree on `module.exports = function (pluginAPI) {
pluginAPI.register(...) }`). No Rust patch module exists for it because
there's nothing to patch here; see REACTIVE-STATE.md for why, in case
this gets re-investigated later against a different CDRCA checkout.

## The remaining open gap: server-ready signaling

Separate from the port issue: `Servers.main.init()` still has no clean
"boot and signal ready" event — no health endpoint, no ready log line
that's been confirmed. `cdrca build app`'s generated Tauri config and the
VS Code extension's run button both currently work around this by
**polling** the (now-known, patched) port until it accepts a connection,
rather than waiting for an actual readiness signal from CDRCA itself.
This is a known, flagged limitation — not something silently assumed
away.

## Authentication

`cdrca login` opens a browser to the registry's GitHub OAuth entry point
with a `redirect_port` and a randomly generated `state` value, and spins
up a local callback listener on that port. The callback is rejected
outright if the returned `state` doesn't match exactly — this exists
specifically to prevent token injection (without it, *any* connection to
the local port, not just the real GitHub redirect, could hand the CLI an
attacker-supplied token). The token itself is stored via Windows
Credential Manager (the `keyring` crate), not a plaintext file.

**Note:** the exact registry-side contract for this flow
(`redirect_port`/`state` param names, callback shape) is documented as
an assumption pending confirmation in `cli/OAUTH-CONTRACT-TODO.md` — not
yet verified against what the registry team actually implemented.

## VS Code extension bundling

The extension (`extension/`) is not published to the VS Code
Marketplace — it's built into a `.vsix` at CI time
(`.github/workflows/release.yml`, via `vsce package`) and offered as an
optional, selectable component in the Inno Setup installer
(`installer/cdrca-installer.iss`).

- VS Code's presence is detected by checking its real uninstall registry
  key (`...\Uninstall\Microsoft Visual Studio Code`) across all four
  possible locations: `HKLM`/`HKCU` × 32-bit/64-bit registry view, since
  VS Code commonly installs per-user rather than system-wide.
- If found, the component is **pre-checked but never hidden** — the
  option stays visible and selectable either way, in case someone
  installs VS Code afterward.
- If selected, the installer runs
  `<VS Code install location>\bin\code.cmd --install-extension <path-to-vsix>`
  silently.
- If selected but VS Code genuinely isn't found at actual install time,
  the installer doesn't fail — it shows a message with the exact manual
  install command and the `.vsix`'s permanent on-disk location
  (`{app}\extension\cdrca-extension.vsix`).

See `extension/README.md` for what the extension itself does once
installed.
