# Docs

This package doesn't bundle guide content — every real word of it lives
in, and is fetched live from, the main repo. That's intentional: this
whole npm package is a thin wrapper around
[github.com/MrGrimJoe/cdrca-ready-for-the-real-world](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world)
(same as the `cdrca` binary itself, downloaded from that repo's Releases
on every install) — if that repo goes away, this stops working too, on
purpose.

## Read a guide

```
cdrca12 docs <topic>
```

| Topic | What |
|---|---|
| `cli` | Walking through the CLI command by command |
| `animations` | The `animations` plugin's scene/prop/action syntax |
| `quark` | The `quark` plugin's `@directive` syntax and component reference |
| `plugins` | Building your own plugin or library |
| `guides` | The guides index itself |

Or read them online directly:
[github.com/MrGrimJoe/cdrca-ready-for-the-real-world/tree/main/docs/guides](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world/tree/main/docs/guides)

No network right now? `cdrca12 docs <topic>` will tell you the fetch
failed rather than showing you something stale — there's nothing stale
to fall back to here, by design.
