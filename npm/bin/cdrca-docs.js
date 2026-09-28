#!/usr/bin/env node
// cdrca-docs.js — `cdrca12 docs [topic]`. Every guide, reference doc and
// example ships inside this package (npm/docs/, synced from the main repo by
// tools/sync-npm-docs.js before each publish), so it works offline and always
// matches the installed version. `--online` fetches the current copy from
// GitHub instead. No dependencies beyond Node's own fs/https.

const fs = require("fs");
const path = require("path");
const https = require("https");

const REPO = "MrGrimJoe/cdrca-ready-for-the-real-world";
const REF = process.env.CDRCA_DOCS_REF || "main";
const DOCS_DIR = path.join(__dirname, "..", "docs");

// name you type -> path inside docs/. Short aliases first (kept from earlier
// versions), then the rest.
const TOPICS = {
  guides: "guides/README.md",
  cli: "guides/CLI-GUIDE.md",
  animations: "guides/ANIMATIONS-SYNTAX.md",
  quark: "guides/QUARK-SYNTAX.md",
  plugins: "guides/PLUGIN-DEVELOPMENT.md",
  layout: "guides/PROJECT-LAYOUT.md",
  style: "guides/SYNTAX-STYLE-GUIDE.md",
  syntax: "SYNTAX.md",
  "quark-reference": "QUARK.md",
  "reactive-state": "REACTIVE-STATE.md",
  commands: "CLI-COMMANDS.md",
  manifest: "MANIFEST-SPEC.md",
  libraries: "PLUGIN-LIBRARIES.md",
  permissions: "PLUGIN-PERMISSIONS.md",
  architecture: "ARCHITECTURE.md",
  licensing: "LICENSING.md",
  contributing: "CONTRIBUTING.md",
  plan: "design/LANGUAGE-PLAN.md",
  changes: "CHANGES.md",
  ember: "plugins/ember/README.md",
  campfire: "plugins/campfire/README.md",
  "reactive-state-plugin": "plugins/cdrca-reactive-state/README.md",
};
// Runnable examples — the closest thing to tutorials: small complete projects.
const EXAMPLES = {
  "example-ember": "plugins/ember/examples/landing-hero.cdrca",
  "example-campfire": "plugins/campfire/examples/by-the-lake.cdrca",
  "example-todo": "plugins/cdrca-reactive-state/examples/todo-app/main.cdrca",
  "example-todo-page": "plugins/cdrca-reactive-state/examples/todo-app/index.html",
};
const ALL = { ...TOPICS, ...EXAMPLES };

function usage() {
  const row = ([n, p]) => `  ${n.padEnd(22)} ${p}`;
  console.log(
    "\nUsage: cdrca12 docs <topic> [--online]\n       cdrca12 docs --path      (where the bundled docs live)\n\n" +
      "Guides and reference:\n" + Object.entries(TOPICS).map(row).join("\n") +
      "\n\nExamples (complete, runnable):\n" + Object.entries(EXAMPLES).map(row).join("\n") +
      "\n\nYou can also pass any path under docs/, e.g. `cdrca12 docs guides/CLI-GUIDE.md`.\n" +
      "Docs are bundled with this version. --online fetches the latest from https://github.com/" +
      REPO + "/tree/" + REF + "/docs/\n"
  );
}

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
    https.get(url, { headers: { "User-Agent": "cdrca12-docs" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

// Resolve a typed topic or path to a file inside DOCS_DIR (never outside it).
function resolveTopic(input) {
  const key = input.toLowerCase();
  const rel = ALL[key] || input.replace(/\\/g, "/").replace(/^docs\//, "");
  const full = path.resolve(DOCS_DIR, rel);
  if (!full.startsWith(DOCS_DIR + path.sep)) return null;
  return { rel, full };
}

async function run(argv) {
  const online = argv.includes("--online");
  const args = argv.filter((a) => a !== "--online");
  const topic = args[0] || "";

  if (topic === "--path") { console.log(DOCS_DIR); return 0; }
  if (!topic || topic === "--help" || topic === "-h" || topic === "list") { usage(); return 0; }

  const found = resolveTopic(topic);
  if (!found) { console.error(`\ncdrca12: '${topic}' is outside the docs folder.\n`); return 1; }

  if (!online && fs.existsSync(found.full) && fs.statSync(found.full).isFile()) {
    console.log(fs.readFileSync(found.full, "utf8"));
    return 0;
  }
  if (!online && !ALL[topic.toLowerCase()]) {
    console.error(`\ncdrca12: unknown docs topic '${topic}'.\n`);
    usage();
    return 1;
  }

  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/docs/${found.rel}`;
  try {
    console.log(await fetchText(url));
    return 0;
  } catch (err) {
    console.error(`\ncdrca12: couldn't ${online ? "fetch" : "find locally, then fetch"} '${topic}' (${err.message}).\nTry: ${url}\n`);
    return 1;
  }
}

module.exports = { run, TOPICS, EXAMPLES, REPO, REF, DOCS_DIR };

if (require.main === module) run(process.argv.slice(2)).then((code) => process.exit(code));
