# Syntax style guide

A rule going forward, not a retrofit. `animations`' and `quark`'s
already-published surface (`add new action`, `@id thing.chain = value`,
etc.) stays exactly as it is — load-bearing, not worth breaking. This
guide governs new statements added to existing plugins (like
`background` in `animations`) and any new plugin from here on.

## Why this exists

Laid out side by side, the language had picked up three different
conventions with no rule connecting them:

| Plugin | Shape | Example |
|---|---|---|
| `animations` | bare verb-first | `use X(...) as ball`, `add new action bounce1 2000 500` |
| `animations` | bare assignment | `BGcolor = 0x1a1a2e` |
| `quark` | `@`-prefixed, dot-chain | `@sidebar sidebar.closable.edgy = #2563eb` |
| `cdrca-reactive-state` | bare verb-first | `state count = 0`, `watch count => ...` |
| `cdrca-reactive-state` | `@`-prefixed | `@id bind:value = ...` |
| `ember` | bare verb-first, dot-chain, `with` | `fx heroCard bounce.elastic with { duration: 400 }` |

Three real inconsistencies: `@` vs. bare keyword for "target an element"
wasn't a clean split (`cdrca-reactive-state` used both, for different
halves of its own feature set); parameter-passing had no rule at all
(`=`, `with {...}`, plain trailing positional args, all with no logic
connecting them); and `def <NOUN>` (animations' `def ACTION`/`def PROP`)
was a reasonable pattern nobody had actually written down, so the next
plugin author had no way to know to follow it.

## The two shapes

**Targeting an existing DOM element** — reserved for `@`:

```
@id thing.chain = value
```

Quark and `cdrca-reactive-state`'s bindings already agree on this; it's
official now, not just convention. `value` is always a single scalar —
if a directive genuinely needs more than one field of configuration,
that's a sign it should be two directives, not one directive with a
structured value crammed into `=`.

**Declaring, triggering, or defining something** that isn't targeting a
DOM element — bare keyword, verb first:

```
verb target [.modifier.modifier...] [preposition value]
```

```
fx heroCard bounce.elastic with { duration: 400 }
background heroSection from "./bg.js"
say hero "line" wait 1500
def SPEAKER hero name "Aria" color 0xffcc66
```

The bracketed parts are genuinely optional and chosen per-statement —
this is the part worth being precise about, because "always use `with
{}`" would be the wrong takeaway and would make some of the language's
own existing statements worse, not more consistent:

- **A single simple value** reads better with a natural English
  preposition than jammed into an object — `from "path"`, `wait 1500`,
  `as ball`. Don't wrap a single scalar in `with {}` just for
  consistency's sake; `background heroSection with { from: "./bg.js" }`
  is worse than `background heroSection from "./bg.js"`, not better.
- **More than one field, or anything structured**, is what `with {}` is
  actually for — `fx heroCard shake.strong with { duration: 400 }` has
  two logically independent knobs (the modifier chain and the duration);
  cramming `duration` into a second bare trailing argument the way
  `add new action name stayTime lerpTime` does gets unreadable past two
  positional numbers, which is exactly the failure mode `with {}` fixes.
- **`def <NOUN> ...`** is the pattern for declaring a new named thing
  (a prop, an action, a speaker) — now written down, not implicit.
  `def <NOUN> <name> ...` — the second token disambiguates which kind of
  thing is being declared, the same way `def SPEAKER`/`def ACTION`/
  `def PROP` already coexist correctly in one token stream today.

## What never varies

- **`=`** only ever appears after an `@id thing.chain` — never in a bare
  verb-first statement.
- Every customRule handler declines (`return undefined`) immediately
  when the leading keyword or the token right after `def` isn't its
  own, before consuming anything — this is what lets `def SPEAKER`,
  `def ACTION`, and `def PROP` share one token stream safely, and what
  any next plugin adding its own `def <NOUN>` needs to keep doing.
- Classify every token by the shape of `.value`, never by `.type` — see
  any plugin's own `plugin.js` header comment for the specific,
  verified tokenizer bug this defends against.

## Checklist for a new statement

- [ ] Targeting a DOM element? Use `@id thing.chain = value`, not a bare
      keyword.
- [ ] Not targeting an element? Bare keyword, verb first.
- [ ] One simple value → a natural preposition (`from`, `as`, `wait`),
      not `with {}`.
- [ ] More than one field, or anything nested → `with {}`.
- [ ] Declaring a new named thing → `def <NOUN> <name> ...`, and decline
      immediately if the token after `def` isn't yours.
- [ ] Classify tokens by `.value`, not `.type`.

See `PLUGIN-DEVELOPMENT.md` for the mechanics of registering a
`customRule` handler in the first place — this guide is about the shape
of what you parse, not how the hook itself works.
