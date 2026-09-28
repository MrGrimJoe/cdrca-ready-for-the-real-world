# CDRCA language plan — one grammar for every plugin

## ⚠️ ARCHITECTURAL DEBT — UPDATED, READ BEFORE TOUCHING THE GRAMMAR PLUGIN

**Status: v2 syntax is the only syntax users should ever write or see documented, and hand-writing
legacy syntax is now a compile error.** The gap this section used to describe — legacy syntax
still silently compiling if someone hand-wrote it — is closed for the specific shapes listed below.
The DEEPER architectural shortcut underneath it (see "What is still NOT done" below) is unchanged.

**What's done, as of this pass.** `Plugins/grammar/plugin.js` still runs on the `("before", "parse")`
hook exactly as before — recognizing v2 statements and rewriting them to legacy-syntax text, which
then flows through the ORIGINAL, UNCHANGED legacy parsers (`Plugins/quark/plugin.js`,
`Plugins/animations/plugin.js`, `Plugins/cdrca-reactive-state/plugin.js`, `Plugins/ember/plugin.js`,
`Plugins/campfire/plugin.js`, core `Parser.js`/`FullTranspiler.js`) — none of that changed. What's
new is `rejectLegacySyntax()`, called at the exact point where `desugar()` fails to recognize a
statement as v2 and used to silently pass it through untouched. It now throws a real `GrammarError`
(same class as every other syntax mistake) for the specific legacy-only shapes this doc always
called out by name: `@requires`, `@useLib`, `@AddImport` written directly; Quark's dotted
`preset.modifier = value` assignment; `def PROP`/`def ACTION`/`def SPEAKER`; `use ... as`;
`add new action`; bare `fx <id> ...` (no `@`); and legacy `choice ... end choice` (no brace).
`@IMPORT` is deliberately excluded — this doc always said to keep it working, unchanged, and it
still does (see the "Old files keep working" section and its own dedicated tests).

**Why this is safe without touching the legacy parsers.** `desugar()` only ever scans units of the
*original* source text, computed once before any rewriting runs — never its own rewritten output.
A v2 statement's compiled text (`@nav navbar.glass = accent`, `@requires quark`) is written to the
output, not re-scanned, so a human typing that literal legacy text and a rewrite producing it are
never confused for each other, even though they can be byte-identical. This is also why the
equivalence-proof test suite (`equivalence.test.js`'s 1,890+ comparisons, plus similar cases in
`grammar.test.js`/`animations-v2.test.js`) still works: those tests compile hand-written legacy text
*on purpose*, as the oracle for "does v2 produce the same output" — so they pass an internal-only
option, `options.__internalAllowLegacySyntax`, to `transpile()`, which is not reachable from any
`.cdrca` file and has no effect on real project compilation.

**What is still NOT done — the deeper shortcut this doc originally flagged.** The legacy parsers
themselves (the five plugin files plus core `Parser.js`) still fully exist and still accept legacy
syntax when it's the grammar plugin's OWN rewrite output feeding them — that part of the shortcut
is structural, not a gap that could be patched by another regex. Converting the grammar plugin from
a text-rewriting `("before","parse")` hook into a token-level hook that emits the final AST/JS_BLOCK
directly (so legacy text never exists as an intermediate at all, and the legacy parsers' own
acceptance branches could actually be deleted) is still a genuine multi-day rewrite — same reasoning
as before, unchanged by this pass. `rejectLegacySyntax()` closes the *user-facing* gap (hand-typed
legacy syntax no longer silently works) without attempting that rewrite.

**Also deliberately not covered:** `R.store(...)`/`R.query(...)` called directly inside a
hand-written `js { }` block. That block's body is intentionally opaque raw JavaScript to the
grammar plugin; scanning inside it for specific call shapes would mean parsing arbitrary JS by
regex — a different and much riskier kind of guess than any of the fixed-leading-keyword shapes
above. Tracked as a follow-up, not attempted.

**A related, incidental finding from this pass.** Several checked-in docs and two real example
files (`plugins/ember/examples/landing-hero.cdrca`, `plugins/campfire/examples/by-the-lake.cdrca`)
and the project scaffold itself (`cli/src/templates/starter.cdrca`) were still written in legacy
syntax — meaning the "every doc shows v2 exclusively" claim below was true of `SYNTAX.md` and this
design doc, but not of the older per-plugin guides and READMEs, which predated the v2 effort and
were never converted. All of them now compile again under the new guard; see 11e below for the
full list and how it was verified. `ember` and `campfire` were also promoted from optional,
separately-installed plugins to bundled-by-default ones (registered in the runtime's own
`plugins.json`, the same way `cdrca-reactive-state` already was) — a scope change requested
mid-pass, not part of the original legacy-syntax gap.

**Follow-up, still open:** the customRule/AST conversion described above. One direction worth
considering when that's picked up: instead of one central file hardcoding every plugin's v2
grammar (today's `VOCABULARY` table plus per-plugin functions like `animationsDeclaration()`,
`campfireStatement()`, `emberFxRule()` all living in `grammar/plugin.js`), add a second real plugin
hook — alongside `("syntax","customRule")` — that each plugin registers its OWN v2 rules on, the
same way it already owns its own legacy grammar. The grammar plugin (or core parser) would become a
thin dispatcher asking each registered plugin "is this statement yours, and what does it become,"
rather than knowing every plugin's syntax by name. Not started; noted here so the next pass doesn't
have to rediscover it.

---

**Status:** phases P0, P1, P2 and P3 are built and verified (sections 11, 11b, 11c, 11d); the
legacy-syntax guard described above is built and verified (section 11e). Sections 2–10 describe the
target for the remaining phases (P4-P6). Where a phase deliberately differs from what this plan
first said, its own section says so. Section 12 records the decisions (taken as the recommended
defaults).

This extends your proposal (decorate existing HTML, braces for bodies,
`@id capability …` as the only order). Everything in it is kept. Section 1 lists the
seven places I changed or added to it, and why.

---

## 0. The whole language on one page

```txt
// ---- setup ---------------------------------------------------------------
require quark, ember, cdrca-reactive-state, animations, campfire
load quark.core                      // library bundles (was @useLib)
import "story.cdrca"                 // other source files
quark.family = structured           // plugin settings live under their own name

// ---- declarations (hoisted; order does not matter) -----------------------
state clicks = 0
computed label = clicks == 1 ? "1 click" : clicks + " clicks"
store cart persist=local = []
speaker aria name="Aria" color=#ffcc66
object cube = RotatingCube(#3b82f6, 1)
action spin stay=2000ms lerp=500ms { cube.modifyMesh("") }

// ---- rules on existing HTML elements -------------------------------------
@mainNav   navbar glass sticky full-width
@startBtn  button primary pill
@startBtn  click => clicks += 1
@count     bind.text = label
@hero      fx slide-up smooth distance=40px duration=600ms
@page      backdrop "hero-bg.cdrca"  // an animation behind the whole page

// ---- scripted, in-order statements ---------------------------------------
say aria "Sit, if you want." wait=2000ms
```

One statement grammar, four facets:

| Facet | Shape | Examples |
|---|---|---|
| Element rule | `@id word [flags…] ["value"] [opt=value…]` | `@nav navbar glass sticky` |
| Element wiring | `@id path = expr` · `@id event => action` · `@id event { … }` | `@count bind.text = n` |
| Declaration | `keyword [name] [flags…] ["value"] [opt=value…] [= expr] [{ body }]` | `store cart persist=local = []` |
| Directive | `require` · `load` · `import` · `js { }` · `scene "Name" { }` · `path = value` | `scene.background = #0b1020` |

An element rule and a declaration are the same grammar; the `@id` in front is the only
difference (with it, the statement decorates an element; without it, it declares something).

---

## 1. What I changed or added to your proposal

| # | Your proposal | My change | Why |
|---|---|---|---|
| 1 | "The grammar plugin does its own positioned lexing"; tight `width=320px` vs spaced `state x = 0` | **No whitespace sensitivity at all.** Options are recognised by **schema lookup** (`word=` where `word` is a declared option). Declarations put options **before** the `=` value. | Verified: core tokens are `{type, value}` only — no offsets, no whitespace. A plugin cannot see spacing. Schema lookup needs no core change and is unambiguous. |
| 2 | `scene.background = #1a1a2e` | Kept as the scene's **clear colour**. A canvas **behind the page or an element** is a different thing and gets its own capability: `backdrop`. | Two features were about to share the word "background". |
| 3 | No way to say "the whole page" | Reserved target **`@page`** (build error if the HTML also has `id="page"`). | Your requirement: whole page by default, or a div. `@id` alone can only name an element. |
| 4 | Quark's `= #10b981` and `= family:soft` | Named options: `accent=#10b981`, `family=soft`. | `= value` had two meanings inside one plugin. Named options are self-describing and schema-checked. |
| 5 | Campfire `option "x" -> signal` | `option "x" signal=name` | `->` is a sixth punctuation mark; your table says punctuation has one meaning each and plugins can't add more. |
| 6 | `bind.disabled = !can_login` | `!canLogin` | Your own naming rule (own names are camelCase). |
| 7 | "Unknown words are build errors" | Also: errors carry **line and column**, name the **plugin to `require`**, and cross-check **`@id` against the project's HTML**. | Positions turned out not to need core tokens (section 11b); the HTML cross-check needs the project HTML (section 5, phase P2). |

---

## 2. The grammar

### 2.1 Lexical rules
- **Comments:** `//` to end of line, `/* … */`.
- **Vocabulary words** (capabilities, flags, options, keywords): kebab-case — `full-width`, `slide-up`.
- **Your own names** (state, objects, actions, props): camelCase — `canLogin`, `hero2`.
- **Element ids** after `@`: the characters HTML allows, including hyphens — `@hero-banner`.
- **Literals:** strings `"…"` · numbers with units `40px 2rem 50% 500ms 2s 90deg` · colours
  `#rgb #rrggbb #rrggbbaa` (legacy `0xRRGGBB` accepted) · booleans · lists `[a, b]` ·
  objects `{ k: v }` (only where a schema allows).
- **Option values are literals only** (strings, numbers, colours, booleans, schema-declared
  enum words). State reaches an element **only** through `bind`. This removes the
  `password` collision (a state variable called `password` vs the word `password`).
- **Expressions** (after `=`, `=>`, inside `{ }`) are **JavaScript** in v1. No second language.
- A statement ends at a newline. It continues across newlines inside `{ } [ ] ( )`.

### 2.2 Punctuation — one meaning each, plugins cannot add more

| Symbol | Meaning |
|---|---|
| `@` | target an element (`@page` = the whole page) |
| `.` | path (`bind.text`, `scene.background`, `quark.family`) |
| bare word after a capability | flag, looked up in the schema |
| `=` | give a value — `opt=value` for options, `= expr` for a declaration's value |
| `=>` | when this happens, run that |
| `{ }` | body |

### 2.3 Telling the element statements apart
After `@id word`, the next token decides:
- `word.path =` → **wiring** (only `bind` uses a dotted path in the new grammar)
- `word =>` or `word {` where `word` is a DOM event → **event**
- anything else → **capability**

A plugin may not register a capability with the same name as a DOM event (checked at load).

### 2.4 Order of execution
Declarations are hoisted; you never have to think about file order for them.

1. **Registration:** `source`, `store`, `state`, `computed`, `query`, `prop`, `object`, `speaker`
2. **Behaviour:** `watch`, `action`, `scene.*` settings
3. **Element statements:** every `@id …`
4. **Scripted, in source order:** `say`, `choice`, `js { }`

Step 4 is the one exception to "order stops mattering", because dialogue order *is* the meaning.

> **P3 status.** This hoisting is the target for the eventual real grammar (a positioned parser
> that reorders statements before emitting). P3's source-to-source rewrite does not reorder
> anything — `store`/`query`/`source` compile to a `JS { }` block exactly where they are written,
> so **today they run in file order**, same as any other statement (this matches how a
> hand-written `R.store(...)` call in a `JS { }` block already behaved — nothing regressed, but
> nothing was hoisted either). `state`/`computed`/`watch` were already hoisted before P3, by the
> reactive-state plugin's own registration-phase design, independent of this grammar.

### 2.5 Errors
Build errors, not console warnings, with line and column and a did-you-mean:

```txt
main.cdrca:12:11  unknown flag 'glas' for navbar — did you mean 'glass'?
main.cdrca:20:1   'fx' comes from the ember plugin — add `require ember`
main.cdrca:7:1    @heroo: no element with id "heroo" in public/index.html — did you mean "hero"?
```
The last one only works when the project's HTML is known (section 5). Otherwise it is a
warning. Legacy-syntax statements keep their old lenient behaviour.

---

## 3. How plugins plug in

A plugin registers a **vocabulary** at load time. The grammar layer parses and validates
against it, then hands the plugin a normalised call — the plugin's existing runtime is untouched.

```js
pluginAPI.vocabulary({
  plugin: "quark",
  capabilities: [{
    name: "button",
    variants: ["primary", "secondary", "outlined", "solid", "soft", "flat"], // first flag, default primary
    modifiers: ["pill", "sharp", "compact", "full-width", "elevated"],
    options: { accent: "color", family: "enum:structured|soft|bold" },
    parts: [],
    compile: (call) => `Quark.UI.mount(...)`   // call = { id, flags, value, options, pos }
  }],
  settings: [{ path: "quark.family", type: "enum:structured|soft|bold", compile: ... }]
});
```

- **Three kinds of registration:** capabilities (element rules), declaration keywords,
  settings (`plugin.name = value`).
- **Collisions:** two plugins claiming one bare name is a build error listing both. Qualify with a
  path: `@save quark.button primary`. Installing a library can therefore never change what
  an existing file means.
- **Manifest:** no new field. Vocabulary is registered when the plugin loads, so the
  registry contract in `manifest.rs` does not change.

---

## 4. Plugin by plugin

### 4.1 Quark — 27 components

| Group | Components |
|---|---|
| Layout / navigation | `navbar` `sidebar` `tabs` `breadcrumb` `pagination` |
| Content | `card` `badge` `avatar` `alert` `callout` |
| Forms | `button` `input` `textarea` `select` `checkbox` `radio` `toggle` `form` |
| Overlays | `modal` `dropdown` `tooltip` `popover` `toast` `accordion` |
| Status | `progress` `loader` `skeleton` |

Old `@id card.elevated.bordered = #10b981` becomes:

```txt
@profileCard  card elevated bordered accent=#10b981
@myButton     button primary family=soft
@sidebar      sidebar closable edgy
@faq          accordion bordered
@confirmModal modal glass rounded
```

- **Flags:** the first flag is the variant if the component declares variants; the rest are
  modifiers. A component with no variants (`sidebar`) treats every flag as a modifier.
- **Options:** `accent=<color>`, `family=<name>`.
- **Setting:** `quark.family = structured` replaces `Quark.families.setRoot(...)`.
- **Behavioural modifiers** stay behavioural: `closable`, `interactive`, `dismissible`.
- **Required attributes** (`tooltip` → `data-tooltip`, `progress` → `data-progress`) become
  either a build check against the HTML or options: `@help tooltip dark text="More info"`,
  `@bar progress pill value=40`.
- **Strictness:** unknown flag = build error in the new syntax; the old dotted form keeps
  today's console-warning behaviour.
- The authoritative variant/modifier tables are **extracted from the real component registry**
  in phase 1, not typed by hand.

### 4.2 cdrca-reactive-state ✅ (P3 — see section 11d for what was actually built and why the
scope turned out smaller: `state`/`computed`/`watch`/`bind`/events already had this syntax; only
`store`/`query`/`source` were new)

```txt
state count = 0
computed doubled = count * 2
watch count => console.log(count)

store cart persist=local = []                        // was R.store(name, initial, { persist })
store token persist=local ttl=1h = null
source main = firebase({ apiKey: "…" })              // was R.registerSource(name, adapter)
query users from=main cache=60s depends=[searchText] = fetch("/api/users").then(r => r.json())

@countText  bind.text = count
@card       bind.class.active = isActive
@box        bind.style.color = theme
@link       bind.attr.href = profileUrl
@saveBtn    bind.disabled = saving
@panel      bind.show = isOpen
@nameInput  bind.value = name                        // two-way
@todoList   bind.list template=todoItem = todos

@increment  click => count += 1
@form       submit { save(); count = 0 }
```

- `store`, `query` and `source` are **new statements**. Today they exist only as the JS API
  `R.store()` / `R.query()` / `R.registerSource()`; the statements compile to exactly those calls.
  They need the same bundles the JS API needs: `load cdrca-reactive-state.store` and
  `load cdrca-reactive-state.query`.
- **The expression after `=` is passed through verbatim — not rewritten to `R.val(...)` the way a
  `computed` or `bind` expression is.** That rewrite lives in reactive-state's own private,
  tokenized-input machinery; `store`/`query`/`source` wrap the raw JS API 1:1 instead, matching how
  `docs/REACTIVE-STATE.md`'s own examples already write a `dependsOn` fetcher
  (`fetchFiltered(R.get("searchText"))`, not a bare `searchText`). See section 11d.
- **Options come before `=`** (rule 1 in section 1). `store token persist=local ttl=1h = null`.
- Durations are typed: `1h`, `60s`, `500ms`. The JS API still takes milliseconds.
- Bind kinds: `text html value checked disabled show` plus `class.<n>` `style.<p>` `attr.<n>` `list`.
- Events: `click input change submit keydown keyup focus blur`.
- `bind.list … using tmpl` stays valid as legacy.

### 4.3 animations (with what backdrop-plugin was meant to be)

```txt
scene "Bouncing balls" {                    // optional; without it the file is one scene
  object ball = BouncingSphere()            // was: use …exampleProps.BouncingSphereProp() as ball
  object cube = RotatingCube(#ff0000, 1)
  action bounce stay=2000ms lerp=500ms { ball.modifyMesh("") }
  action spin   stay=1500ms lerp=300ms { cube.modifyMesh("") }
  scene.background = #1a1a2e                // was BGcolor = 0x1a1a2e
  scene.gradient   = { data: [...], width: 3 }   // was gredientMap = …
}
prop GlowingOrb abstracts=SphereProp { /* js */ }  // was def PROP GlowingOrb abstracts …
```

**Backdrop** — an animation behind the page or an element, in the same project, no extra plugin:

```txt
@page  backdrop                   // this file's scene behind the whole page
@hero  backdrop                   // this file's scene behind <div id="hero">
@page  backdrop "hero-bg.cdrca"   // hero-bg.cdrca's scene behind the whole page
@hero  backdrop "hero-bg.cdrca"   // …behind #hero
```

- The positional value is another `.cdrca` file, compiled separately into its own program
  that draws into the placed canvas. That is what lets you build a background "from scratch
  in one file" and use it from another where you are also working with Quark.
- **`import` vs `backdrop`:** `import` merges another file's scenes into *this* timeline.
  `backdrop "file"` runs another file's scene *separately*, behind the page.
- `object` names resolve through a small generated table (`RotatingCube` →
  `…exampleProps.RotatingCubeProp`); the long path stays legal.
- `action` is "effects applied while this action's window is active", not sequential steps.
  The docs will say that plainly.
- Candidate settings (not in v1): `scene.fps`, `scene.loop`. Today they are hard-coded `60, true`.

### 4.4 ember — motion presets

```txt
@heroCard   fx slide-up smooth distance=40px duration=600ms
@ctaButton  fx pulse subtle duration=900ms
@title      fx shake strong 400ms
```

- Capability `fx`. First flag is the preset (`bounce shake fade-in fade-out slide-up slide-down
  spin pulse`), later flags are modifiers and easings (`linear smooth back elastic bounce`,
  plus per-preset ones like `strong`, `subtle`).
- Vocabulary is kebab-case; the schema maps `slide-up` → the runtime's `slideUp`.
- The positional value is a duration. `Ember.stagger()` / `Ember.chain()` stay JS in v1.
- The existing `fx heroCard bounce.elastic with {…}` form is accepted as legacy, so ember
  works **unchanged** with no edits to the plugin.

### 4.5 campfire — dialogue

```txt
speaker aria name="Aria" color=#ffcc66
say aria "Didn't think anyone else knew this spot."
say aria "Well. Sit, if you want." wait=2000ms
choice aria "How do you answer?" {
  option "Thanks — mind if I stay a while?" signal=stayFriendly
  option "I was just leaving, actually."    signal=leaveCold
}
```

- `speaker` is a hoisted declaration. `say` and `choice` are **scripted** statements: in
  source order, never hoisted.
- Reacting to a signal stays `Campfire.onSignal("stayFriendly", fn)` in JS in v1. A statement
  form is deferred.
- Legacy `def SPEAKER …`, `say …`, `choice … end choice` are accepted as-is.

### 4.6 Libraries and the registry

- `load plugin.library` replaces `@useLib`. `require a, b` replaces the `@requires` header.
- A library published for a plugin (`providesFor`) registers vocabulary the same way.
- The CLI's `@useLib` staging is reused; only the surface syntax changes.

---

## 5. Project layout and how files find each other

```txt
my-site/
  cdrca.json          { "entry": "src/main.cdrca", "html": "public/index.html" }
  public/index.html   <script src="main.cdrca.js"></script>
  src/main.cdrca
  src/hero-bg.cdrca
  src/story.cdrca
```

- **HTML is project-owned** (git-tracked). `cdrca.json` gains `html` and, for several pages,
  `pages: { "/": {entry, html}, "/about": {…} }`. The top-level `entry`/`html` stays as the
  single-page shorthand, so every existing project keeps working. (v6's `assets` field sits
  next to these.)
- **One main file** uses the rest (`import`, `backdrop "…"`). The HTML links one script.
- **Compiled URL:** `<name>.cdrca.js` is the compiled program for `<name>.cdrca`, identical in
  `cdrca run` and `cdrca build web`, so the HTML never needs rewriting.
- **Path convention** (decision 2): web-style. `"bg.cdrca"` and `"./bg.cdrca"` are relative to
  the file, `"../x"` is the parent, `"/src/bg.cdrca"` is the project root.
  Today's `@IMPORT` is inconsistent: it resolves root-relative paths and `../…`, but a sibling
  (`"bg.cdrca"`) inside a subfolder fails with "Path not found". The new `import` fixes that;
  the legacy `@IMPORT` keeps its behaviour.
- **`cdrca run`** serves the project's own HTML and compiles `*.cdrca.js` on request.
- **`cdrca build web`** (v6) calls the same compile step once per file.

---

## 6. Old files keep working

- Statements the new grammar recognises go through it. Everything else falls through to today's
  parser, byte for byte. Old and new syntax can mix in one file.
- Legacy forms that stay accepted: `def`, `use … as`, `add new action`, `BGcolor =`,
  `gredientMap =`, dotted Quark `@id card.elevated = v`, `@useLib`, `@IMPORT`, `@AddImport`,
  `@requires`, ember `fx …`, campfire `def SPEAKER` / `say` / `choice … end choice`.
- **`cdrca check`** compiles without running and reports errors and (with `--strict`)
  deprecations. **`cdrca migrate`** rewrites old syntax to new; dry-run by default, prints a diff.

| Old | New |
|---|---|
| `@id card.elevated.bordered = #10b981` | `@id card elevated bordered accent=#10b981` |
| `@id x = family:soft` | `@id x … family=soft` |
| `use …BouncingSphereProp() as ball` | `object ball = BouncingSphere()` |
| `add new action a 2000 500` + `def ACTION a ball modifyMesh ""` | `action a stay=2000ms lerp=500ms { ball.modifyMesh("") }` |
| `BGcolor = 0x1a1a2e` | `scene.background = #1a1a2e` |
| `def PROP P abstracts X { … }` | `prop P abstracts=X { … }` |
| `@useLib quark.core` | `load quark.core` |
| `@IMPORT "a.cdrca"` | `import "a.cdrca"` |
| `fx hero slideUp.smooth with {distance: 40}` | `@hero fx slide-up smooth distance=40px` |
| `def SPEAKER a name "A" color 0xffcc66` | `speaker a name="A" color=#ffcc66` |
| `option "x" -> sig` | `option "x" signal=sig` |
| `R.store("cart", [], {persist:"local"})` | `store cart persist=local = []` |

---

## 7. Everything together

`public/index.html`
```html
<body>
  <div id="mainNav"><div class="brand">Acme</div><nav><a href="/">Home</a></nav></div>
  <section id="hero"><h1>Hello</h1><button id="startBtn">Start</button> <span id="count"></span></section>
  <div id="dialogue"></div>
  <script src="main.cdrca.js"></script>
</body>
```

`src/main.cdrca`
```txt
require quark, ember, cdrca-reactive-state, animations, campfire
load quark.core
load quark.components
load ember.core
load ember.presets
load campfire.ui
import "story.cdrca"

quark.family = structured

state clicks = 0
computed label = clicks == 1 ? "1 click" : clicks + " clicks"

@page     backdrop "hero-bg.cdrca"
@mainNav  navbar glass sticky full-width
@hero     card elevated rounded
@startBtn button primary pill
@startBtn click => clicks += 1
@count    bind.text = label
@hero     fx slide-up smooth distance=40px duration=600ms
```

`src/hero-bg.cdrca`
```txt
scene "Drifting cubes" {
  object c1 = RotatingCube(#3b82f6, 1)
  object c2 = RotatingCube(#10b981, 1)
  action spin1 stay=2000ms lerp=500ms { c1.modifyMesh("") }
  action spin2 stay=1500ms lerp=300ms { c2.modifyMesh("") }
  scene.background = #0b1020
}
```

`src/story.cdrca`
```txt
speaker aria name="Aria" color=#ffcc66
say aria "Didn't think anyone else knew this spot."
say aria "Well. Sit, if you want." wait=2000ms
choice aria "How do you answer?" {
  option "Thanks — mind if I stay?" signal=stayFriendly
  option "I was just leaving."       signal=leaveCold
}
```

Five plugins, four files, one `<script>` tag, and no statement needs a second look-up to
know which plugin owns it.

---

## 8. How we will know it works

1. **Corpus test.** Extract every code block from the docs, `examples/`, and each plugin's
   README. Compile all of it with today's parser (baseline), then again with the grammar
   layer installed. Output must be **identical**. This is the "old files still work" proof.
2. **Equivalence test.** `cdrca migrate` every corpus file, compile the result, compare:
   byte-identical output where a form maps 1:1, and behavioural equality in jsdom (DOM
   classes/attributes, reactive counter clicks, ember with a fake clock, backdrop canvas
   placement) where it doesn't.
3. **Error goldens.** One golden file per error class, including did-you-mean and the
   "add `require x`" hint.
4. **Real project test.** Scaffold with the real built CLI, serve it, fetch `*.cdrca.js` over
   HTTP, load the page in jsdom. (Already done for v5; repeated per phase.)
5. **Rust.** `cargo test` including the bundle-completeness tests v7 added.
6. **Side-by-side comparison** of old and new for three tasks (navbar, counter, bouncing
   ball), with line and token counts, for you to try yourself.

---

## 9. Build order

| Phase | Delivers | Done when |
|---|---|---|
| **P0** ✅ (v7) | Bundle, `@IMPORT`, double-`JS_BLOCK` fixes; backdrop runtime and renderer support | See section 11 |
| **P1** ✅ (v7) | Grammar core: schema-driven statement rewriting, legacy pass-through, errors with positions; Quark vocabulary extracted from the real registry; `require`/`load`/`import`/`js` | Corpus test identical; Quark equivalence tests pass — **both met** (section 11) |
| **P2** ✅ | Project layer: `*.cdrca.js` serving, `html`/`pages`, web-style `import` paths | Both met (section 11c). `cdrca check` deferred — not needed for anything built so far. |
| **P3** ✅ | `store` / `query` / `source` statements | Both met (section 11d). `state`/`computed`/`watch`/`bind`/events needed NO work — see below. |
| **P4** | animations forms, `@page`, `backdrop`, prop-name table | Backdrop works in a served page for all four forms |
| **P5** | ember and campfire vocabularies; `quark.family` | Both plugins pass unchanged; new forms equivalent |
| **P6** | `cdrca migrate`; docs and tutorials rewritten around the new syntax (the style guide becomes the spec); migration guide; ember/campfire tutorials if you want them | Every doc example is executed by a test |

P2 comes before the plugin phases on purpose: from then on, every plugin phase is verified in
a real served page rather than in isolated unit tests.

---

## 10. Cut or deferred

Element creation (`@text "Welcome"`), indentation blocks, `if` inside bodies, lambdas,
sequential action steps, ember sequences as statements, campfire `goto`/labels and a
signal-reaction statement, multi-page routing beyond `pages`, `scene.fps`/`scene.loop`,
a language server, type-checking of JS expressions.

---

## 11. Already done in v7 (verified)

- **Bundle completeness.** `animations/plugin.js` was registered in `plugins.json` but missing
  from the CLI's bundle, so `background` failed in every scaffolded project. Fixed, plus three
  Rust tests that fail if a registered plugin, a page `<script>` tag (exact case), or a
  relative `require` is missing from the bundle.
- **`@IMPORT` crash.** 7 of 9 import variants threw "Converting circular structure to JSON".
  Fixed with a cycle-safe clone; all 9 pass; non-import output is byte-identical.
- **Double `JS_BLOCK` emission.** Every JS block was emitted twice, the first time before
  `OAS_OBJ` existed. Measured: a `JS { }` block executed twice, and Quark's mount call appeared
  twice in the output. Reactive-state's click handler happened to be idempotent (one click
  still counted once), which is why it went unnoticed. Fixed; a `JS { }` block now runs once.
- **Page script tag** `parser.js` → `Parser.js` (worked on Windows, 404 elsewhere).
- **Integration test hygiene.** The reactive-state integration test rewrote `plugins.json` in
  whatever tree you pointed it at. It now works on a temp copy.
- **Backdrop runtime** rewritten: whole-page and element placement, stacking-context fix (an
  element with a background colour no longer hides its own backdrop), resize watching,
  adoption by the renderer. 25 front-end tests (11 + 2 + 12), all passing.
- **Renderer** can draw into a placed canvas. Default behaviour untouched.
- **Interim `background` verb** in the animations plugin: `background`, `background <id>`,
  `background from "<file>.cdrca"`, `background <id> from "<file>.cdrca"`. Phase P4 replaces it with
  `@page backdrop` / `@id backdrop`; the verb is unpublished, so no legacy alias is needed. The two forms
  without `from` run end to end today (8 jsdom tests against the real renderer); the two with `from` need P2.
- **Rust:** 70 tests pass, compiled and run here.

Not yet built: project serving, `html`/`pages`, anything from P2 onward. Note that the two
`from "file.cdrca"` forms of the interim verb parse and compile, but cannot run end to end
until the project server exists (P2), because nothing yet serves the compiled program.

---

## 11b. Phase P1 — built and verified

**What exists.** A built-in plugin, `grammar`, registered first in `plugins.json` and bundled by the CLI.
It runs just before parsing, reads the file, and rewrites v2 statements into the legacy statements they stand
for. Everything else in the file is passed through byte for byte.

| v2 | Rewritten to |
|---|---|
| `@nav navbar glass sticky accent=#10b981` | `@nav navbar.glass.sticky = #10b981` |
| `@hero-card card elevated`, `@b button full-width` | the direct `Quark.UI.mount(...)` call (hyphenated names can't go through the legacy tokenizer) |
| `require quark, ember` | `@requires quark, ember` |
| `load quark.components` | `@useLib quark.components` |
| `import "story.cdrca"` | `@IMPORT "story.cdrca"` |
| `js { … }` | `JS { … }` |

**Verification, and what each proves.**

| Check | Result | Proves |
|---|---|---|
| Legacy corpus: every snippet in the docs, examples and all plugin READMEs, compiled with and without the grammar | 106 of 106 identical, including which snippets fail and how | Old files are unaffected |
| Same check under a deliberate mutation (a rewrite that legacy statements reach) | 14 differences caught | The check can actually fail |
| Every Quark component × every variant × every modifier, in v2 and legacy spelling, with and without `accent=` / `family=`, flag order both ways | 1,890 pairs identical across 27 components | v2 means exactly what the legacy spelling means |
| Embedded vocabulary vs the live component registry | equal; test fails on drift | The list can't go stale silently |
| Grammar unit tests (rewrites, untouched cases, scanning edge cases, every error message, line/column) | 86 pass | Behaviour and error quality |
| A freshly scaffolded project, run through the real built CLI: v2 file vs its legacy equivalent, executed against the real Quark front-end in a DOM | resulting page byte-identical, including injected CSS | It works end to end, not just in unit tests |
| Every example in `SYNTAX.md` | compiles (`tools/docs-v2-check.js`) | The doc can't rot |
| `tools/verify-all.sh` | all 10 steps pass | Everything above in one command for CI |

**Bugs found on the way (all fixed, each with a test).**
- A legacy Quark statement with a hyphenated modifier (`@emailInput input.bordered.full-width`, which your own
  `QUARK-SYNTAX.md` documents) was a parse error.
- Quark's files exist in **two** places in the CLI (`templates/plugins/quark/`, staged into projects, and the bundled
  runtime); my fix had reached only one. A new Rust test now fails whenever the two differ.
- The CLI's static library scanner recognised only `@useLib`, so `load quark.components` would have silently never
  staged the library. It now recognises `load` (strictly: the whole line must be `load a.b`).
- My own line-number bookkeeping double-counted newlines for multi-line `js { }` blocks; caught by a test before it shipped.
- The reactive-state integration test rewrote `plugins.json` in whatever tree you pointed it at; it now works on a temp copy.

**Where P1 deliberately differs from what this plan first said.**
1. **No change to the core tokenizer, so decision 6 is moot.** I proposed adding `line`/`col` to core tokens. The grammar
   instead lexes the source text itself, so it has true positions without touching core. It also fixes a tokenizer quirk
   the core has: neighbouring one-letter names merge across whitespace (`x y` tokenizes as `xy`).
2. **A source-to-source rewrite, not a parser change.** Section 3 described plugins registering vocabulary at load time
   through the plugin API. Plugins run in a sandbox and cannot share objects, so P1's vocabulary is generated from the
   registries and embedded (built-ins only). Third-party plugins registering vocabulary (needed for P5: ember,
   campfire) still needs a design; the likely shape is a `vocabulary` file path on the `plugins.json` entry.
3. **`import` still resolves paths like `@IMPORT` does.** Web-style paths are P2.
4. **Element rules cover Quark only.** `bind`, events, `store`/`query`/`source`, animations forms, ember and campfire are
   P3–P5, as planned. *(Update: `store`/`query`/`source` shipped in P3 — as directives, not element rules; `bind` and
   events turned out to need no new work at all, since they already had this syntax. See section 11d.)*

**Not touched, but worth knowing.** A scaffolded project's page loads `quark-components.js` twice (once from the
template's unconditional tags, once from the CLI's staged block). It is the same for `@useLib` and `load`, so it is not
new, and I have not checked whether it causes a problem.

---

## 11c. Phase P2 — built and verified

**What exists.** `cdrca create app` scaffolds a project-owned page (`public/index.html`) and adds
an `html` field to `cdrca.json`. `cdrca run` checks `ProjectLayout::owns_page()`
(`project_layout.rs`) and, when true, installs and starts `project-server.js` — a small,
dependency-free Node server — instead of the original preview server. It compiles `.cdrca` files
on request (`/src/main.cdrca.js`), serves the project's own HTML with the runtime injected, serves
`public/` as static files, and serves `background … from "file.cdrca"` as a compiled ES module at
`/__cdrca/bg/<path>.js`. `import` was moved to web-style path resolution as part of this phase (it
needed to know which file was asking, which only exists once a project is being served).

**Verification.**

| Check | Result | Proves |
|---|---|---|
| Rust unit tests: layout parsing/validation, path rules, `add_html_field`, server installation | 18 new tests (88 total, up from 70 after P1) pass | The Rust-side pieces are correct in isolation |
| Registry-contract test | `html`/`pages`/`assets` load fine but never appear in what `cdrca publish` would send | The project layer can't leak into the registry contract |
| Server tests over real HTTP (a real `http.Server`, real `fetch`) | 35 pass, including path-traversal payloads that resolve to files that actually exist | The server is correct against real requests, not a mock |
| Full page loads in jsdom: the served HTML, then every `<script src>` fetched from the server and run in order, with only WebGL stubbed | scaffold page, whole-page background, element background, two backgrounds with colliding variable names, a broken background left the rest of the page working | It works as a browser would actually experience it |
| Mutation tests (containment check removed; canvas hand-off removed) | both caught, at the HTTP level | The tests can fail, not just pass |
| Real CLI end to end: build the binary, `cdrca create app`, `cdrca run`, `curl` the page and the compiled program, load with `load quark.components` staged | page and program both correct; a project with no `html` field still gets the original preview server | Works through the actual built tool, not just its test suite |
| `tools/verify-all.sh` | 11/11 steps pass | Everything above in one command |

**Bugs found on the way.**
- The `.cdrca` file used as a background compiles with a scene-start line the server has to inject
  the target canvas before; getting the injection point wrong was caught by an ordering test before
  it shipped (docs/guides/PROJECT-LAYOUT.md's "don't nest backgrounds" limit documents the one
  remaining wrinkle: a `background` *inside* a background file is inert, by design, not a bug).
- My first test harness had two bugs of its own (asserting on a total renderer count instead of
  which canvas a renderer used; installing a module loader after the page's own program had already
  called it) — both would have hidden real failures. Fixed before trusting the suite.

**Where P2 deliberately differs from what this plan first said.**
1. **`cdrca check` deferred.** Nothing built through P2 needed a separate check-only command; every
   error already surfaces at compile time (in the browser, or from `cdrca run`'s own validation).
2. **`import` compiles to `@AddImport`, not `@IMPORT`.** Found while building this: a
   header-position `@IMPORT` silently drops anything past the first hop of a three-file chain,
   which a project with real, nested imports would hit immediately. `@AddImport` doesn't have that
   limit. Legacy `@IMPORT` is untouched.
3. **The "page's own program tag" rule.** Not specified in section 5; needed once real pages were
   tried. A page with its own `<script src="….cdrca.js">` is trusted as-is; the server adds the
   runtime before it but never adds a second program.

---

## 11d. Phase P3 — built and verified

**The scope turned out much smaller than planned.** Investigating before building (as with every
phase so far) found that `state`, `computed`, `watch`, `bind` and events **already use exactly the
syntax section 4.2 proposed for them** — `state x = 0`, `@id bind.text = x`,
`@id click => x += 1` are the plugin's existing, legacy syntax, not something to add. The only real
gap was `store`, `query` and `source`: today they exist solely as JS calls
(`R.store()`/`R.query()`/`R.registerSource()`), reached through a hand-written `js { }` block.

**What exists.** Three new directives in the grammar plugin, generic (not Quark-specific) the way
`require`/`load`/`import` already were:

```txt
store  <name> [persist=local|session|memory] [ttl=<duration>] = <expr>
source <name> = <expr>
query  <name> [from=<source>] [cache=<duration>] [depends=[<name>, …]] = <expr>
```

Durations accept a bare number of ms or a suffixed unit (`1h` = `3600000`), both producing
identical output. Each compiles to the JS_BLOCK a human would write by hand, including the
`const R = CDRCA.reactive;` local binding every reactive-state emission uses.

**A load-bearing design finding, not a design choice.** `R.store()` and `R.query()` call
`R.define(name, …)` **internally** and return a plain value / a Promise — not a value a `state`
declaration could wrap. My first draft compiled `store cart = []` to `state cart =
R.store("cart", [])`, which is wrong on two counts: it double-defines the cell (`define()` throws
on a redeclaration) and discards `query`'s Promise. Caught by running the compiled output against
the real runtime, not by reading the API. All three now compile to a side-effecting statement
(`JS { … }`), the same shape as each other.

**A second finding, load-bearing for how you write a fetcher.** `store`/`query`/`source` wrap the
raw JS API 1:1 — they do **not** rewrite bare identifiers to `R.val(...)` the way `computed` and
`bind` do (that rewrite is reactive-state's own `compileExprTokens`, private to its plugin, running
on already-tokenized input; the grammar plugin lexes raw text and is a separate plugin, so it
cannot reuse it, and re-implementing it would add a second, subtly-different expression language).
`docs/REACTIVE-STATE.md`'s own `dependsOn` example already uses `R.get(...)` explicitly for this
reason, so the v2 syntax matches the documented convention rather than deviating from it:

```txt
query filteredUsers depends=[searchText] = fetchFiltered(R.get("searchText"))
```

A bare `searchText` there would reference an undefined JS variable, not the cell — this is called
out explicitly in `docs/SYNTAX.md` so it isn't a surprise.

**Verification.**

| Check | Result | Proves |
|---|---|---|
| Rewrite tests: every option, every duration unit, `from=`'s object-vs-expression rule, every error | 20 pass | The text-to-JS_BLOCK mapping is exact |
| End-to-end, real runtime, real jsdom DOM: store persists and binds; query fetches once, updates a cell, drives a `bind`; a forced refetch re-invokes the SAME fetcher (proves the thunk-wrapping bug above is actually fixed, not just no-longer-visible in the compiled text); `dependsOn` triggers a real re-fetch when the dependency changes; `source` + `query from=` round-trips a config object through a fake adapter | 8 pass (one skips gracefully if run from outside this repo's layout, or without jsdom) | It behaves correctly, not just compiles |
| `docs-v2-check.js`'s extractor, extended to recognise `store`/`source`/`query` | 5 of 5 new-syntax examples in `SYNTAX.md` compile | The doc's own reactive-state examples are real |
| Legacy corpus (all plugins, including ember/campfire/backdrop) | 106/106 identical | Nothing already using `state`/`bind`/events is affected — expected, since none of that changed |
| `tools/verify-all.sh` | 11/11 steps pass | Everything above in one command |

**Bugs found on the way (caught before shipping, not after).**
- The `state name = R.store(...)` / `R.query(...)` wrapping described above — would have thrown
  `"already declared"` for `store` and silently discarded data for `query`.
- The corrected version's `js { }` output was returned in **lowercase**, `js { }`, not `JS { }` —
  the built-in `js` directive gets its case flipped by a separate code path these new directives
  don't go through, so returning lowercase compiled to a literal, non-existent `js` keyword in the
  legacy source and failed with `Unexpected token`. Caught by an actual `transpile()` call, not the
  unit tests (which only checked `desugar()`'s output as a string).
- `query`'s bare-expression form (`query u = fetch(...)`) initially passed the fetcher expression
  through unwrapped, so `R.query()` received an already-*resolved* Promise instead of a function to
  call — `resolveFetcher()` only recognises `typeof === "function"`, so it silently misread the
  Promise as a config object and the fetch never actually ran. Fixed by wrapping in `() => (...)`.
  Caught only by executing the compiled output against the real runtime and checking the fetcher
  was actually invoked — the earlier draft's tests checked compiled *text*, which looked
  plausible, not *behavior*.
- My own test for `dependsOn` initially asserted `true` unconditionally (a stub I meant to come
  back to) — replaced with one that counts real fetcher invocations before and after the dependency
  changes.

---

## 11e. Legacy-syntax guard — built and verified

Closes the user-facing half of the gap the top of this doc describes (see there for what's still
NOT done). `Plugins/grammar/plugin.js` gained `rejectLegacySyntax()`, called exactly where
`desugar()` used to silently pass an unrecognized statement through untouched.

**What's now a compile error when hand-written** (all thrown as a normal `GrammarError`, pointing
at the v2 spelling): `@requires`, `@useLib`, `@AddImport`; Quark's dotted `preset.modifier = value`
assignment (`bind.<path> = …` reactive-state wiring is excluded — `bind` is never a component name);
`def PROP`/`def ACTION`/`def SPEAKER`; `use <name>(...) as <alias>`; `add new action`; bare
`fx <id> ...` (no leading `@`); legacy `choice ... end choice` (no brace). `@IMPORT` is unaffected,
per this doc's existing decision to keep it working.

**Why raw text, safely.** `desugar()` scans units of the original source once, before any
rewriting — never its own output — so a hand-typed legacy statement and a v2 rewrite that happens
to produce identical text are never ambiguous, even though several of these shapes (`@requires`,
`@useLib`, Quark's dotted assignment, `def ACTION`, bare `fx`) are exactly what v2's own
`require`/`load`/`@id ... =`/`action`/`@id fx ...` rewrite TO.

**The test suite's own oracle needed a matching change.** `equivalence.test.js`,
`grammar.test.js` and `animations-v2.test.js` all prove "v2 compiles to the same thing legacy does"
by literally compiling hand-written legacy text as the comparison target — exactly the behavior
just made illegal. Rather than rewrite that methodology, `transpile()` gained one internal-only
option, `__internalAllowLegacySyntax`, which those three files' own `compile()` helpers pass and
nothing else does; it isn't spelled by any `.cdrca` syntax, so it doesn't reopen the gap for a real
project. `grammar.test.js`'s own `UNTOUCHED` fixture list was split in two — forms that still pass
through unchanged (bare dotted mounts, shared state/bind/event syntax, `@IMPORT`) versus forms that
now throw (moved to a new `NOW_A_LEGACY_ERROR` list, each asserted to still round-trip under the
bypass).

**Incidental breakage found and fixed, not just the guard itself.** Turning on the guard surfaced
real legacy syntax that had been silently working in places that matter more than a text fixture:

- `cli/src/templates/starter.cdrca` — the literal scaffold every `cdrca create` gives a new
  project — used `use ... as` / `add new action` / `def ACTION`. Every brand-new project would have
  failed to compile immediately. Converted to `object` / `action`.
- Two real, runnable example files: `plugins/ember/examples/landing-hero.cdrca` (bare `fx`) and
  `plugins/campfire/examples/by-the-lake.cdrca` (`def SPEAKER`, bare `wait 2000`, `end choice`).
  Converted to `@id fx ...` / `speaker` / `wait=...ms` / brace-closed `choice`.
- Two runtime test fixtures that used `use ... as` / `add new action` purely as unrelated scaffolding
  (`tests/background.e2e.test.js`, `tests/project-server.test.js`) — converted to `object`/`action`;
  `project-server.test.js` in particular exercises the real production compile path
  (`project-server.js`), so it needed an actual v2 fixture, not a test-only bypass.
- `README.md`, `docs/QUARK.md`, `docs/PLUGIN-LIBRARIES.md`, `docs/guides/ANIMATIONS-SYNTAX.md`,
  `docs/guides/QUARK-SYNTAX.md`, `docs/guides/PLUGIN-DEVELOPMENT.md`,
  `plugins/ember/README.md`, `plugins/campfire/README.md` — all predate the v2 effort and still
  taught/showed legacy syntax in their code examples (`@useLib` as the canonical name for `load`,
  `use ... as`/`add new action`/`def ACTION` for object/action declarations, dotted-plus-`=`
  assignment, bare `fx`, `def SPEAKER`). Converted block by block; `docs/design/LANGUAGE-PLAN.md`
  and `docs/SYNTAX.md` were the only docs that had actually been kept current.
- `tools/corpus-diff.js`'s own invariant needed correcting, not just its corpus: it asserted "with
  the grammar plugin" and "without it" must compile *identically*, which was true when every doc was
  pure legacy, but is the wrong check once a doc genuinely uses v2 (v2 syntax is SUPPOSED to only
  work with the grammar plugin present). Corrected to: identical result, OR `with` succeeds where
  `without` fails (expected for v2-only content), OR both fail regardless of message (placeholder/
  shape lines like `say <speakerId> "<line>"` that were never meant to compile either way) are all
  fine; only `without` succeeding while `with` now fails, or both succeeding with different output,
  counts as a real regression.
- Scope change requested mid-pass: `ember` and `campfire` were promoted from optional,
  separately-installed plugins to bundled-by-default ones — `plugin.js` copied into
  `Back-end/Transpiler/Plugins/{ember,campfire}/` and registered in the runtime's `plugins.json`,
  matching `cdrca-reactive-state`'s existing bundled pattern exactly (their library bundles —
  `ember-core.js`/`campfire-ui.js`/etc. — still follow the separate `cdrca install`-time staging
  path `plugin_stage.rs` covers; not touched here).

**Verification.**

| Check | Result | Proves |
|---|---|---|
| New tests: every listed shape hand-written now throws, still round-trips under the internal bypass | `grammar.test.js`'s `NOW_A_LEGACY_ERROR` cases pass | The guard fires on exactly the intended shapes, nowhere else |
| Full existing suite (`equivalence.test.js`, `grammar.test.js`, `animations-v2.test.js`, `reactive.test.js`, `vocabulary.test.js`, animations backend/frontend, `plugin-architecture`, `background.e2e`, `project-server`, `cdrca-reactive-state` integration, `docs-v2-check`, vocabulary-generation check) | All green | Nothing else regressed |
| `ember`'s and `campfire`'s own standalone test suites | All green | Bundling them didn't touch their own logic |
| `tools/corpus-diff.js` (corrected invariant) | 94/94 identical, 0 different | Every doc/example in the repo actually compiles, and the guard changes nothing it shouldn't |
| Real compiler, both example `.cdrca` files, plugins loaded only via the runtime's own `plugins.json` (no test-only wiring) | Both compile | The bundled-by-default registration is real, not simulated |

---

## 12. Decisions I need from you

Each has my recommendation; say "defaults" to accept them all.

1. **Whole page target:** reserve `@page`. *(alt: `@body`)*
2. **Path convention:** web-style — relative to the file, `/x` is the project root.
   *(alt: always project-root-relative)*
3. **Compiled URL:** `<name>.cdrca.js`, identical in dev and build.
4. **Plugins may add declaration keywords** (`speaker`, `say`, `choice`), collisions are
   errors, qualify with a path.
5. **Colours:** `#rrggbb` everywhere, legacy `0x…` accepted.
6. **Error positions:** *(resolved in P1 — no core change needed; see section 11b, point 1.)*
   Errors carry a true line and column.
7. **Ship `cdrca migrate` in v1.**

Two smaller ones, low stakes: Quark's unknown-flag strictness (build error in new syntax, lenient
in old), and whether ember/campfire get new-syntax vocabularies now (P5) or stay legacy-only
until you ask.
