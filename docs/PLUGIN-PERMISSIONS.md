# Plugin Permissions & Hooks

Only relevant for **ecosystem** packages with `"type": "plugin"` in their
`cdrca.json` — installed via `cdrca install <name>`, downloaded from
GitHub through the registry. This is CDRCA's real, existing plugin
security model (from CDRCA's own `plugin.js`) — the CLI surfaces it, it
doesn't invent it.

**Not what this page is about:** Quark, the built-in `@sidebar ...` UI
directive plugin, uses this exact same underlying hook mechanism
(`uses: [["syntax","customRule"]]`, `permissions: []`) but ships bundled
with the CLI itself rather than through the registry — no `cdrca.json`
entry, no confirmation prompt below. See [QUARK.md](./QUARK.md).

## Two separate mechanisms

A plugin manifest declares two things, and they control different aspects
of what the plugin can do:

### 1. `permissions` — what the plugin can touch

An array of permission strings. Real values:

| Permission | Access granted |
|---|---|
| `trusted` | Real, unsandboxed `fs`/`child_process` access. |
| `trusted_sys` | Raw, unsandboxed `fs`/`child_process` access at the system level — the most privileged permission. |
| `embedded` | May embed/spawn additional in-process resources. |
| `fileRead` | Sandboxed file read access. |
| `fileWrite` | Sandboxed file write access. |
| `mpdRead` | Sandboxed MPD (project data) read access. |
| `mpdWrite` | Sandboxed MPD (project data) write access. |
| `spawnProcess` | May spawn sandboxed child processes. |

Anything other than `trusted`/`trusted_sys` is permission-gated and
sandboxed — CDRCA's runtime throws if the plugin attempts a call it
wasn't granted. `trusted` and `trusted_sys` bypass the sandbox entirely,
which is why the CLI flags them as **[ELEVATED]** in its confirmation
prompt (see below).

### 2. `uses` — which transpiler hooks it may register for

An array of `[hookType, hookProcess]` pairs — an explicit allowlist of
exactly which CDRCA transpiler pipeline hooks the plugin is allowed to
register for.

CDRCA's real runtime **permanently disables ("seizes") a plugin** the
moment it tries to register a hook outside its declared `uses` list.
There's no warning-then-continue behavior — it's a one-shot enforcement.
This is why the CLI's manifest validation warns at install/publish time
if a plugin declares `permissions` but an empty `uses` list: that plugin
will be seized on its very first hook registration, because it declared
no hooks it's allowed to use at all.

CDRCA's own DSL also has in-language syntax for this same underlying
mechanism — `@requires`, `@syntaxPlugin`, and inline
`plugin myPlugin scope file trusted true { ... }` blocks, with hook names
like `syntax.beforeTokenize`, `ast.visitStatement`, `exec.beforeLoop`.
The manifest-level `uses` array and these in-DSL constructs both describe
the same allowlist concept — **this hasn't been fully reconciled yet**
(see the open item in ARCHITECTURE.md); treat the manifest-level model as
the one the CLI's install-time prompt enforces today.

## The install-time confirmation prompt

Before `cdrca install <plugin>` downloads anything, the CLI:

1. Prints every declared permission, with `[ELEVATED]` next to `trusted`/`trusted_sys`.
2. Prints every declared `(hookType, hookProcess)` pair under "Allowed transpiler hooks".
3. Requires an explicit `y/N` before proceeding — any answer other than `y` cancels the install.

This is deliberately modeled on a mobile OS's app-permission prompt: the
user sees exactly what they're granting before anything is installed, and
nothing installs silently.

Example output:

```
'some-plugin@2.1.0' is a PLUGIN. It requests:

Permissions:
  - Trusted [ELEVATED]: Real, unsandboxed fs/child_process access
  - FileRead: Sandboxed file read access

Allowed transpiler hooks (uses):
  - syntax.beforeTokenize :: myTokenizerHook
  - ast.visitStatement :: myStatementHook

Install this plugin with the permissions above? [y/N]
```
