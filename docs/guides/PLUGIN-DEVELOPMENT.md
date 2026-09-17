# Building a plugin or library — a walkthrough

This is a hands-on guide to creating your own CDRCA plugin (new `.cdrca`
statement syntax) or library (an optional bundle that extends an
*existing* plugin — yours or someone else's, including the built-in
`quark` and `animations` plugins). For the formal field-by-field spec of
`cdrca.json`, see [MANIFEST-SPEC.md](../MANIFEST-SPEC.md). For the deep
design behind `@useLib` resolution, see
[PLUGIN-LIBRARIES.md](../PLUGIN-LIBRARIES.md). For exactly what each
permission grants, see [PLUGIN-PERMISSIONS.md](../PLUGIN-PERMISSIONS.md).
This page ties those together into the order you'd actually work in.

## Three kinds of package, one command family

| `type` | What it is | You write |
|---|---|---|
| `"package"` | Plain `.cdrca` source someone `add import`s | `.cdrca` files |
| `"plugin"` | New statement syntax, hooked into the transpiler | `plugin.js` (+ optional library bundles) |
| `"library"` | An optional bundle that extends a plugin that already exists | A browser-side JS bundle |

This guide covers the second and third. If you just want to share
reusable `.cdrca` source, you don't need any of this — `cdrca create app`,
write your code, set `type: "package"` in `cdrca.json`, `cdrca publish`.

## Part 1 — writing a plugin

### Scaffold it

```
cdrca create plugin mathcore
```

This does **not** create a runnable project — a plugin has no `cdrca run`
of its own. It writes three things into `./mathcore/`:

- **`cdrca.json`** — already filled in with `type: "plugin"`, `entry:
  "plugin.js"`, and `uses: [["syntax","customRule"]]` matching the hook
  the starter registers for.
- **`icon.png`** — the default CDRCA logo. Replace it before publishing.
- **`plugin.js`** — a starter that already has the one shape that matters
  most gotten right (see below), with a stub `customRule` that matches
  nothing yet — that's for you to write.

### The one shape you must get exactly right

```js
module.exports = function (pluginAPI /*, hostAPI */) {
  pluginAPI.register(0, "syntax", "customRule", myCustomRule);
};
```

CDRCA's real plugin host calls your module's export as
`exported(pluginAPI, hostAPI)` — `pluginAPI` is an object with a
`.register(priority, hookType, hookProcess, callback)` method, **not**
the register function itself. This exact mismatch (calling `pluginAPI(...)`
directly, or treating the first argument as the register function) was a
real bug caught once during Quark's own development — get this wrong and
your plugin fails to load with a `"pluginAPI is not a function"` error.
The scaffold already has it right; don't restructure this part.

`priority` (start at `0`) decides ordering when more than one plugin
hooks the *same* `(hookType, hookProcess)` pair on the same file — lower
runs first. You only need to change it if you know your plugin needs to
run before or after a specific other one.

### Which hooks exist

The full, verified list (checked directly against CDRCA's own source, not
guessed) is in the scaffold's comments and in
[MANIFEST-SPEC.md](../MANIFEST-SPEC.md). The one nearly every plugin
wants is `syntax.customRule` — CDRCA's escape hatch for new statement
syntax, called once per statement its own parser doesn't recognize. It's
the same hook both `quark` and `animations` use for their own directives.

```js
function myCustomRule(currentValue, ctx) {
  // Don't override a node a higher-priority plugin already produced for
  // this statement.
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};

  if (!token) return undefined; // not your statement — let CDRCA try something else

  // ...recognize your syntax, build and return an AST node with at
  // least `newPosition`...
}
```

Return `undefined` for anything that isn't yours — CDRCA falls through to
the next registered plugin, then its own built-in parsing. Return a real
node (with `newPosition`) only when you've actually matched your syntax.

### Declaring `uses` and `permissions` honestly

`cdrca.json`'s `uses` array must list every `(hookType, hookProcess)`
pair you actually call `pluginAPI.register(...)` for — add a hook without
updating `uses` and CDRCA's runtime **permanently seizes your plugin** the
first time it tries to register outside its declared list. Keep the two
in sync as you add functionality, not just at the end.

Same discipline for `permissions` — the scaffold starts with an empty
list on purpose. Add a permission only when real functionality actually
needs it (file access, network, etc.), never speculatively. Every
permission you declare shows up, by name, in the confirmation prompt
anyone sees before installing your plugin — see
[CLI-GUIDE.md](./CLI-GUIDE.md#2-adding-packages-plugins-and-libraries)
for what that prompt looks like from the installing side, and
[PLUGIN-PERMISSIONS.md](../PLUGIN-PERMISSIONS.md) for exactly what each
one grants (some are `[ELEVATED]` — flagged extra prominently for good
reason).

### Testing it before publishing

A plugin has no runtime of its own — you test it against a real host app:

```
cdrca create app test-host
cd test-host
```

Then point that host project's local package resolution at your plugin
directory (before it's ever published, this means wiring your local
store/lock file manually rather than a normal `cdrca install`) and write
a `.cdrca` file that actually exercises your new syntax. Confirm it
transpiles and runs correctly end to end before you publish — the same
standard this repo held Quark's own reference plugin to (a real
integration test transpiling and running a live scene, not just a syntax
check).

### Publishing

```
cdrca login      # once, opens a browser for GitHub OAuth
cdrca publish     # validates cdrca.json, then sends it to the registry
```

Validation runs first — valid semver, `entry` file actually exists, fields
that make sense for `type: "plugin"` — and only then does it publish.
Fix what it prints and run it again if it fails; nothing partial goes out.

## Part 2 — adding a library to your own plugin

If your plugin should offer optional browser-side extras (presets, icon
sets, helpers) that not every user needs loaded, scaffold with `--library`
instead of adding it later by hand:

```
cdrca create plugin mathcore --library curves
```

This adds a fourth file, `mathcore-curves.js`, already wired into
`cdrca.json`'s `libraries` map (`{"curves": "mathcore-curves.js"}`), and
follows the same pattern Quark's own bundles use — an IIFE, no top-level
globals of its own, registering *into* your plugin's existing runtime
namespace rather than declaring a new one:

```js
(function (global) {
  "use strict";
  const MathCore = global.MathCore; // your plugin's own runtime global
  if (!MathCore) {
    console.error("mathcore-curves.js: MathCore's core script must be loaded first.");
    return;
  }
  // register whatever this bundle provides into MathCore's registry
})(typeof window !== "undefined" ? window : this);
```

Replace the `{{PLUGIN_NAME_GLOBAL}}` placeholder with whatever global your
plugin's *own* generated code actually calls into — there's no way to
guess that from the plugin's name alone, so the scaffold leaves it as an
explicit TODO rather than a silent guess.

A user pulls this in with:

```
@useLib mathcore.curves
```

Unlike Quark, CDRCA's manifest schema has no "always load this core
script" concept for a generic plugin. If you need one script to always
load regardless of what else a user opts into, the common pattern is to
name a bundle `"core"` and document that users should add
`@useLib mathcore.core` even if they want nothing else from you.

## Part 3 — publishing a library for someone else's plugin

This is the part that makes the ecosystem actually extensible: you don't
need to be the author of a plugin to extend it. This works today for
`quark`, for `animations`, and for any other published `type: "plugin"`
package — including ones with an author who's never heard of you.

```
cdrca create plugin quark-icons --library icons
```

Then in `quark-icons/cdrca.json`, set:

```json
{
  "type": "library",
  "providesFor": { "plugin": "quark", "library": "icons" }
}
```

`providesFor.plugin` can name a real published `type: "plugin"` package,
or one of this CLI's own built-ins — today, `"quark"` and `"animations"`,
since both ship inside the CLI rather than as a registry package. Publish
it the normal way (`cdrca publish`), and from then on, anyone's

```
@useLib quark.icons
```

resolves to *your* package, without Quark's own author needing to
release anything or even know your library exists. The resolver doesn't
care which of two paths actually serves a given `@useLib` — a plugin's
own first-party bundle, or a third-party `providesFor` package — so
nothing about how a `.cdrca` file writes `@useLib` ever needs to change
either way.

**A concrete example: a library for `animations`.** Unlike Quark,
`animations` doesn't ship any first-party optional bundles of its own yet
— but the door for third-party ones is open right now, the same
mechanism:

```
cdrca create plugin animations-curves --library easing
```

```json
{
  "type": "library",
  "providesFor": { "plugin": "animations", "library": "easing" }
}
```

Publish it, and `@useLib animations.easing` works for anyone, immediately
— no changes needed anywhere else in this repo or CDRCA itself.

## Checklist before you publish anything

- [ ] `uses` in `cdrca.json` matches every `pluginAPI.register(...)` call,
      exactly
- [ ] `permissions` lists only what you actually need, and nothing you
      added "just in case"
- [ ] Replaced the default icon with your own
- [ ] Tested against a real host app project — a real transpile and run,
      not just "it parses"
- [ ] If this is a library, `providesFor.plugin`/`providesFor.library`
      match what you intend users to type after `@useLib`
- [ ] `cdrca.json`'s `version` follows semver, and you've actually
      bumped it if this is an update to something already published

## Where to go next

- Formal manifest field reference: [MANIFEST-SPEC.md](../MANIFEST-SPEC.md)
- Full `@useLib` resolution design: [PLUGIN-LIBRARIES.md](../PLUGIN-LIBRARIES.md)
- What each permission actually grants: [PLUGIN-PERMISSIONS.md](../PLUGIN-PERMISSIONS.md)
- How the CLI commands you used here work in full: [CLI-GUIDE.md](./CLI-GUIDE.md)
