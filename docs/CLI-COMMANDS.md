# CLI Command Reference

All commands are run as `cdrca <command> [args]`. Run `cdrca --version`
to confirm the CLI is installed and on PATH.

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
[PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md).

```
cdrca install mathcore
cdrca install mathcore@3.1.0
```

**Special case:** `cdrca install cdrca` (i.e. the language runtime
itself, not an ecosystem package) doesn't go through the registry at
all — the runtime is a real npm package, so this installs/updates it via
npm directly into the current project and re-applies the port patch (see
[ARCHITECTURE.md](./ARCHITECTURE.md#port-patching)).

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

## `cdrca outdated`

Compares the current project's lockfile against the registry's latest
versions.

```
cdrca outdated
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
language runtime into the project via `npm install cdrca` and patches it
so the project gets its own stable port (see ARCHITECTURE.md). Name is a
required argument here; there's no interactive prompt in this terminal
path (the VS Code extension's Command Palette version of this *does*
prompt — see `extension/README.md`).

```
cdrca create app my-animation
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
