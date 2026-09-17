#!/usr/bin/env node
// cdrca-docs.js — fetches and prints a guide from the main repo's own
// docs/guides/ folder. Deliberately not bundled: this package ships zero
// copies of the actual guide content (see npm/docs/*.md — those are
// one-paragraph pointers, not the guides themselves). Every real word of
// documentation lives in, and is fetched live from,
// github.com/MrGrimJoe/cdrca-ready-for-the-real-world. That's
// intentional, not a limitation to work around: this package is a thin
// wrapper around that repo (same as the binary itself, which
// install.js downloads from that repo's Releases on every install) —
// if that repo goes away, both the binary and the docs stop working, on
// purpose. See docs/guides/README.md in the main repo for why.
//
// No dependencies beyond Node's own https -- same "stay a thin wrapper"
// rule install.js follows.

const https = require("https");

const REPO = "MrGrimJoe/cdrca-ready-for-the-real-world";
// The branch these guides are fetched from. Override with
// CDRCA_DOCS_REF if the main repo's default branch ever changes, or to
// pin a specific tag while testing an unreleased guide.
const REF = process.env.CDRCA_DOCS_REF || "main";

// name you type -> path inside docs/ on the main repo
const TOPICS = {
  cli: "guides/CLI-GUIDE.md",
  animations: "guides/ANIMATIONS-SYNTAX.md",
  quark: "guides/QUARK-SYNTAX.md",
  plugins: "guides/PLUGIN-DEVELOPMENT.md",
  guides: "guides/README.md",
};

function usage() {
  console.log(
    "\nUsage: cdrca12 docs <topic>\n\n" +
      "Fetches the real guide live from the main repo -- this package never\n" +
      "bundles a copy of its own.\n\n" +
      "Topics:\n" +
      Object.entries(TOPICS)
        .map(([name, p]) => `  ${name.padEnd(11)} ${p}`)
        .join("\n") +
      "\n\nOnline: https://github.com/" +
      REPO +
      "/tree/" +
      REF +
      "/docs/\n"
  );
}

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      reject(new Error("too many redirects"));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "cdrca12-docs" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          fetchText(res.headers.location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

async function run(argv) {
  const topic = (argv[0] || "").toLowerCase();

  if (!topic || topic === "--help" || topic === "-h") {
    usage();
    return 0;
  }

  const relPath = TOPICS[topic];
  if (!relPath) {
    console.error(`\ncdrca12: unknown docs topic '${topic}'.\n`);
    usage();
    return 1;
  }

  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/docs/${relPath}`;

  try {
    const text = await fetchText(url);
    console.log(text);
    return 0;
  } catch (err) {
    console.error(
      `\ncdrca12: couldn't fetch the '${topic}' guide (${err.message}).\n\n` +
        "This package doesn't bundle guide content locally by design -- it's\n" +
        "always fetched live from the main repo. That fetch just failed, which\n" +
        "usually means no network right now, or the main repo/branch changed.\n\n" +
        `Read it directly instead: ${url}\n`
    );
    return 1;
  }
}

module.exports = { run, TOPICS, REPO, REF };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
