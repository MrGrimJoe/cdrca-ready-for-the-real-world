// campfire-ui.js — an opt-in default visual layer for campfire
// (`@useLib campfire.ui`), loaded only when a project wants it. Not
// required — campfire-core.js (`@useLib campfire.core`) is a complete,
// working dialogue engine on its own; this bundle is just one listener
// on its public events (see campfire-core.js's header comment), built
// entirely through Campfire.on(...)/Campfire.advance()/
// Campfire.resolveChoice(...) — nothing in here reaches into core's
// internals, so it's a real, faithful example of what a from-scratch
// alternate UI would also do.
//
// A fireside-themed dialogue box, pinned to the bottom of the screen:
// speaker name in their own color, a typewriter reveal for each line,
// click/space/enter to continue, and animated buttons for choices. This
// is deliberately the *charm* half of the plugin — campfire-core.js is
// the correctness half.
//
// Follows the same "guard-check the namespace you depend on" pattern
// this plugin ecosystem's own library-bundle template uses.

(function (global) {
  "use strict";

  const Campfire = global.Campfire;
  if (!Campfire) {
    console.error("campfire-ui.js: campfire-core.js must be loaded first (add @useLib campfire.core).");
    return;
  }

  const doc = global.document;
  if (!doc) return; // no DOM (e.g. loaded in a non-browser test) — nothing to do.

  // ---------------------------------------------------------------
  // One-time DOM + style injection
  // ---------------------------------------------------------------

  const STYLE = `
#campfire-box {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  width: min(680px, 92vw);
  background: linear-gradient(180deg, #201a14 0%, #17120d 100%);
  border: 1px solid #4a3b28;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(255,159,67,.06) inset;
  padding: 18px 22px;
  font-family: Georgia, "Iowan Old Style", serif;
  color: #f2e6d3;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
  cursor: pointer;
  z-index: 9999;
}
#campfire-box.campfire-visible { opacity: 1; pointer-events: auto; }
#campfire-box .campfire-speaker {
  font-weight: 700;
  font-size: 0.95em;
  letter-spacing: .02em;
  margin-bottom: 6px;
  text-shadow: 0 0 10px currentColor;
}
#campfire-box .campfire-text {
  font-size: 1.08em;
  line-height: 1.5;
  min-height: 1.5em;
}
#campfire-box .campfire-hint {
  margin-top: 10px;
  font-size: 0.75em;
  opacity: .55;
  font-style: italic;
}
#campfire-box .campfire-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
#campfire-box .campfire-option {
  text-align: left;
  background: #2b2118;
  border: 1px solid #5a4630;
  color: #f2e6d3;
  border-radius: 8px;
  padding: 9px 14px;
  font: inherit;
  font-size: 0.98em;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
#campfire-box .campfire-option:hover {
  background: #3a2c1c;
  border-color: #d98a3b;
  transform: translateX(2px);
}
`;

  function ensureMounted() {
    if (doc.getElementById("campfire-box")) return;

    const style = doc.createElement("style");
    style.setAttribute("data-campfire", "");
    style.textContent = STYLE;
    doc.head.appendChild(style);

    const box = doc.createElement("div");
    box.id = "campfire-box";
    box.innerHTML =
      '<div class="campfire-speaker"></div>' +
      '<div class="campfire-text"></div>' +
      '<div class="campfire-options" hidden></div>' +
      '<div class="campfire-hint">click to continue</div>';
    doc.body.appendChild(box);

    box.addEventListener("click", (e) => {
      // Don't advance if the click landed on a choice button — that
      // button's own handler calls resolveChoice(), advancing would
      // double-fire.
      if (e.target.closest(".campfire-option")) return;
      Campfire.advance();
    });

    doc.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") Campfire.advance();
    });
  }

  // ---------------------------------------------------------------
  // Typewriter reveal — cancellable, so a fast reader clicking through
  // lines quickly never leaves two reveals racing each other.
  // ---------------------------------------------------------------

  let typewriterTimer = null;

  function typewriter(el, text, speedMs) {
    if (typewriterTimer !== null) {
      global.clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    el.textContent = "";
    let i = 0;
    typewriterTimer = global.setInterval(() => {
      el.textContent += text[i];
      i++;
      if (i >= text.length) {
        global.clearInterval(typewriterTimer);
        typewriterTimer = null;
      }
    }, speedMs);
  }

  // ---------------------------------------------------------------
  // Wire up to campfire-core.js's events
  // ---------------------------------------------------------------

  ensureMounted();

  Campfire.on("line", ({ speaker, text }) => {
    const box = doc.getElementById("campfire-box");
    box.classList.add("campfire-visible");
    box.querySelector(".campfire-speaker").textContent = speaker.name;
    box.querySelector(".campfire-speaker").style.color = speaker.color;
    box.querySelector(".campfire-options").hidden = true;
    box.querySelector(".campfire-hint").hidden = false;
    typewriter(box.querySelector(".campfire-text"), text, 18);
  });

  Campfire.on("choice", ({ speaker, prompt, options }) => {
    const box = doc.getElementById("campfire-box");
    box.classList.add("campfire-visible");
    box.querySelector(".campfire-speaker").textContent = speaker.name;
    box.querySelector(".campfire-speaker").style.color = speaker.color;
    box.querySelector(".campfire-hint").hidden = true;
    typewriter(box.querySelector(".campfire-text"), prompt, 18);

    const optionsEl = box.querySelector(".campfire-options");
    optionsEl.innerHTML = "";
    optionsEl.hidden = false;
    options.forEach((opt) => {
      const btn = doc.createElement("button");
      btn.className = "campfire-option";
      btn.type = "button";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => Campfire.resolveChoice(opt.signal));
      optionsEl.appendChild(btn);
    });
  });
})(typeof window !== "undefined" ? window : this);
