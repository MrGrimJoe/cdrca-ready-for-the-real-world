# A project that owns its page

A new `cdrca create app` project has a real web page of its own. You edit the HTML,
your `.cdrca` files draw and style it, and `cdrca run` shows it in the browser.

```txt
my-site/
  cdrca.json            says where the page is:  "html": "public/index.html"
  public/
    index.html          your page — plain HTML you edit freely
  src/
    main.cdrca          your main program
    stars.cdrca         (optional) another file it uses
```

Everything on this page is checked by tests (`tools/docs-v2-check.js`, and the
project-server tests that serve real projects and load them into a page).

## What `cdrca run` does

```sh
cd my-site
cdrca run
```

It starts a small local server and prints the address. Then:

- **`/`** is your `public/index.html`. CDRCA's own scripts are added to it for you, followed by
  your program, so a bare page with only your content in it already works.
- **`/src/main.cdrca.js`** is `src/main.cdrca`, compiled when the browser asks for it. The URL
  is the file's path plus `.js`. Every request compiles again, so **refreshing the browser
  always shows your latest files** — there is nothing to restart and no cache to clear.
- **Anything else in `public/`** (images, fonts, CSS, other pages) is served as a file.
  Files outside `public/` — your `.cdrca` source, `cdrca.json`, `node_modules` — are **not**
  served, and neither is anything whose name starts with a dot.

If you make a mistake in a `.cdrca` file, the page shows the error in a red panel at the bottom
and in the browser console, with the line and column, instead of going blank.

## `cdrca.json`

Two optional fields describe the page. They belong to your project only: **they are never sent
to the registry** when you publish.

| Field | Meaning |
|---|---|
| `html` | Path to your page, e.g. `"public/index.html"`. The page is served at `/`, and its program is the manifest's `entry`. |
| `pages` | Several pages, each with its own URL. Overrides `html`. |

One page:

```json
{
  "entry": "src/main.cdrca",
  "html": "public/index.html"
}
```

Several pages, each with its own program:

```json
{
  "pages": {
    "/":      { "html": "public/index.html", "entry": "src/home.cdrca" },
    "/about": { "html": "public/about.html", "entry": "src/about.cdrca" }
  }
}
```

Rules, all checked when you run `cdrca run`:

- Paths are relative to the project folder, with `/` separators. No leading `/`, no `..`.
- Page URLs start with `/`. A trailing slash is ignored (`/about/` is `/about`).
- A page's `entry` is optional; a page with none uses only the scripts it names itself.
- Only pages you list are pages. An HTML file that is merely *in* `public/` is still reachable by
  its file name, like any static file, but it doesn't get the runtime added.

### Projects without `html` or `pages`

Nothing changes for them. `cdrca run` starts the original preview server exactly as before.

## Where CDRCA's scripts go

By default the runtime scripts (and your program, if the page doesn't name one) are added just
before `</body>`. You can control that:

1. **A marker.** Put this comment exactly where you want them:

   ```html
   <!-- cdrca:runtime -->
   ```

   The scaffolded page already has one.
2. **Your own program tag.** If your page has `<script src="/src/main.cdrca.js"></script>`,
   the runtime is added just before it and no second program is added.
3. **Do it yourself.** A page that already loads scripts from `/__cdrca/rt/…` isn't given the runtime a second time (it still gets its program, unless it names one).

Load your program at the end of the page. It looks up elements by id, so they have to exist first.

## Paths inside `.cdrca` files

There are two kinds, and they are deliberately different:

| Where | How the path is read | Example |
|---|---|---|
| `import "…"` | **like a web link**: relative to the file that says `import` | `import "stars.cdrca"` next to it; `import "../shared/x.cdrca"` up a folder; `import "/src/x.cdrca"` from the project root |
| `background … from "…"` | relative to the **project folder**, like `entry` | `background hero from "src/stars.cdrca"` |

An import that climbs out of the project is an error with a line and column.

## An animation behind an element

`background` puts a scene *behind* your content — the whole page, or one element by its id — and
`from` takes the scene from another file. With `cdrca run` all four forms work:

```txt
background                            this file's scene, behind the whole page
background hero                       this file's scene, behind <div id="hero">
background from "src/stars.cdrca"     stars.cdrca's scene, behind the whole page
background hero from "src/stars.cdrca"
```

The browser loads the other file as `/__cdrca/bg/src/stars.cdrca.js` — an ES module that draws
into a canvas it is handed. It runs in its own scope, so two backgrounds can use the same names
without clashing. See [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) for the details.

## When something goes wrong

| You see | It means |
|---|---|
| `page '/' points at 'public/index.html', which does not exist in this project` | `cdrca.json` names a page file that isn't there. |
| `'html' '../x.html' must be a path inside the project` | Page and program paths must stay inside the project folder. |
| `page URL 'about' must start with '/'` | Keys of `pages` are URLs. |
| `no such file: src/nope.cdrca` (in the page) | A `background … from "…"` names a file that isn't in the project. `from` paths are relative to the project folder. |
| A red panel with `unknown flag 'glas' for navbar — did you mean 'glass'?` | A mistake in a `.cdrca` file, with its position. See [SYNTAX.md](../SYNTAX.md). |
| `CDRCA runtime not found at … — run 'cdrca create app' or 'cdrca install cdrca' first` | The project's `node_modules/cdrca` is missing. |
| `cdrca: port 3000 is already in use` | Another program has the project's port. Stop it, and run again. |

## Limits

- **`cdrca run` is a development server.** It compiles on every request and has no live reload:
  refresh the browser after you edit.
- A `.cdrca` file with no scene compiles to a valid, empty animation; it is not an error.
- A file used as a background runs in strict mode, as ES modules always do, so `js { }` blocks in
  it must be strict-mode JavaScript.
- Inside a background file, a `background` **without** `from` is ignored — the canvas it draws
  into is the one it was given. A `background … from` there would start yet another background,
  so don't nest them.
