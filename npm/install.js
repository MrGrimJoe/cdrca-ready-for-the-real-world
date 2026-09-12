#!/usr/bin/env node
// Downloads the prebuilt cdrca.exe for this package's exact version from
// GitHub Releases. No dependencies beyond Node's own https/fs -- this is
// meant to stay a thin wrapper, not grow a dependency tree of its own.
//
// Windows-only right now: CI (.github/workflows/release.yml in the main
// repo) only builds a Windows binary. package.json's "os": ["win32"]
// already makes npm refuse the install on other platforms before this
// script ever runs, but this check stays too -- defense in depth, and a
// clearer message than npm's generic "Unsupported platform" if it's ever
// bypassed (--force, --ignore-scripts games, a future npm behavior
// change, etc).

const fs = require("fs");
const https = require("https");
const path = require("path");

const pkg = require("./package.json");
const REPO = "MrGrimJoe/cdrca-ready-for-the-real-world";
const DIST_DIR = path.join(__dirname, "dist");
const DEST = path.join(DIST_DIR, "cdrca.exe");

function fail(message) {
  console.error(`\ncdrca12: ${message}\n`);
  process.exit(1);
}

if (process.platform !== "win32") {
  fail(
    "no prebuilt binary is available for your platform yet -- only Windows " +
      "builds exist right now. Build from source instead: " +
      `see https://github.com/${REPO}#build`
  );
}

// GitHub redirects release-asset downloads through its CDN (typically two
// hops: api/github release page -> objects.githubusercontent.com). Follow
// redirects manually rather than pulling in a request library for it.
function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      reject(new Error("too many redirects"));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "cdrca12-postinstall" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume(); // discard this response body
          download(res.headers.location, destPath, redirectsLeft - 1).then(
            resolve,
            reject
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new Error(`HTTP ${res.statusCode} fetching ${url}`)
          );
          return;
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(resolve));
        fileStream.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const tag = `v${pkg.version}`;
  const url = `https://github.com/${REPO}/releases/download/${tag}/cdrca-win32-x64.exe`;

  console.log(`cdrca12: downloading cdrca.exe (${tag}) ...`);
  try {
    await download(url, DEST);
  } catch (err) {
    fail(
      `couldn't download the prebuilt binary from ${url} (${err.message}). ` +
        `Check https://github.com/${REPO}/releases/tag/${tag} exists and has ` +
        "a cdrca-win32-x64.exe asset attached."
    );
  }

  const stat = fs.statSync(DEST);
  if (stat.size === 0) {
    fs.unlinkSync(DEST);
    fail("downloaded file was empty -- the release asset may be missing or corrupt.");
  }

  console.log("cdrca12: done.");
}

main();
