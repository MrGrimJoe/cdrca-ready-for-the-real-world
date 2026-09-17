# CLI Command Reference

All commands are run as `cdrca <command> [args]`. Run `cdrca --version`
to confirm the CLI is installed and on PATH.

> **`cdrca12 docs <topic>`** (npm install only) isn't listed below — it's
> not a real subcommand of this binary, it's an `npm/bin/cdrca.js`
> wrapper convenience that fetches a guide from
> [docs/guides/](./guides/) live and prints it, intercepted before the
> binary is ever spawned. It doesn't exist if you installed via the
> Windows installer or Linux installer script. See
> [npm/docs/README.md](../npm/docs/README.md).

## `cdrca login`

Logs in via GitHub OAuth. Opens your browser to the registry's login
flow, then a local ephemeral-port callback listener receives the token.
Protected against token injection with a per-attempt random `state` value
— the callback is rejected if `state` doesn't match exactly.

```
cdrca login
```

Token is stored via Windows Credential Manager, not a plaintext file. See
[ARCHITECTURE.md](./ARCHITECTURE.md#authentication) for the full flow,
and `cli/OAUTH-CONTRACT-TODO.md` for the exact wire contract with the
registry that still needs sign-off.

## `cdrca logout`

Clears the stored token.

```
cdrca logout
```

## `cdrca search <query>`

Searches the registry.

```
cdrca search animation
```

## `cdrca info <package>`

Shows manifest details for a package. For `type: "plugin"` packages,
permissions and `uses` hooks are printed prominently.

```
cdrca info calculastic
```

## `cdrca install <package>[@version]`

Resolves via the registry, downloads the release asset directly from
GitHub (never via npm), verifies its checksum, extracts it into the
local package store, and updates the project's `cdrca-lock.json`. For
plugin packages, shows the permission confirmation prompt first — see
[PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md). Then, depending on
`type`:

- **`"plugin"`** — stages the entry file into `Plugins/<name>/plugin.js`
  (plus any declared `libraries` bundles alongside it) and adds it to
  `plugins.json`, so its hooks are actually active immediately.
- **`"package"`** — stages its `.cdrca` source tree into
  `cdrca_packages/<name>/` in this project.
- **`"library"`** — stages its bundle and adds it to `libraries.json`,
  the index `@useLib`/`providesFor` resolution reads from.

Every install also re-scans this project's `.cdrca` source for `@useLib`
directives and re-patches `Front-end/index.html` accordingly — installing
a library package or a plugin with its own bundled libraries can resolve
a reference that was previously unresolved. See
[ARCHITECTURE.md](./ARCHITECTURE.md#making-any-plugin-actually-work-four-bugs-beyond-quark-itself)
and [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md) — this staging step
used to be missing entirely for every one of these three types.

```
cdrca install mathcore
cdrca install mathcore@3.1.0
```

**Special case:** `cdrca install cdrca` (i.e. the language runtime
itself, not an ecosystem package) doesn't go through the registry at
all — the runtime is a real npm package, so this installs/updates it via
npm directly into the current project, re-applies the port patch (see
[ARCHITECTURE.md](./ARCHITECTURE.md#port-patching)), re-stages Quark,
the built-in UI directive plugin (see
[ARCHITECTURE.md](./ARCHITECTURE.md#quark-ui-directive-patching) and
[QUARK.md](./QUARK.md)), and re-applies the three patches every plugin
(built-in or ecosystem) depends on (see
[ARCHITECTURE.md](./ARCHITECTURE.md#making-any-plugin-actually-work-four-bugs-beyond-quark-itself)).

```
cdrca install cdrca@latest
```

## `cdrca update [package]`

Updates one package, or every package in the current project's lockfile
if no name is given.

```
cdrca update
cdrca update mathcore
```

## `cdrca remove <package>`

Removes a package from the local store and the project's lockfile.

```
cdrca remove mathcore
```

## `cdrca list`

Lists every package installed in the local store (`%LOCALAPPDATA%\CDRCA\store\`).

```
cdrca list
```

Add `--json` for machine-readable output (e.g. for scripting or editor
integrations):

```
cdrca list --json
```

## `cdrca outdated`

Compares the current project's lockfile against the registry's latest
versions.

```
cdrca outdated
```

Add `--json` for machine-readable output:

```
cdrca outdated --json
```

## `cdrca publish`

Validates the current project's `cdrca.json` (required fields, valid
semver, `entry` file actually exists) and, if valid, POSTs a new release
to the registry using the stored login token. Requires `cdrca login`
first.

```
cdrca publish
```

## `cdrca create app <name>`

Scaffolds a full CDRCA app project in a new `<name>/` directory:
`cdrca.json`, a `.gitignore` (excludes `node_modules/`,
`.cdrca-state.json`, `.cdrca-build/`), the default CDRCA logo as its icon, a starter
`.cdrca` scene file, and — critically — actually installs the CDRCA
language runtime into the project via `npm install cdrca`, patches it so
the project gets its own stable port, and stages Quark, the built-in
UI component directive layer (see ARCHITECTURE.md and
[QUARK.md](./QUARK.md) — Quark is staged but may not be active yet
depending on your CDRCA copy's version, see the warning it prints). Name
is a required argument here; there's no interactive prompt in this
terminal path (the VS Code extension's Command Palette version of this
*does* prompt — see `extension/README.md`).

```
cdrca create app my-animation
```

## `cdrca create plugin <name> [--library <libraryName>]`

Scaffolds a new transpiler plugin package in a new `<name>/` directory:
`cdrca.json` (`type: "plugin"`, `permissions: []`, `uses:
[["syntax","customRule"]]`), the default CDRCA logo as its icon, and a
starter `plugin.js` with the correct
`module.exports = function (pluginAPI) { pluginAPI.register(...) }`
shape already right, a stub `("syntax","customRule")` hook, and a
comment listing every verified `(hookType, hookProcess)` pair CDRCA's
real transpiler actually supports (see
[PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md)).

With `--library <libraryName>`, also scaffolds a stub opt-in browser-side
bundle (`<name>-<libraryName>.js`, following Quark's own library-bundle
pattern — IIFE, guard-checks its target namespace exists) and a matching
`libraries` manifest entry — see
[PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md).

Unlike `cdrca create app`, this does NOT run `npm install cdrca`,
port-patch, or stage Quark — a plugin package has no runtime of its own
to launch. Test it against a real host project (`cdrca create app
<name>` elsewhere, `cdrca install <this-plugin>` once published, or by
pointing that project's local package store at this directory manually
during development) before `cdrca publish`.

```
cdrca create plugin mathcore
cdrca create plugin mathcore --library icons
```

## `cdrca run`

Launches the current project's CDRCA server directly (never via
npm/npx), using the port baked in at create/install time. Prints
`CDRCA_PORT=<port>` on stdout so callers like the VS Code extension's run
button can read it back rather than guessing or hardcoding a port.

```
cdrca run
```

## `cdrca build app`

Packages the current project into a distributable Windows `.exe` via
Tauri. Generates `tauri.conf.json` from `cdrca.json` automatically (title,
icon — falling back to the bundled default CDRCA logo if the project's own icon is missing or
unresolvable — and the project's baked-in port), so the user never
hand-writes Tauri config.

```
cdrca build app
```

Output lands under `target/release/bundle/` inside the project.

## `cdrca doctor`

Runs a read-only diagnostic sweep of your local environment: cdrca CLI
version, Rust toolchain, Tauri CLI (needed for `cdrca build app`),
whether you're logged in, whether the registry is reachable, local
package store health (including leftover `.tmp-*` dirs from an
interrupted install), and whether VS Code plus the CDRCA extension are
detected. If run inside a project directory, it also reports the
project's assigned port and whether the port patch was applied
successfully (see
[ARCHITECTURE.md](./ARCHITECTURE.md#port-patching)).

```
cdrca doctor
```

Every check is independent and best-effort — one failing check never
stops the rest from running. Nothing here modifies your environment;
it only reports on it. Exits with a summary count of items that may
need attention, or "Everything checks out." if there's nothing to flag.
