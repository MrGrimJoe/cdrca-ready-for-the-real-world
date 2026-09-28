#!/usr/bin/env node
// project-server.js — what `cdrca run` starts for a project that owns its page
// (its cdrca.json has an `html` or `pages` field). Projects without one still
// get the original preview server; nothing about them changes.
//
// It does four things, with Node's own `http` module and no dependencies:
//
//   1. Serves the project's HTML (`public/index.html`, or each entry of
//      `pages`), with CDRCA's runtime scripts added for you.
//   2. Compiles a `.cdrca` file when the browser asks for it:
//        /src/main.cdrca.js  ->  compiles <project>/src/main.cdrca
//      The URL is the project path plus `.js`, so the same <script> tag
//      works here and in a built site.
//   3. Serves background programs: `background from "stars.cdrca"` loads
//        /__cdrca/bg/stars.cdrca.js
//      an ES module that draws that file's scene into a canvas it is handed.
//   4. Serves everything else in `public/` as static files.
//
// Compiling happens on every request, so a browser refresh always shows your
// latest files. There is no watcher and no cache to go stale.
//
// Run:  CDRCA_PROJECT=<dir> CDRCA_PORT=<port> node project-server.js
// This file is installed next to the runtime (node_modules/cdrca/), which is
// where RT_DIR points; the compiler and the browser-side scripts come from there.

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const RT_DIR = __dirname;
const FRONT_END = path.join(RT_DIR, "Front-end");
const RT_PREFIX = "/__cdrca/rt/";
const BG_PREFIX = "/__cdrca/bg/";
const RUNTIME_MARKER = "<!-- cdrca:runtime -->";
// Folders that never hold project source. Dot-folders are skipped as well.
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "build"]);
// Scripts on the preview page that belong to its editor, not to a project page.
const PREVIEW_ONLY_SCRIPTS = new Set(["Parser.js", "index.js"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
};

let transpilerCache = null;
function transpiler() {
  if (!transpilerCache) {
    transpilerCache = require(path.join(RT_DIR, "Back-end", "Transpiler", "index"));
  }
  return transpilerCache;
}

// ------------------------------------------------------------------ paths

// `rel` joined onto `base`, or null if it would leave `base` (or is absolute).
function safeJoin(base, rel) {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0")) return null;
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const full = path.resolve(base, rel);
  const root = path.resolve(base);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// A path written in cdrca.json: relative, forward slashes, inside the project.
function cleanProjectPath(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${what} must be a non-empty path`);
  }
  const p = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) {
    throw new Error(`${what} '${value}' must be a path inside the project (no leading '/', no '..')`);
  }
  return p;
}

// ------------------------------------------------------------------ layout

// Reads `entry`, `html` and `pages` from cdrca.json and returns
//   { pages: { "/": { html: "public/index.html", entry: "src/main.cdrca"|null }, … } }
// `pages` wins over `html`; with only `html`, the one page is "/" and its
// script is the manifest's `entry`.
function readLayout(root) {
  const file = path.join(root, "cdrca.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`can't read ${file}: ${e.message}`);
  }
  const pages = {};
  if (manifest.pages !== undefined) {
    if (manifest.pages === null || typeof manifest.pages !== "object" || Array.isArray(manifest.pages)) {
      throw new Error("cdrca.json: 'pages' must be an object like { \"/\": { \"html\": \"public/index.html\" } }");
    }
    for (const [url, page] of Object.entries(manifest.pages)) {
      if (!url.startsWith("/")) throw new Error(`cdrca.json: page URL '${url}' must start with '/'`);
      if (!page || typeof page !== "object") throw new Error(`cdrca.json: page '${url}' must be an object with an 'html' field`);
      pages[normalizeUrl(url)] = {
        html: cleanProjectPath(page.html, `cdrca.json: pages['${url}'].html`),
        entry: page.entry === undefined ? null : cleanProjectPath(page.entry, `cdrca.json: pages['${url}'].entry`),
      };
    }
  } else if (manifest.html !== undefined) {
    pages["/"] = {
      html: cleanProjectPath(manifest.html, "cdrca.json: 'html'"),
      entry: typeof manifest.entry === "string" ? cleanProjectPath(manifest.entry, "cdrca.json: 'entry'") : null,
    };
  }
  return { pages };
}

function normalizeUrl(url) {
  if (url.length > 1 && url.endsWith("/")) return url.replace(/\/+$/, "") || "/";
  return url;
}

// ------------------------------------------------------------------ compiling

// Every .cdrca file in the project, as the nested { folder: { file: text } }
// object the compiler's virtual file system expects.
function buildVfs(root) {
  const vfs = {};
  (function walk(dir, node) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        node[entry.name] = {};
        walk(path.join(dir, entry.name), node[entry.name]);
        if (Object.keys(node[entry.name]).length === 0) delete node[entry.name];
      } else if (entry.isFile() && entry.name.endsWith(".cdrca")) {
        node[entry.name] = fs.readFileSync(path.join(dir, entry.name), "utf8");
      }
    }
  })(root, vfs);
  return vfs;
}

function vfsHas(vfs, rel) {
  let cur = vfs;
  for (const part of rel.split("/")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return false;
    cur = cur[part];
  }
  return typeof cur === "string";
}

class NotFound extends Error {}

// Compile <root>/<rel> (a .cdrca file) to JavaScript. Its `import`s are found
// in the same virtual file system.
function compileProgram(root, rel) {
  const vfs = buildVfs(root);
  if (!vfsHas(vfs, rel)) throw new NotFound(`no such file: ${rel}`);
  return String(transpiler().transpile(vfs, {}, [rel]));
}

// The compiled program starts its scene with this line, after everything else
// is set up. A background program must hand the renderer the canvas it was
// given, so that one line is what the wrapper below rewrites.
const INIT_LINE = /^([ \t]*)currentANIM = ObjectAnimationSystem_INS\.main\(OAS_OBJ\)/m;

// Turn a compiled program into an ES module that draws into (canvas, host).
// Returns a stop function so the backdrop can be removed cleanly.
function backgroundModule(rel, compiled) {
  if (!INIT_LINE.test(compiled)) {
    throw new Error(
      `${rel} compiled to something unexpected — no scene start was found, so it can't be used as a background. ` +
        `Does it contain a scene (!--- SCENE ... ---)?`
    );
  }
  const patched = compiled.replace(
    INIT_LINE,
    (line, indent) => `${indent}OAS_OBJ.renderMode = { canvas: __canvas, host: __host };\n${line}`
  );
  return (
    `// Background program, compiled from ${rel}\n` +
    `// Runs in its own function scope, so its names can't clash with the page's\n` +
    `// or with another background's.\n` +
    `export default function (__canvas, __host) {\n` +
    `let currentANIM = null;\n` +
    patched +
    `\nreturn function stop() {\n` +
    `  try { if (currentANIM && currentANIM.instantHault) currentANIM.instantHault(); } catch (e) {}\n` +
    `};\n}\n` +
    `//# sourceURL=cdrca-background/${rel}.js\n`
  );
}

// What the browser gets instead of a program when compiling fails: the error
// in the console AND on the page, so it isn't missed. (A <script> answered
// with an error status never runs, so this is served as a normal 200.)
function errorScript(title, message) {
  const t = JSON.stringify(title);
  const m = JSON.stringify(message);
  return (
    `(function(){\n` +
    `  console.error(${t} + "\\n" + ${m});\n` +
    `  function show(){\n` +
    `    var d = document.createElement("pre");\n` +
    `    d.setAttribute("data-cdrca-error", "");\n` +
    `    d.style.cssText = "position:fixed;z-index:2147483647;left:0;right:0;bottom:0;max-height:50%;overflow:auto;margin:0;padding:12px 16px;background:#2b0d0d;color:#ffb4b4;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;border-top:3px solid #ff5555";\n` +
    `    d.textContent = ${t} + "\\n\\n" + ${m};\n` +
    `    (document.body || document.documentElement).appendChild(d);\n` +
    `  }\n` +
    `  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);\n` +
    `})();\n`
  );
}

// ------------------------------------------------------------------ page

// The browser-side scripts a page needs, in load order: whatever the runtime's
// own page loads (three.js, the renderer, Quark, the backdrop, and any library
// the CLI staged there for an `@useLib`/`load` line) except its editor scripts.
function runtimeScripts() {
  const html = fs.readFileSync(path.join(FRONT_END, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*"([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (!src.startsWith("./")) continue;
    const rel = src.slice(2);
    if (PREVIEW_ONLY_SCRIPTS.has(rel) || out.includes(rel)) continue;
    out.push(rel);
  }
  return out;
}

const CDRCA_SCRIPT = /<script\b[^>]*?\bsrc\s*=\s*["'][^"']*\.cdrca\.js(?:\?[^"']*)?["'][^>]*>/i;

// Add the runtime (and, if the page names none, its entry program) to a page.
// Where it goes, in order of preference:
//   1. the marker  <!-- cdrca:runtime -->  (put it exactly where you want it)
//   2. just before the page's own  <script src="….cdrca.js">
//   3. just before </body>
// A page that already loads /__cdrca/rt/… scripts itself is left alone.
function injectRuntime(html, opts) {
  const entry = opts && opts.entry ? opts.entry : null;
  const hasOwnProgram = CDRCA_SCRIPT.test(html);
  const alreadyHasRuntime = html.includes(RT_PREFIX);

  const rt = alreadyHasRuntime
    ? ""
    : runtimeScripts().map((s) => `<script src="${RT_PREFIX}${s}"></script>`).join("\n");
  const prog = !hasOwnProgram && entry ? `<script src="/${entry}.js"></script>` : "";
  const block = [rt, prog].filter(Boolean).join("\n");
  if (block === "") return html;
  const wrapped = `<!-- cdrca runtime -->\n${block}\n<!-- /cdrca runtime -->`;

  if (html.includes(RUNTIME_MARKER)) return html.replace(RUNTIME_MARKER, wrapped);
  const own = CDRCA_SCRIPT.exec(html);
  if (own && !alreadyHasRuntime) return html.slice(0, own.index) + wrapped + "\n" + html.slice(own.index);
  if (own) return html;
  const close = /<\/body\s*>/i.exec(html);
  if (close) return html.slice(0, close.index) + wrapped + "\n" + html.slice(close.index);
  return html + "\n" + wrapped + "\n";
}

// ------------------------------------------------------------------ server

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra || {}));
  res.end(body);
}

function sendFile(res, file, method) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (e) {
    return false;
  }
  if (!stat.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Cache-Control": "no-store" });
  if (method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

function createServer(root, options) {
  const log = (options && options.log) || ((line) => process.stderr.write(line + "\n"));
  const reported = new Set();
  const report = (key, line) => {
    if (reported.has(key)) return;
    reported.add(key);
    log(line);
  };

  function handle(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "text/plain; charset=utf-8", "Method not allowed", { Allow: "GET, HEAD" });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch (e) {
      return send(res, 400, "text/plain; charset=utf-8", "Bad request");
    }
    if (pathname.includes("\0")) return send(res, 400, "text/plain; charset=utf-8", "Bad request");

    // 1. the runtime's own browser scripts
    if (pathname.startsWith(RT_PREFIX)) {
      const file = safeJoin(FRONT_END, pathname.slice(RT_PREFIX.length));
      if (file && sendFile(res, file, req.method)) return;
      return send(res, 404, "text/plain; charset=utf-8", "Not found");
    }

    // 2. a background program: an ES module compiled from a .cdrca file
    if (pathname.startsWith(BG_PREFIX)) {
      const asked = pathname.slice(BG_PREFIX.length);
      if (!asked.endsWith(".cdrca.js")) return send(res, 404, "text/plain; charset=utf-8", "Not found");
      const rel = asked.slice(0, -3);
      const bad = safeJoin(root, rel);
      if (!bad) return send(res, 404, "text/plain; charset=utf-8", "Not found");
      try {
        return send(res, 200, MIME[".js"], backgroundModule(rel, compileProgram(root, rel)));
      } catch (e) {
        if (e instanceof NotFound) {
          const msg = `background from "${rel}": ${e.message}. 'from' paths are relative to the project folder.`;
          report("bg:" + rel, `cdrca: ${msg}`);
          return send(res, 200, MIME[".js"], errorScript(`Can't load background ${rel}`, msg) + "export default function () {}\n");
        }
        report("bg:" + rel + e.message, `cdrca: error compiling ${rel}\n${e.message}`);
        return send(res, 200, MIME[".js"], errorScript(`Error in ${rel}`, e.message) + "export default function () {}\n");
      }
    }

    // 3. a program: /some/file.cdrca.js compiles <project>/some/file.cdrca
    if (pathname.endsWith(".cdrca.js")) {
      const rel = pathname.slice(1, -3);
      if (safeJoin(root, rel)) {
        try {
          return send(res, 200, MIME[".js"], compileProgram(root, rel) + `\n//# sourceURL=cdrca/${rel}.js\n`);
        } catch (e) {
          if (!(e instanceof NotFound)) {
            report("prog:" + rel + e.message, `cdrca: error compiling ${rel}\n${e.message}`);
            return send(res, 200, MIME[".js"], errorScript(`Error in ${rel}`, e.message));
          }
          // no such .cdrca file: fall through to static files / 404
        }
      }
    }

    // 4. one of the project's pages
    let layout;
    try {
      layout = readLayout(root);
    } catch (e) {
      report("layout" + e.message, `cdrca: ${e.message}`);
      return send(res, 500, "text/plain; charset=utf-8", e.message);
    }
    const url = pathname === "/index.html" && layout.pages["/"] ? "/" : normalizeUrl(pathname);
    const page = layout.pages[url];
    if (page) {
      const file = safeJoin(root, page.html);
      let html;
      try {
        html = fs.readFileSync(file, "utf8");
      } catch (e) {
        const msg = `page '${url}' points at '${page.html}', which can't be read (${e.code || e.message})`;
        report("page" + url, `cdrca: ${msg}`);
        return send(res, 500, "text/plain; charset=utf-8", msg);
      }
      return send(res, 200, MIME[".html"], req.method === "HEAD" ? "" : injectRuntime(html, { entry: page.entry }));
    }

    // 5. static files in public/
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length && !segments.some((s) => s.startsWith("."))) {
      const publicDir = path.join(root, "public");
      const file = safeJoin(publicDir, segments.join("/"));
      if (file) {
        if (sendFile(res, file, req.method)) return;
        try {
          if (fs.statSync(file).isDirectory() && sendFile(res, path.join(file, "index.html"), req.method)) return;
        } catch (e) {
          /* not a directory */
        }
      }
    }

    const known = Object.keys(layout.pages);
    return send(
      res,
      404,
      "text/plain; charset=utf-8",
      `Not found: ${pathname}\n` + (known.length ? `Pages: ${known.join(", ")}\n` : "This project has no pages (see 'html' / 'pages' in cdrca.json).\n")
    );
  }

  return http.createServer(handle);
}

module.exports = {
  buildVfs,
  backgroundModule,
  cleanProjectPath,
  compileProgram,
  createServer,
  errorScript,
  injectRuntime,
  readLayout,
  runtimeScripts,
  safeJoin,
  RT_PREFIX,
  BG_PREFIX,
};

if (require.main === module) {
  const root = path.resolve(process.env.CDRCA_PROJECT || process.cwd());
  const port = Number(process.env.CDRCA_PORT) || 3000;
  let layout;
  try {
    layout = readLayout(root);
  } catch (e) {
    console.error(`cdrca: ${e.message}`);
    process.exit(1);
  }
  const server = createServer(root);
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `cdrca: port ${port} is already in use` : `cdrca: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`CDRCA project server: http://localhost:${port}/`);
    for (const [url, page] of Object.entries(layout.pages)) {
      console.log(`  ${url.padEnd(12)} ${page.html}${page.entry ? `  (program: ${page.entry})` : ""}`);
    }
  });
}
