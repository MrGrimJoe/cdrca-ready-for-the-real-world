# cdrca-reactive-state

Lightweight reactive state + DOM data-binding for CDRCA. See
[`../../docs/REACTIVE-STATE.md`](../../docs/REACTIVE-STATE.md) for the
full documentation, and [`examples/todo-app/`](./examples/todo-app) for a
complete small app.

```
state count = 0
@countText bind.text = count
@increment click => count += 1
```

- `plugin.js` — the transpiler hook (Node-side, zero dependencies)
- `runtime.js` — the browser-side runtime (zero dependencies, plain
  `<script>` tag)
- `tests/` — 65+ tests (`node tests/run.js`); `package.json`'s
  `devDependencies` (`cdrca`, `jsdom`) are test-only and aren't part of
  the shipped plugin
