// animations-backdrop.js — the runtime behind the `background` statement
// (part of the `animations` plugin; see Back-end/Transpiler/Plugins/
// animations/plugin.js and docs/guides/ANIMATIONS-SYNTAX.md).
//
//   background                                whole page, this file's scene
//   background heroSection                    that element, this file's scene
//   background from "bg.cdrca"                whole page, bg.cdrca's scene
//   background heroSection from "bg.cdrca"    that element, bg.cdrca's scene
//
// Two jobs, both plain DOM/CSS:
//
//   place(targetId)   puts a <canvas> BEHIND the content of the page
//                     (targetId null) or of one element, sized to fill it.
//                     Renderer.js calls this for the first two forms.
//   attach(targetId, moduleUrl)
//                     place() + load an ES module and hand it the canvas.
//                     The last two forms use this: the project server
//                     compiles bg.cdrca into such a module.
//
// Whole page: the canvas is `position: fixed; inset: 0; z-index: -1`.
// One element: the element becomes the positioning context (`position:
// relative` unless it already has one) and the canvas is an absolutely
// positioned first child at 100% x 100%, so it scrolls, resizes and clips
// with the element using nothing but CSS containment.
//
// Both make the host its own stacking context (`isolation: isolate`). That
// is what keeps a z-index of -1 ABOVE the host's own background colour but
// BELOW its content; without it, any element that has a background hides
// its backdrop completely.
//
// Loaded on every page — no `@useLib` needed. A generic plugin has no way
// to ask the CLI for an "always loaded" script, so the runtime page and the
// project server both include this file unconditionally.

(function (global) {
  "use strict";

  var PAGE_KEY = "(page)";
  var attached = Object.create(null); // key -> { canvas, dispose }

  function keyFor(targetId) {
    return targetId || PAGE_KEY;
  }

  function label(targetId) {
    return targetId ? 'element "' + targetId + '"' : "the page";
  }

  function getDoc() {
    return typeof global.document !== "undefined" ? global.document : null;
  }

  // How big is the host, and how do I hear about it changing?
  function sizing(host, page) {
    return {
      size: function () {
        var w = page ? global.innerWidth : host.clientWidth;
        var h = page ? global.innerHeight : host.clientHeight;
        return { width: Math.max(1, w | 0), height: Math.max(1, h | 0) };
      },
      // Returns a function that stops watching.
      watch: function (onResize) {
        if (!page && typeof global.ResizeObserver === "function") {
          // An element can change size without the window changing at all
          // (its content grows, a sibling collapses), so watch it directly.
          var observer = new global.ResizeObserver(function () {
            onResize();
          });
          observer.observe(host);
          return function () {
            observer.disconnect();
          };
        }
        if (typeof global.addEventListener === "function") {
          global.addEventListener("resize", onResize);
        }
        return function () {
          if (typeof global.removeEventListener === "function") {
            global.removeEventListener("resize", onResize);
          }
        };
      },
    };
  }

  // Wrap an already-placed canvas + its host in the size()/watch() handle
  // Renderer.js uses. attach()'s module factory receives (canvas, host); when
  // the compiled program starts its own renderer it hands those back here.
  function adopt(canvas, host) {
    var page = canvas.getAttribute("data-backdrop-for") === "page";
    var s = sizing(host, page);
    return {
      canvas: canvas,
      host: host,
      page: page,
      size: s.size,
      watch: s.watch,
    };
  }

  // Create the canvas and put it behind the content of the page or of one
  // element. Returns an adopt()-style handle, or null (after a warning) if
  // there is nothing to put it in.
  function place(targetId) {
    var doc = getDoc();
    if (!doc) return null;

    var page = !targetId;
    var host = page ? doc.body : doc.getElementById(targetId);
    if (!host) {
      console.warn(
        page
          ? "backdrop: document.body doesn't exist yet — load your .cdrca script at the end of <body> (or with 'defer')."
          : 'backdrop: no element with id "' + targetId + '" — the background did nothing. ' +
              "Load your .cdrca script at the end of <body> (or with 'defer') so it exists by then."
      );
      return null;
    }

    var canvas = doc.createElement("canvas");
    canvas.setAttribute("data-backdrop-for", page ? "page" : targetId);

    if (!page) {
      var computed = global.getComputedStyle
        ? global.getComputedStyle(host).position
        : host.style.position;
      if (!computed || computed === "static") host.style.position = "relative";
    }
    host.style.isolation = "isolate";

    canvas.style.position = page ? "fixed" : "absolute";
    canvas.style.inset = "0";
    canvas.style.zIndex = "-1";
    canvas.style.pointerEvents = "none";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.insertBefore(canvas, host.firstChild);

    return adopt(canvas, host);
  }

  // A relative module path means "relative to the PAGE". import() would
  // otherwise resolve it against THIS script's own URL (deep inside the
  // runtime's folder), which is never what a project author means.
  function resolveAgainstPage(spec) {
    var doc = getDoc();
    var base = doc && (doc.baseURI || (global.location && global.location.href));
    if (!base || !/^(\.\.?\/|[A-Za-z0-9_-])/.test(spec) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)) {
      return spec;
    }
    try {
      return new URL(spec, base).href;
    } catch (e) {
      return spec;
    }
  }

  // Where the project server (or a built site) serves the compiled module
  // for `<projectRelativePath>` (a .cdrca file). Kept here, not in the
  // plugin, so the compiled program carries only the project path.
  function programUrl(projectRelativePath) {
    return resolveAgainstPage("__cdrca/bg/" + projectRelativePath + ".js");
  }

  function attach(targetId, modulePath) {
    var handle = null;
    var doc = getDoc();
    if (!doc) return Promise.resolve();

    // Re-attaching replaces whatever was there — never two canvases stacked.
    detach(targetId);

    handle = place(targetId);
    if (!handle) return Promise.resolve();
    var canvas = handle.canvas;

    return Backdrop._importModule(resolveAgainstPage(modulePath))
      .then(function (mod) {
        var factory = mod && (mod.default || mod.mount || mod.init);
        if (typeof factory !== "function") {
          console.warn(
            'backdrop: module "' + modulePath + "\" doesn't export a default function (or .mount/.init) — nothing to run."
          );
          return;
        }
        var dispose = factory(canvas, handle.host);
        attached[keyFor(targetId)] = {
          canvas: canvas,
          dispose: typeof dispose === "function" ? dispose : null,
        };
      })
      .catch(function (err) {
        console.warn(
          'backdrop: failed to load module "' + modulePath + '": ' + (err && err.message)
        );
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      });
  }

  function detach(targetId) {
    var entry = attached[keyFor(targetId)];
    if (!entry) return;
    if (entry.dispose) {
      try {
        entry.dispose();
      } catch (err) {
        console.warn("backdrop: dispose() for " + label(targetId) + " threw", err);
      }
    }
    if (entry.canvas && entry.canvas.parentNode) {
      entry.canvas.parentNode.removeChild(entry.canvas);
    }
    delete attached[keyFor(targetId)];
  }

  var Backdrop = {
    place: place,
    adopt: adopt,
    attach: attach,
    detach: detach,
    programUrl: programUrl,
    _attached: attached,
    // A real seam, not just for tests: dynamic import() needs a genuine
    // ES-module-capable loader underneath it, which differs between a
    // browser and a bundler's own module resolution.
    _importModule: function (path) {
      return import(path);
    },
  };

  global.Backdrop = Backdrop;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
