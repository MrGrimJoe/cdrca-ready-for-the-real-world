// The project server, tested over real HTTP against real project folders, and
// then loaded the way a browser loads it (HTML first, then each <script> in
// order, fetched from the server) into a jsdom page running the real
// Renderer.js, backdrop runtime and three.js. Only WebGL is replaced (jsdom has
// none) by a recorder that notes what the renderer asked it to draw and where.
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch {
  console.log("SKIPPED: jsdom isn't installed — run `npm install --no-save jsdom` to enable this file.");
  process.exit(0);
}
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const RT = path.join(__dirname, "..");
const S = require(path.join(RT, "project-server.js"));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok -", name); }
  catch (e) { failed++; console.log("  FAIL -", name, "\n     ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n      ")); }
}

// ------------------------------------------------------------------ fixtures

const CUBE = (name, colour = "0xff0000") => `object ${name} = RotatingCube(${colour}, 1)\n`;
const scene = (name, body) => `!--- SCENE ${name} :: ${name.toLowerCase()} ---\n${body}!---END---\n`;
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>\n<div id="hero"></div>\n</body></html>';

const dirs = [];
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdrca-proj-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}
process.on("exit", () => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

async function serve(root) {
  const logs = [];
  const server = S.createServer(root, { log: (l) => logs.push(l) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, logs, close: () => new Promise((r) => server.close(r)) };
}
const get = async (base, p, init) => {
  const r = await fetch(base + p, init);
  return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text(), headers: r.headers };
};

const BASIC = () => ({
  "cdrca.json": JSON.stringify({ name: "t", entry: "src/main.cdrca", html: "public/index.html" }),
  "public/index.html": PAGE,
  "public/hello.txt": "hello",
  "public/.secret": "nope",
  "public/docs/index.html": "<p>docs</p>",
  "src/main.cdrca": "require quark\nload quark.components\n" + scene("Main", CUBE("cubeMain") + "@hero card elevated\n"),
});

// ------------------------------------------------------------------ layout

(async () => {
  await test("layout: 'html' alone makes one page at '/' whose program is the manifest entry", () => {
    const root = project({ "cdrca.json": JSON.stringify({ entry: "src/main.cdrca", html: "public/index.html" }) });
    assert.deepStrictEqual(S.readLayout(root), { pages: { "/": { html: "public/index.html", entry: "src/main.cdrca" } } });
  });

  await test("layout: 'pages' gives one page per URL, each with its own optional program", () => {
    const root = project({ "cdrca.json": JSON.stringify({ entry: "a.cdrca", pages: { "/": { html: "public/index.html", entry: "src/main.cdrca" }, "/about/": { html: "public/about.html" } } }) });
    assert.deepStrictEqual(S.readLayout(root), { pages: { "/": { html: "public/index.html", entry: "src/main.cdrca" }, "/about": { html: "public/about.html", entry: null } } });
  });

  await test("layout: 'pages' wins over 'html'; neither means no pages", () => {
    const both = project({ "cdrca.json": JSON.stringify({ html: "x.html", pages: { "/p": { html: "p.html" } } }) });
    assert.deepStrictEqual(Object.keys(S.readLayout(both).pages), ["/p"]);
    assert.deepStrictEqual(S.readLayout(project({ "cdrca.json": "{}" })).pages, {});
  });

  await test("layout: paths that leave the project, and malformed fields, are refused with a message that names the field", () => {
    const bad = (m, re) => assert.throws(() => S.readLayout(project({ "cdrca.json": JSON.stringify(m) })), re);
    bad({ html: "../x.html" }, /'html'.*inside the project/);
    bad({ html: "/etc/passwd" }, /'html'.*inside the project/);
    bad({ html: "" }, /'html' must be a non-empty path/);
    bad({ pages: { about: { html: "a.html" } } }, /page URL 'about' must start with '\/'/);
    bad({ pages: { "/a": { html: "../a.html" } } }, /pages\['\/a'\]\.html/);
    bad({ pages: [] }, /'pages' must be an object/);
    bad({ pages: { "/a": "a.html" } }, /page '\/a' must be an object/);
  });

  await test("safeJoin: never leaves its base", () => {
    const base = path.join(os.tmpdir(), "sj");
    assert.ok(S.safeJoin(base, "a/b.txt").startsWith(path.resolve(base)));
    for (const evil of ["../x", "a/../../x", "/etc/passwd", "C:\\x", "a\0b", ""]) assert.strictEqual(S.safeJoin(base, evil), null, evil);
  });

  // ---------------------------------------------------------------- runtime scripts

  await test("runtime scripts: what the preview page loads, minus its editor scripts, in order, once each", () => {
    const list = S.runtimeScripts();
    assert.ok(list.indexOf("three.js") !== -1 && list.indexOf("three.js") < list.indexOf("Renderer.js"), "three.js before Renderer.js");
    assert.ok(list.includes("Transpiler-Plugins/animations/animations-backdrop.js"));
    assert.ok(list.some((s) => s.includes("quark-core.js")));
    assert.ok(!list.includes("Parser.js") && !list.includes("index.js"), "editor-only scripts must not be injected");
    assert.strictEqual(new Set(list).size, list.length, "no duplicates");
    for (const s of list) assert.ok(fs.existsSync(path.join(RT, "Front-end", s)), s + " must exist");
  });

  // ---------------------------------------------------------------- injection

  await test("inject: goes before </body> by default, and the entry program follows the runtime", () => {
    const out = S.injectRuntime(PAGE, { entry: "src/main.cdrca" });
    const i = out.indexOf("/__cdrca/rt/three.js"), j = out.indexOf('src="/src/main.cdrca.js"'), k = out.indexOf("</body>");
    assert.ok(i > 0 && i < j && j < k, [i, j, k].join(","));
  });

  await test("inject: the marker decides placement", () => {
    const out = S.injectRuntime('<body><p>a</p><!-- cdrca:runtime --><footer id="f"></footer></body>', { entry: "m.cdrca" });
    assert.ok(out.indexOf("three.js") < out.indexOf("footer") && out.indexOf("three.js") > out.indexOf("<p>a</p>"));
    assert.ok(!out.includes("<!-- cdrca:runtime -->"), "marker replaced");
  });

  await test("inject: a page with its own program tag gets the runtime just before it, and no second program", () => {
    const html = '<body><div id="hero"></div>\n<script src="/src/main.cdrca.js"></script></body>';
    const out = S.injectRuntime(html, { entry: "other.cdrca" });
    assert.ok(out.indexOf("three.js") < out.indexOf('src="/src/main.cdrca.js"'));
    assert.ok(!out.includes("other.cdrca.js"), "the page chose its own program");
    assert.strictEqual(out.match(/main\.cdrca\.js/g).length, 1);
  });

  await test("inject: a page that already loads the runtime is not given it twice", () => {
    const once = S.injectRuntime(PAGE, {});
    assert.strictEqual(S.injectRuntime(once, {}), once, "idempotent");
  });

  await test("inject: no <body> at all still works; no entry and no runtime need adds nothing extra", () => {
    assert.ok(S.injectRuntime("<p>x</p>", {}).includes("three.js"));
    assert.ok(!S.injectRuntime(PAGE, {}).includes(".cdrca.js"));
  });

  await test("the scaffold's own page: its marker is replaced by the runtime and the program, and nothing stray is left", () => {
    const starter = fs.readFileSync(path.join(RT, "..", "starter.html"), "utf8").replace(/\{\{name\}\}/g, "demo");
    const out = S.injectRuntime(starter, { entry: "src/main.cdrca" });
    assert.ok(!out.includes("<!-- cdrca:runtime -->"), "marker replaced");
    assert.strictEqual((out.match(/src="\/src\/main\.cdrca\.js"/g) || []).length, 1, "the program is added exactly once");
    assert.ok(out.indexOf("/__cdrca/rt/three.js") < out.indexOf("/src/main.cdrca.js"));
    // no comment left open or closed twice: strip comments and look for a stray terminator
    assert.ok(!out.replace(/<!--[\s\S]*?-->/g, "").includes("-->"), "a stray --> would show up as page text");
    assert.ok(out.indexOf("<canvas") !== -1 && out.indexOf("<canvas") < out.indexOf("/__cdrca/rt/three.js"), "the canvas exists before the scripts that draw into it");
  });

  // ---------------------------------------------------------------- HTTP

  const A = await serve(project(BASIC()));

  await test("http: '/' is the project's page with runtime and entry program injected", async () => {
    const r = await get(A.base, "/");
    assert.strictEqual(r.status, 200);
    assert.match(r.type, /text\/html/);
    assert.match(r.text, /id="hero"/);
    assert.match(r.text, /\/__cdrca\/rt\/three\.js/);
    assert.match(r.text, /<script src="\/src\/main\.cdrca\.js"><\/script>/);
    assert.strictEqual(r.headers.get("cache-control"), "no-store");
  });

  await test("http: '/index.html' is the same page; HEAD works and sends no body; other methods are refused", async () => {
    assert.strictEqual((await get(A.base, "/index.html")).text, (await get(A.base, "/")).text);
    const head = await get(A.base, "/", { method: "HEAD" });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.text, "");
    assert.strictEqual((await get(A.base, "/", { method: "POST" })).status, 405);
  });

  await test("http: /src/main.cdrca.js compiles the file — v2 syntax, load and all", async () => {
    const r = await get(A.base, "/src/main.cdrca.js");
    assert.strictEqual(r.status, 200);
    assert.match(r.type, /javascript/);
    assert.match(r.text, /Quark\.UI\.mount\("hero",\s*"card",\s*\["elevated"\]\)/);
    assert.match(r.text, /OAS_OBJ/);
    assert.match(r.text, /sourceURL=cdrca\/src\/main\.cdrca\.js/);
    assert.doesNotThrow(() => new vm.Script(r.text), "must be valid JavaScript");
  });

  await test("http: the runtime's own scripts are served; escaping the Front-end folder is not possible", async () => {
    assert.strictEqual((await get(A.base, "/__cdrca/rt/three.js")).status, 200);
    assert.strictEqual((await get(A.base, "/__cdrca/rt/Renderer.js")).status, 200);
    // `..%2f` survives URL normalisation (only a real '/' is a path separator to
    // the URL parser) and the server then decodes it to `../`. One level up from
    // Front-end/ is the runtime's own package.json, which exists — so an
    // unguarded server would really serve it. (Payloads that land on nothing
    // would pass even with no guard at all.)
    for (const evil of ["/__cdrca/rt/..%2fpackage.json", "/__cdrca/rt/..%2f..%2fproject-server.js", "/__cdrca/rt/%2e%2e%2fpackage.json", "/__cdrca/rt/..%5cpackage.json", "/__cdrca/rt/%2e%2e/%2e%2e/package.json", "/__cdrca/rt/../../package.json"]) {
      const r = await get(A.base, evil);
      assert.strictEqual(r.status, 404, evil);
      assert.ok(!r.text.includes('"name"'), "must not leak " + evil);
    }
  });

  await test("http: public/ files are static; dot-files and traversal are not reachable", async () => {
    assert.strictEqual((await get(A.base, "/hello.txt")).text, "hello");
    assert.match((await get(A.base, "/hello.txt")).type, /text\/plain/);
    assert.strictEqual((await get(A.base, "/docs")).text, "<p>docs</p>", "a folder serves its index.html");
    assert.strictEqual((await get(A.base, "/.secret")).status, 404);
    assert.strictEqual((await get(A.base, "/..%2fcdrca.json")).status, 404, "one level up from public/ is the project's own cdrca.json, which exists");
    assert.strictEqual((await get(A.base, "/..%2fsrc%2fmain.cdrca")).status, 404);
    assert.strictEqual((await get(A.base, "/%2e%2e/cdrca.json")).status, 404);
    assert.strictEqual((await get(A.base, "/../cdrca.json")).status, 404);
    assert.strictEqual((await get(A.base, "/cdrca.json")).status, 404, "project files outside public/ are not served");
    assert.strictEqual((await get(A.base, "/src/main.cdrca")).status, 404, "source is only served compiled");
  });

  await test("http: an unknown URL says which pages exist", async () => {
    const r = await get(A.base, "/nope");
    assert.strictEqual(r.status, 404);
    assert.match(r.text, /Pages: \//);
  });

  await test("http: bad URL encoding is a 400, not a crash", async () => {
    assert.strictEqual((await get(A.base, "/%E0%A4%A")).status, 400);
    assert.strictEqual((await get(A.base, "/")).status, 200, "server still up");
  });

  await A.close();

  // ---------------------------------------------------------------- errors

  const E = await serve(project({
    "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/main.cdrca" }),
    "public/index.html": PAGE,
    "src/main.cdrca": "// header\n" + scene("Main", CUBE("cubeMain") + "@nav navbar glas\n"),
  }));

  await test("errors: a mistake in a .cdrca file becomes a visible error, not a dead page", async () => {
    const r = await get(E.base, "/src/main.cdrca.js");
    assert.strictEqual(r.status, 200, "a script answered with an error status would never run");
    assert.match(r.text, /unknown flag 'glas' for navbar/);
    assert.match(r.text, /did you mean 'glass'/);
    assert.match(r.text, /data-cdrca-error/);
    assert.strictEqual(E.logs.length, 1);
    assert.match(E.logs[0], /error compiling src\/main\.cdrca/);
    await get(E.base, "/src/main.cdrca.js");
    assert.strictEqual(E.logs.length, 1, "the same error is not logged over and over");
  });

  await test("errors: the overlay really shows up on the page and in the console", async () => {
    const r = await get(E.base, "/src/main.cdrca.js");
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", () => {});
    const dom = new JSDOM("<body></body>", { runScripts: "outside-only", virtualConsole: vc });
    dom.window.console.error = (m) => errors.push(String(m));
    dom.window.eval(r.text);
    const pre = dom.window.document.querySelector("pre[data-cdrca-error]");
    assert.ok(pre, "overlay element");
    assert.match(pre.textContent, /unknown flag 'glas'/);
    assert.match(errors.join("\n"), /unknown flag 'glas'/);
  });

  await E.close();

  // ---------------------------------------------------------------- backgrounds

  const BG_SRC = "// stars\n" + scene("Stars", CUBE("cubeBg", "0x3b82f6") + 'action spin stay=2000ms lerp=500ms { cubeBg.modifyMesh("") }\n');
  const B = await serve(project({
    "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/main.cdrca" }),
    "public/index.html": PAGE,
    "src/main.cdrca": scene("Main", CUBE("cubeMain") + 'background hero from "src/backgrounds/stars.cdrca"\n'),
    "src/backgrounds/stars.cdrca": BG_SRC,
    "src/backgrounds/broken.cdrca": "just some words\n",
    "src/plain.cdrca": "// no scene here\n",
  }));

  await test("background: /__cdrca/bg/<file>.cdrca.js is an ES module that takes (canvas, host)", async () => {
    const r = await get(B.base, "/__cdrca/bg/src/backgrounds/stars.cdrca.js");
    assert.strictEqual(r.status, 200);
    assert.match(r.type, /javascript/);
    assert.match(r.text, /export default function \(__canvas, __host\)/);
    assert.match(r.text, /OAS_OBJ\.renderMode = \{ canvas: __canvas, host: __host \};\s*\n\s*currentANIM = ObjectAnimationSystem_INS\.main\(OAS_OBJ\)/, "the renderer is told which canvas to use, immediately before the scene starts");
    // Really parse it as a module (a plain Function would reject `export`).
    const tmp = path.join(os.tmpdir(), `cdrca-bg-${process.pid}.mjs`);
    fs.writeFileSync(tmp, r.text);
    try { const mod = await import(pathToFileURL(tmp).href); assert.strictEqual(typeof mod.default, "function"); }
    finally { fs.rmSync(tmp, { force: true }); }
  });

  await test("background: a `background` statement INSIDE a background file cannot redirect it — the handed-over canvas is set last", () => {
    const own = scene("Inner", CUBE("cubeInner") + "background\n");
    const root = project({ "in.cdrca": own });
    const mod = S.backgroundModule("in.cdrca", S.compileProgram(root, "in.cdrca"));
    const theirs = mod.indexOf('OAS_OBJ.renderMode = {"mode":"background"');
    const ours = mod.indexOf("OAS_OBJ.renderMode = { canvas: __canvas");
    assert.ok(theirs !== -1 && ours !== -1, "both assignments are present");
    assert.ok(ours > theirs, "the canvas hand-over comes after, so it wins");
    assert.ok(mod.indexOf("currentANIM = ObjectAnimationSystem_INS.main") > ours, "and before the scene starts");
  });

  await test("background: a missing file, a file with no scene, and a mistake each give a visible, specific error", async () => {
    const miss = await get(B.base, "/__cdrca/bg/src/nothing.cdrca.js");
    assert.match(miss.text, /no such file: src\/nothing\.cdrca/);
    assert.match(miss.text, /relative to the project folder/);
    assert.match(miss.text, /export default function \(\) \{\}/, "still a valid module, so import() doesn't fail");
    // A file with no scene at all compiles to a valid, empty animation — not an error.
    const plain = await get(B.base, "/__cdrca/bg/src/plain.cdrca.js");
    assert.match(plain.text, /export default function \(__canvas, __host\)/);
    assert.ok(!/data-cdrca-error/.test(plain.text));
    // The wrapper refuses compiled output whose shape it doesn't recognise, with a message that says why.
    assert.throws(() => S.backgroundModule("x.cdrca", "var a = 1;\n"), /no scene start was found/);
  });

  await test("background: only .cdrca files, and only inside the project", async () => {
    fs.writeFileSync(path.join(os.tmpdir(), "cdrca-outside.cdrca"), scene("Outside", CUBE("cubeOutside")));
    for (const p of ["/__cdrca/bg/src/backgrounds/stars.js", "/__cdrca/bg/..%2fcdrca.json", "/__cdrca/bg/../../etc/passwd.cdrca.js", "/__cdrca/bg/", "/__cdrca/bg/..%2f..%2f" + path.basename(os.tmpdir()) + "%2fcdrca-outside.cdrca.js", "/..%2fcdrca-outside.cdrca.js"]) {
      const r = await get(B.base, p);
      assert.ok(r.status === 404 || /no such file/.test(r.text), p + " -> " + r.status);
      assert.ok(!r.text.includes("root:") && !r.text.includes("cubeOutside"), p);
    }
    fs.rmSync(path.join(os.tmpdir(), "cdrca-outside.cdrca"), { force: true });
  });

  // ---------------------------------------------------------------- a real page load

  // Load a page from the server the way a browser does: the HTML, then each
  // <script src> in document order fetched from the server and run. Only
  // WebGL is replaced (after three.js has run, before anything uses it).
  async function loadPage(base, urlPath) {
    const res = await get(base, urlPath);
    const vc = new VirtualConsole();
    const consoleLines = [];
    vc.on("jsdomError", (e) => consoleLines.push("jsdomError: " + e.message));
    const dom = new JSDOM(res.text, { runScripts: "outside-only", pretendToBeVisual: true, url: base + urlPath, virtualConsole: vc });
    const w = dom.window;
    w.console.warn = (m) => consoleLines.push("warn: " + m);
    w.console.error = (m) => consoleLines.push("error: " + m);
    Object.defineProperty(w, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(w, "innerHeight", { value: 768, configurable: true });
    const ctx = dom.getInternalVMContext();
    const gl = { instances: [], sizes: [] };
    const scripts = Array.from(w.document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src"));
    // Backdrop loads a background program through import(); a jsdom context
    // has no module loader, so fetch the module from the server and turn its
    // one `export default` into a return value. (Module syntax itself is
    // checked with a real import() in the test above.) Installed the moment
    // the backdrop script exists — the program runs later in the same page
    // load and calls Backdrop.attach() straight away.
    const installModuleLoader = () => {
      w.Backdrop._importModule = async (url) => {
        const mod = await get(base, new URL(url).pathname);
        const fn = new vm.Script("(function(){" + mod.text.replace("export default function", "return function") + "})()", { filename: url }).runInContext(ctx);
        return { default: fn };
      };
    };
    for (const src of scripts) {
      const body = await get(base, src);
      assert.strictEqual(body.status, 200, "script " + src);
      new vm.Script(body.text, { filename: src }).runInContext(ctx);
      if (src.endsWith("animations-backdrop.js")) installModuleLoader();
      if (src.endsWith("/three.js")) {
        w.THREE.WebGLRenderer = class {
          constructor(o) { this.canvas = o && o.canvas; gl.instances.push(this); }
          setSize(...a) { gl.sizes.push({ canvas: this.canvas, size: a }); }
          render() {}
          setClearColor() {}
        };
      }
    }
    return { dom, w, ctx, gl, scripts, consoleLines, html: res.text };
  }

  await test("page load: the scaffold-shaped page runs — runtime first, then the program, in order", async () => {
    const S2 = await serve(project(BASIC()));
    const page = await loadPage(S2.base, "/");
    const order = page.scripts;
    assert.ok(order.indexOf("/__cdrca/rt/three.js") < order.indexOf("/__cdrca/rt/Renderer.js"));
    assert.strictEqual(order[order.length - 1], "/src/main.cdrca.js", "the program runs last");
    const hero = page.w.document.getElementById("hero");
    assert.strictEqual(hero.getAttribute("data-quark-component"), "card", "Quark styled the element");
    assert.strictEqual(hero.getAttribute("data-quark-variant"), "elevated");
    assert.strictEqual(page.consoleLines.filter((l) => l.startsWith("error")).length, 0, page.consoleLines.join("\n"));
    await S2.close();
  });

  await test("page load: `background` (this file's scene) draws behind the whole page", async () => {
    const S2 = await serve(project({
      "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/main.cdrca" }),
      "public/index.html": PAGE,
      "src/main.cdrca": scene("Main", CUBE("cubeMain") + "background\n"),
    }));
    const page = await loadPage(S2.base, "/");
    const body = page.w.document.body;
    assert.strictEqual(body.firstChild.tagName, "CANVAS");
    assert.strictEqual(body.firstChild.style.position, "fixed");
    assert.strictEqual(page.gl.instances.length, 1);
    assert.strictEqual(page.gl.instances[0].canvas, body.firstChild, "the renderer draws into the placed canvas");
    await S2.close();
  });

  await test("page load: `background hero from \"…\"` — another file's scene, behind #hero, from the served program", async () => {
    const page = await loadPage(B.base, "/");
    await new Promise((r) => setTimeout(r, 50));
    const hero = page.w.document.getElementById("hero");
    const canvas = hero.firstChild;
    assert.strictEqual(canvas.tagName, "CANVAS", page.consoleLines.join("\n"));
    assert.strictEqual(canvas.style.position, "absolute");
    assert.strictEqual(hero.style.isolation, "isolate");
    // The main file has a scene of its own too (a renderer with no canvas to
    // show it on in this page), so pick the background's renderer out by canvas.
    const mine = page.gl.instances.filter((i) => i.canvas === canvas);
    assert.strictEqual(mine.length, 1, "the background program draws into exactly the canvas it was handed");
    assert.strictEqual(page.gl.instances.length, 2, "…alongside the main file's own scene");
    assert.strictEqual(page.w.cubeBg, undefined, "the background's variables did not leak into the page");
    // The page's own OAS_OBJ is the MAIN file's scene; the background's must not have touched it.
    assert.ok(page.w.cubeMain !== undefined, "the main file's own scene is intact");
    assert.strictEqual(page.w.OAS_OBJ.renderMode, undefined, "…and the background's canvas wasn't written onto the page's scene object");
    assert.ok(page.gl.sizes.length >= 1);
    assert.strictEqual(page.consoleLines.filter((l) => l.startsWith("error")).length, 0, page.consoleLines.join("\n"));
  });

  await test("page load: two backgrounds using the SAME variable names don't collide", async () => {
    const S2 = await serve(project({
      "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/main.cdrca" }),
      "public/index.html": '<!doctype html><body><div id="a"></div><div id="b"></div></body>',
      "src/main.cdrca": scene("Main", CUBE("cubeMain") + 'background a from "one.cdrca"\nbackground b from "two.cdrca"\n'),
      "one.cdrca": scene("One", CUBE("cubeBg", "0xff0000")),
      "two.cdrca": scene("Two", CUBE("cubeBg", "0x00ff00")),
    }));
    const page = await loadPage(S2.base, "/");
    await new Promise((r) => setTimeout(r, 50));
    const canvases = Array.from(page.w.document.querySelectorAll("canvas"));
    assert.strictEqual(canvases.length, 2);
    for (const c of canvases) {
      assert.strictEqual(page.gl.instances.filter((i) => i.canvas === c).length, 1, "each background has its own renderer");
    }
    assert.notStrictEqual(canvases[0], canvases[1]);
    await S2.close();
  });

  await test("page load: a broken background shows an error but leaves the rest of the page working", async () => {
    const S2 = await serve(project({
      "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/main.cdrca" }),
      "public/index.html": PAGE,
      "src/main.cdrca": scene("Main", CUBE("cubeMain") + '@hero card elevated\nbackground hero from "missing.cdrca"\n'),
    }));
    const page = await loadPage(S2.base, "/");
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(page.w.document.getElementById("hero").getAttribute("data-quark-component"), "card", "the rest still ran");
    assert.ok(page.consoleLines.some((l) => /no such file: missing\.cdrca/.test(l)), page.consoleLines.join("\n"));
    await S2.close();
  });

  await test("page load: the background program's stop() halts its scene", async () => {
    const page = await loadPage(B.base, "/");
    await new Promise((r) => setTimeout(r, 50));
    const Backdrop = page.w.Backdrop;
    assert.ok(Backdrop._attached["hero"], "attached");
    Backdrop.detach("hero");
    assert.strictEqual(page.w.document.getElementById("hero").querySelector("canvas"), null, "canvas removed");
  });

  await B.close();

  // ---------------------------------------------------------------- web-style imports, several pages

  await test("import: web-style paths work across folders, in a real served project", async () => {
    const S2 = await serve(project({
      "cdrca.json": JSON.stringify({ html: "public/index.html", entry: "src/pages/main.cdrca" }),
      "public/index.html": PAGE,
      "src/pages/main.cdrca": 'import "sibling.cdrca"\nimport "../shared/common.cdrca"\nimport "/top.cdrca"\n' + scene("Main", CUBE("cubeMain")),
      "src/pages/sibling.cdrca": scene("Sib", CUBE("cubeSib")),
      "src/shared/common.cdrca": scene("Common", CUBE("cubeCommon")),
      "top.cdrca": scene("Top", CUBE("cubeTop")),
    }));
    const r = await get(S2.base, "/src/pages/main.cdrca.js");
    for (const n of ["cubeMain", "cubeSib", "cubeCommon", "cubeTop"]) assert.ok(r.text.includes(n), n + " missing:\n" + r.text.slice(0, 300));
    await S2.close();
  });

  await test("pages: several pages, each with its own program; an unlisted .html is not a page", async () => {
    const S2 = await serve(project({
      "cdrca.json": JSON.stringify({ pages: { "/": { html: "public/index.html", entry: "src/home.cdrca" }, "/about": { html: "public/about.html", entry: "src/about.cdrca" } } }),
      "public/index.html": "<body><h1>home</h1></body>",
      "public/about.html": "<body><h1>about</h1></body>",
      "public/secret.html": "<body>x</body>",
      "src/home.cdrca": scene("Home", CUBE("cubeHome")),
      "src/about.cdrca": scene("About", CUBE("cubeAbout")),
    }));
    const home = await get(S2.base, "/");
    const about = await get(S2.base, "/about/");
    assert.match(home.text, /home<\/h1>[\s\S]*src="\/src\/home\.cdrca\.js"/);
    assert.match(about.text, /about<\/h1>[\s\S]*src="\/src\/about\.cdrca\.js"/);
    assert.ok(!about.text.includes("home.cdrca.js"));
    assert.strictEqual((await get(S2.base, "/secret")).status, 404);
    assert.match((await get(S2.base, "/about.html")).text, /about<\/h1>/, "public/ files are still reachable by file name");
    await S2.close();
  });

  await test("layout errors in cdrca.json are reported as a 500 that says what is wrong, not a crash", async () => {
    const S2 = await serve(project({ "cdrca.json": JSON.stringify({ html: "../oops.html" }) }));
    const r = await get(S2.base, "/");
    assert.strictEqual(r.status, 500);
    assert.match(r.text, /'html'.*inside the project/);
    await S2.close();
  });

  await test("a page whose html file is missing says so", async () => {
    const S2 = await serve(project({ "cdrca.json": JSON.stringify({ html: "public/index.html" }) }));
    const r = await get(S2.base, "/");
    assert.strictEqual(r.status, 500);
    assert.match(r.text, /page '\/' points at 'public\/index\.html', which can't be read/);
    await S2.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
