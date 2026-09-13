// Quark component library — registers every built-in component into
// Quark.components (see quark-core.js). Adding a NEW component means
// calling Quark.components.register({...}) once, here or in any file
// loaded after quark-core.js — never touching the parser, quark-core.js,
// or the directive grammar.
//
// Every component follows the same shape:
//   base(ctx)                    -- structural CSS/DOM, always runs
//   variants: { name: {css} | fn }  -- one visual treatment, picked by the
//                                      directive's first modifier token
//   modifiers: { name: {css,behavior} }  -- opt-in extras, stack in order
//   mount(ctx) / unmount(ctx)    -- optional extra lifecycle logic
//   parts: [...]                 -- documented sub-part convention
//
// This keeps variants from becoming duplicated component implementations
// (navbarModern(), navbarGlass(), ... with copy-pasted structure) — each
// variant is just a CSS string (or a small function) layered on top of one
// shared `base`.

(function (global) {
  "use strict";

  const Quark = global.Quark;
  if (!Quark || !Quark.components) {
    console.error("Quark component library: quark-core.js must be loaded first.");
    return;
  }

  const T = Quark.tokens;
  const register = Quark.components.register;

  // -----------------------------------------------------------------
  // Shared helpers reused across several components' base()/variants.
  // -----------------------------------------------------------------

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia
      ? () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : () => false;

  function transitionCss(prop = "all") {
    return reducedMotion() ? "" : `transition: ${prop} var(--quark-transition-normal, 200ms ease);`;
  }

  function focusRingCss(selector = "a, button, [tabindex]") {
    return `
      ${selector} { outline: none; }
      ${selector}:focus-visible {
        outline: 2px solid var(--quark-accent, #2563eb);
        outline-offset: 2px;
      }
    `;
  }

  // Generic escape-to-close + focus trap for overlay-style components
  // (modal, dropdown, popover). Kept intentionally small.
  function attachEscapeClose(el, onClose) {
    function handler(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }

  function trapFocus(el) {
    const focusable = el.querySelectorAll(
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return () => {};
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    function handler(e) {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    el.addEventListener("keydown", handler);
    first.focus();
    return () => el.removeEventListener("keydown", handler);
  }

  // =====================================================================
  // LAYOUT / NAVIGATION
  // =====================================================================

  register({
    name: "navbar",
    defaultVariant: "modern",
    parts: ["brand", "navigation", "actions", "mobileMenu"],
    docs: {
      description: "A horizontal navigation bar enhancing an existing header-like element.",
      expectedHtml:
        '<div id="mainNav"><div class="brand">...</div><nav>...</nav></div>',
      example: "@mainNav navbar.glass",
    },
    base(ctx) {
      ctx.css(`
        display: flex; align-items: center; justify-content: space-between;
        padding: var(--quark-space-md) var(--quark-space-lg);
        font-family: var(--quark-font-sans);
        ${transitionCss("background,box-shadow,transform")}
      `);
      ctx.css(`nav { display: flex; gap: var(--quark-space-md); align-items: center; }`, "nav-layout");
      ctx.css(focusRingCss(), "focus");
    },
    variants: {
      modern: {
        css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-sm);`,
      },
      glass: {
        css: `
          background: var(--quark-surface-glass);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          border-bottom: var(--quark-border-hairline);
        `,
      },
      minimal: {
        css: `background: transparent; box-shadow: none;`,
      },
      floating: {
        css: `
          margin: var(--quark-space-md); border-radius: var(--quark-radius-lg);
          background: var(--quark-surface-light); box-shadow: var(--quark-shadow-md);
        `,
      },
      compact: {
        css: `padding: var(--quark-space-sm) var(--quark-space-md);`,
      },
      enterprise: {
        css: `
          background: var(--quark-surface-dark); color: #fff;
          border-bottom: 3px solid var(--quark-accent, #2563eb);
        `,
      },
      dark: {
        css: `background: var(--quark-surface-dark); color: #f2f2f2;`,
      },
    },
    modifiers: {
      sticky: { css: `position: sticky; top: 0; z-index: 40;` },
      fixed: { css: `position: fixed; top: 0; left: 0; right: 0; z-index: 40;` },
      centered: {
        css: `nav { margin: 0 auto; }`,
      },
      "full-width": { css: `width: 100%;` },
      bordered: { css: `border: var(--quark-border-hairline);` },
      elevated: { css: `box-shadow: var(--quark-shadow-md);` },
    },
    mount(ctx) {
      // Mobile-friendly collapse: only activates if a mobileMenu part or a
      // <nav> child exists — never assumes a fixed child index.
      const nav = ctx.part("navigation") || ctx.el.querySelector("nav");
      if (!nav) return;
      const mq = typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(max-width: 720px)")
        : null;
      if (!mq) return;
      const applyResponsive = () => {
        nav.style.display = mq.matches ? "none" : "";
      };
      applyResponsive();
      mq.addEventListener ? mq.addEventListener("change", applyResponsive) : mq.addListener(applyResponsive);
    },
  });

  register({
    name: "sidebar",
    defaultVariant: null, // no declared variants -> preserves ORIGINAL behavior exactly:
    variants: {},         // every ".token" stays a plain modifier, nothing is consumed as a variant.
    parts: ["header", "navigation", "footer"],
    docs: {
      description: "A vertical, fixed-position navigation panel.",
      expectedHtml: '<div id="sidebar"><div class="logo">...</div><div class="navigation">...</div></div>',
      example: "@sidebar sidebar.closable.edgy = #2563eb",
    },
    base(ctx) {
      ctx.css(`
        position: fixed; top: 0; left: 0; height: 100%; width: 260px;
        background: var(--quark-accent, #1e2327);
        ${transitionCss("transform")}
      `);
    },
    modifiers: {
      edgy: { css: `border-radius: 0;` },
      rounded: { css: `border-radius: 0 var(--quark-radius-lg) var(--quark-radius-lg) 0;` },
      compact: { css: `width: 180px;` },
      closable: {
        behavior: (ctx) => {
          const btn = document.createElement("span");
          btn.textContent = "\u2715";
          btn.setAttribute("role", "button");
          btn.setAttribute("aria-label", "Close sidebar");
          btn.tabIndex = 0;
          btn.style.cssText = "position:absolute;top:8px;right:8px;cursor:pointer;";
          const toggle = () => ctx.el.classList.toggle("quark-closed");
          btn.onclick = toggle;
          btn.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") toggle();
          };
          ctx.el.appendChild(btn);
          ctx.css(`&.quark-closed { transform: translateX(-100%); }`, "closable-state");
          ctx.addCleanup(() => btn.remove());
        },
      },
      // non-closable remains the default — matches "some sidebars are
      // non-closeable by design," unchanged from the original preset.
    },
  });

  register({
    name: "tabs",
    defaultVariant: "modern",
    parts: ["tablist", "panels"],
    docs: {
      description: "Enhances a list of tab-like children with switching behavior.",
      expectedHtml: '<div id="tabs"><div class="tablist"><button>One</button><button>Two</button></div></div>',
      example: "@tabs tabs.pill",
    },
    base(ctx) {
      const tablist = ctx.part("tablist") || ctx.el;
      ctx.css(`
        [role="tablist"] { display: flex; gap: var(--quark-space-sm); }
        [role="tab"] {
          padding: var(--quark-space-sm) var(--quark-space-md); cursor: pointer;
          border: none; background: transparent; font: inherit;
          ${transitionCss("background,color")}
        }
        [role="tab"][aria-selected="true"] { color: var(--quark-accent, #2563eb); font-weight: var(--quark-font-weightMedium); }
      `);
      ctx.css(focusRingCss('[role="tab"]'), "focus");

      const buttons = Array.from(tablist.children).filter((c) => c.tagName === "BUTTON" || c.getAttribute("role") === "tab");
      tablist.setAttribute("role", "tablist");
      buttons.forEach((btn, i) => {
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
        btn.tabIndex = i === 0 ? 0 : -1;
        btn.addEventListener("click", () => {
          buttons.forEach((b) => {
            b.setAttribute("aria-selected", "false");
            b.tabIndex = -1;
          });
          btn.setAttribute("aria-selected", "true");
          btn.tabIndex = 0;
        });
      });
    },
    variants: {
      modern: { css: `[role="tablist"] { border-bottom: var(--quark-border-hairline); }` },
      pill: {
        css: `
          [role="tablist"] { background: rgba(0,0,0,.05); padding: 4px; border-radius: var(--quark-radius-pill); }
          [role="tab"] { border-radius: var(--quark-radius-pill); }
          [role="tab"][aria-selected="true"] { background: var(--quark-surface-light); }
        `,
      },
      minimal: { css: `[role="tablist"] { border-bottom: none; }` },
    },
    modifiers: {
      centered: { css: `[role="tablist"] { justify-content: center; }` },
      "full-width": { css: `[role="tablist"] { width: 100%; } [role="tab"] { flex: 1; }` },
    },
  });

  register({
    name: "breadcrumb",
    defaultVariant: "modern",
    docs: {
      description: "Enhances a list of links representing a navigation path.",
      expectedHtml: '<div id="crumbs"><a href="/">Home</a><a href="/docs">Docs</a></div>',
      example: "@crumbs breadcrumb.minimal",
    },
    base(ctx) {
      ctx.css(`display: flex; align-items: center; gap: var(--quark-space-sm); font-size: var(--quark-font-sizeSm);`);
      const links = Array.from(ctx.el.querySelectorAll("a"));
      links.forEach((a, i) => {
        if (i > 0 && !a.previousElementSibling?.classList?.contains("quark-crumb-sep")) {
          const sep = document.createElement("span");
          sep.className = "quark-crumb-sep";
          sep.setAttribute("aria-hidden", "true");
          sep.textContent = "/";
          a.parentNode.insertBefore(sep, a);
        }
        if (i === links.length - 1) a.setAttribute("aria-current", "page");
      });
      ctx.css(`.quark-crumb-sep { opacity: .5; }`, "sep");
    },
    variants: {
      modern: { css: `` },
      minimal: { css: `.quark-crumb-sep { opacity: .3; }` },
    },
  });

  register({
    name: "pagination",
    defaultVariant: "modern",
    docs: {
      description: "Enhances a row of page-number/prev-next links or buttons.",
      expectedHtml: '<div id="pages"><button>Prev</button><button>1</button><button>2</button><button>Next</button></div>',
      example: "@pages pagination.pill",
    },
    base(ctx) {
      ctx.css(`display: flex; gap: var(--quark-space-xs); align-items: center;`);
      ctx.css(`button { border: var(--quark-border-hairline); background: var(--quark-surface-light); padding: var(--quark-space-xs) var(--quark-space-sm); cursor: pointer; ${transitionCss("background")} }`, "buttons");
      ctx.css(focusRingCss("button"), "focus");
    },
    variants: {
      modern: { css: `button { border-radius: var(--quark-radius-sm); }` },
      pill: { css: `button { border-radius: var(--quark-radius-pill); }` },
      minimal: { css: `button { border: none; background: transparent; }` },
    },
  });

  // =====================================================================
  // CONTENT
  // =====================================================================

  register({
    name: "card",
    defaultVariant: "modern",
    parts: ["header", "body", "footer"],
    docs: {
      description: "Enhances a content block (heading + body + optional actions) into a card surface.",
      expectedHtml: '<div id="profileCard"><h2>Profile</h2><p>...</p><button>Edit</button></div>',
      example: "@profileCard card.elevated",
    },
    base(ctx) {
      ctx.css(`
        padding: var(--quark-space-lg); border-radius: var(--quark-radius-md);
        ${transitionCss("box-shadow,transform")}
      `);
    },
    variants: {
      modern: { css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-sm);` },
      elevated: { css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-lg);` },
      flat: { css: `background: var(--quark-surface-light); box-shadow: none; border: var(--quark-border-hairline);` },
      outlined: { css: `background: transparent; border: var(--quark-border-hairline);` },
      glass: {
        css: `background: var(--quark-surface-glass); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);`,
      },
      soft: { css: `background: rgba(0,0,0,.03); box-shadow: none;` },
    },
    modifiers: {
      bordered: { css: `border: var(--quark-border-hairline);` },
      rounded: { css: `border-radius: var(--quark-radius-lg);` },
      sharp: { css: `border-radius: 0;` },
      compact: { css: `padding: var(--quark-space-sm);` },
      spacious: { css: `padding: var(--quark-space-xl);` },
      interactive: {
        css: `cursor: pointer;`,
        behavior: (ctx) => {
          ctx.css(`&:hover { transform: translateY(-2px); box-shadow: var(--quark-shadow-md); }`, "interactive-hover");
        },
      },
    },
  });

  register({
    name: "badge",
    defaultVariant: "solid",
    docs: {
      description: "Enhances a short inline label element.",
      expectedHtml: '<span id="statusBadge">Active</span>',
      example: "@statusBadge badge.outlined",
    },
    base(ctx) {
      ctx.css(`
        display: inline-flex; align-items: center; padding: 2px var(--quark-space-sm);
        border-radius: var(--quark-radius-sm); font-size: var(--quark-font-sizeSm);
        font-weight: var(--quark-font-weightMedium);
      `);
    },
    variants: {
      solid: { css: `background: var(--quark-accent, #2563eb); color: #fff;` },
      outlined: { css: `background: transparent; border: 1px solid var(--quark-accent, #2563eb); color: var(--quark-accent, #2563eb);` },
      soft: { css: `background: color-mix(in srgb, var(--quark-accent, #2563eb) 15%, transparent); color: var(--quark-accent, #2563eb);` },
    },
    modifiers: {
      pill: { css: `border-radius: var(--quark-radius-pill);` },
      dense: { css: `padding: 0 6px; font-size: 11px;` },
    },
  });

  register({
    name: "avatar",
    defaultVariant: "circle",
    docs: {
      description: "Enhances an image or initials element representing a user.",
      expectedHtml: '<img id="userAvatar" src="..." />  or  <div id="userAvatar">JD</div>',
      example: "@userAvatar avatar.rounded",
    },
    base(ctx) {
      ctx.css(`
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; overflow: hidden; object-fit: cover;
        background: var(--quark-surface-dark); color: #fff; font-size: var(--quark-font-sizeSm);
      `);
    },
    variants: {
      circle: { css: `border-radius: 50%;` },
      rounded: { css: `border-radius: var(--quark-radius-md);` },
      sharp: { css: `border-radius: 0;` },
    },
    modifiers: {
      bordered: { css: `box-shadow: 0 0 0 2px var(--quark-surface-light), 0 0 0 3px var(--quark-accent, #2563eb);` },
      sm: { css: `width: 28px; height: 28px;` },
      lg: { css: `width: 56px; height: 56px;` },
    },
  });

  register({
    name: "alert",
    defaultVariant: "info",
    parts: ["icon", "content"],
    docs: {
      description: "Enhances a message block into a styled alert.",
      expectedHtml: '<div id="formAlert">Saved successfully.</div>',
      example: "@formAlert alert.success",
    },
    base(ctx) {
      ctx.css(`
        padding: var(--quark-space-md); border-radius: var(--quark-radius-md);
        display: flex; align-items: flex-start; gap: var(--quark-space-sm);
        font-size: var(--quark-font-sizeMd);
      `);
      ctx.el.setAttribute("role", "alert");
    },
    variants: {
      info: { css: `background: rgba(37,99,235,.08); color: #1e3a8a; border: 1px solid rgba(37,99,235,.25);` },
      success: { css: `background: rgba(22,163,74,.08); color: #14532d; border: 1px solid rgba(22,163,74,.25);` },
      warning: { css: `background: rgba(217,119,6,.1); color: #78350f; border: 1px solid rgba(217,119,6,.25);` },
      danger: { css: `background: rgba(220,38,38,.08); color: #7f1d1d; border: 1px solid rgba(220,38,38,.25);` },
    },
    modifiers: {
      dismissible: {
        behavior: (ctx) => {
          const btn = document.createElement("button");
          btn.textContent = "\u2715";
          btn.setAttribute("aria-label", "Dismiss");
          btn.style.cssText = "margin-left:auto;background:none;border:none;cursor:pointer;";
          btn.onclick = () => ctx.el.remove();
          ctx.el.appendChild(btn);
          ctx.addCleanup(() => btn.remove());
        },
      },
      bordered: { css: `border-width: 2px;` },
    },
  });

  register({
    name: "callout",
    defaultVariant: "modern",
    docs: {
      description: "Enhances a highlighted content block, similar to alert but for longer-form emphasis.",
      expectedHtml: '<div id="tip"><strong>Tip:</strong> ...</div>',
      example: "@tip callout.soft",
    },
    base(ctx) {
      ctx.css(`padding: var(--quark-space-lg); border-radius: var(--quark-radius-md); border-left: 4px solid var(--quark-accent, #2563eb);`);
    },
    variants: {
      modern: { css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-sm);` },
      soft: { css: `background: rgba(0,0,0,.03);` },
      editorial: { css: `background: transparent; font-style: italic; border-left-width: 2px;` },
    },
  });

  // =====================================================================
  // FORMS
  // =====================================================================

  register({
    name: "button",
    defaultVariant: "primary",
    docs: {
      description: "Applies consistent visual treatment to an existing <button> or <a> element.",
      expectedHtml: '<button id="loginButton">Log in</button>',
      example: "@loginButton button.outlined",
    },
    base(ctx) {
      ctx.css(`
        display: inline-flex; align-items: center; justify-content: center; gap: var(--quark-space-xs);
        padding: var(--quark-space-sm) var(--quark-space-lg); border-radius: var(--quark-radius-sm);
        font-family: var(--quark-font-sans); font-size: var(--quark-font-sizeMd); font-weight: var(--quark-font-weightMedium);
        cursor: pointer; border: 1px solid transparent;
        ${transitionCss("background,box-shadow,transform")}
      `);
      ctx.css(focusRingCss("&"), "focus");
      ctx.css(`&:disabled { opacity: .5; cursor: not-allowed; }`, "disabled");
    },
    variants: {
      primary: { css: `background: var(--quark-accent, #2563eb); color: #fff;` },
      secondary: { css: `background: rgba(0,0,0,.06); color: inherit;` },
      outlined: { css: `background: transparent; border-color: var(--quark-accent, #2563eb); color: var(--quark-accent, #2563eb);` },
      solid: { css: `background: var(--quark-accent, #2563eb); color: #fff;` },
      soft: { css: `background: color-mix(in srgb, var(--quark-accent, #2563eb) 15%, transparent); color: var(--quark-accent, #2563eb);` },
      flat: { css: `background: transparent; color: var(--quark-accent, #2563eb);` },
    },
    modifiers: {
      pill: { css: `border-radius: var(--quark-radius-pill);` },
      sharp: { css: `border-radius: 0;` },
      compact: { css: `padding: 4px var(--quark-space-sm); font-size: var(--quark-font-sizeSm);` },
      "full-width": { css: `width: 100%;` },
      elevated: { css: `box-shadow: var(--quark-shadow-sm);` },
    },
  });

  register({
    name: "input",
    defaultVariant: "modern",
    docs: {
      description: "Applies consistent visual treatment to an existing <input> element.",
      expectedHtml: '<input id="emailInput" type="email" />',
      example: "@emailInput input.bordered",
    },
    base(ctx) {
      ctx.css(`
        padding: var(--quark-space-sm) var(--quark-space-md); border-radius: var(--quark-radius-sm);
        font-family: var(--quark-font-sans); font-size: var(--quark-font-sizeMd);
        border: 1px solid rgba(0,0,0,.15); ${transitionCss("border-color,box-shadow")}
      `);
      ctx.css(`&:focus { outline: none; border-color: var(--quark-accent, #2563eb); box-shadow: 0 0 0 3px color-mix(in srgb, var(--quark-accent, #2563eb) 20%, transparent); }`, "focus");
      ctx.css(`&:disabled { opacity: .6; cursor: not-allowed; }`, "disabled");
    },
    variants: {
      modern: { css: `background: var(--quark-surface-light);` },
      minimal: { css: `border: none; border-bottom: 1px solid rgba(0,0,0,.2); border-radius: 0;` },
      soft: { css: `background: rgba(0,0,0,.04); border-color: transparent;` },
    },
    modifiers: {
      bordered: { css: `border-width: 2px;` },
      rounded: { css: `border-radius: var(--quark-radius-lg);` },
      "full-width": { css: `width: 100%;` },
    },
  });

  register({
    name: "textarea",
    defaultVariant: "modern",
    docs: { description: "Same treatment family as input, for <textarea>.", expectedHtml: '<textarea id="bio"></textarea>', example: "@bio textarea.soft" },
    base(ctx) {
      ctx.css(`
        padding: var(--quark-space-sm) var(--quark-space-md); border-radius: var(--quark-radius-sm);
        font-family: var(--quark-font-sans); font-size: var(--quark-font-sizeMd);
        border: 1px solid rgba(0,0,0,.15); resize: vertical; ${transitionCss("border-color,box-shadow")}
      `);
      ctx.css(`&:focus { outline: none; border-color: var(--quark-accent, #2563eb); box-shadow: 0 0 0 3px color-mix(in srgb, var(--quark-accent, #2563eb) 20%, transparent); }`, "focus");
    },
    variants: {
      modern: { css: `background: var(--quark-surface-light);` },
      soft: { css: `background: rgba(0,0,0,.04); border-color: transparent;` },
    },
    modifiers: {
      "full-width": { css: `width: 100%;` },
    },
  });

  register({
    name: "select",
    defaultVariant: "modern",
    docs: { description: "Applies consistent visual treatment to an existing <select> element.", expectedHtml: '<select id="country"></select>', example: "@country select.modern" },
    base(ctx) {
      ctx.css(`
        padding: var(--quark-space-sm) var(--quark-space-md); border-radius: var(--quark-radius-sm);
        font-family: var(--quark-font-sans); font-size: var(--quark-font-sizeMd);
        border: 1px solid rgba(0,0,0,.15); background: var(--quark-surface-light);
      `);
      ctx.css(focusRingCss("&"), "focus");
    },
    variants: {
      modern: { css: `` },
      minimal: { css: `border: none; border-bottom: 1px solid rgba(0,0,0,.2); border-radius: 0;` },
    },
  });

  register({
    name: "checkbox",
    defaultVariant: "modern",
    docs: { description: "Applies consistent visual treatment to an existing checkbox <input>.", expectedHtml: '<input id="agree" type="checkbox" />', example: "@agree checkbox.modern" },
    base(ctx) {
      ctx.css(`width: 18px; height: 18px; accent-color: var(--quark-accent, #2563eb); cursor: pointer;`);
      ctx.css(focusRingCss("&"), "focus");
    },
    variants: { modern: { css: `` } },
    modifiers: { lg: { css: `width: 22px; height: 22px;` } },
  });

  register({
    name: "radio",
    defaultVariant: "modern",
    docs: { description: "Applies consistent visual treatment to an existing radio <input>.", expectedHtml: '<input id="planA" type="radio" name="plan" />', example: "@planA radio.modern" },
    base(ctx) {
      ctx.css(`width: 18px; height: 18px; accent-color: var(--quark-accent, #2563eb); cursor: pointer;`);
      ctx.css(focusRingCss("&"), "focus");
    },
    variants: { modern: { css: `` } },
  });

  register({
    name: "toggle",
    defaultVariant: "modern",
    docs: {
      description: "Enhances a checkbox input into a switch-style toggle.",
      expectedHtml: '<input id="darkMode" type="checkbox" />',
      example: "@darkMode toggle.pill",
    },
    base(ctx) {
      ctx.el.style.appearance = "none";
      ctx.el.style.webkitAppearance = "none";
      ctx.css(`
        width: 40px; height: 22px; border-radius: var(--quark-radius-pill);
        background: rgba(0,0,0,.2); position: relative; cursor: pointer;
        ${transitionCss("background")}
      `);
      ctx.css(`&::before {
        content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
        border-radius: 50%; background: #fff; ${transitionCss("transform")}
      }`, "thumb");
      ctx.css(`&:checked { background: var(--quark-accent, #2563eb); }`, "checked");
      ctx.css(`&:checked::before { transform: translateX(18px); }`, "checked-thumb");
    },
    variants: {
      modern: { css: `` },
      pill: { css: `` }, // pill shape is already the base treatment; kept as an explicit alias for clarity
    },
  });

  register({
    name: "form",
    defaultVariant: "modern",
    parts: ["fields", "actions"],
    docs: {
      description: "Applies consistent spacing/layout to an existing <form> and its direct field children.",
      expectedHtml: '<form id="loginForm">...</form>',
      example: "@loginForm form.spacious",
    },
    base(ctx) {
      ctx.css(`display: flex; flex-direction: column; gap: var(--quark-space-md);`);
    },
    variants: {
      modern: { css: `` },
      compact: { css: `gap: var(--quark-space-sm);` },
      spacious: { css: `gap: var(--quark-space-lg);` },
    },
  });

  // =====================================================================
  // OVERLAYS / INTERACTION
  // =====================================================================

  register({
    name: "modal",
    defaultVariant: "modern",
    parts: ["header", "body", "footer"],
    docs: {
      description: "Enhances an existing hidden container into an accessible modal dialog.",
      expectedHtml: '<div id="confirmModal" hidden><h2>Confirm</h2><p>...</p><button>OK</button></div>',
      example: "@confirmModal modal.glass",
    },
    base(ctx) {
      ctx.el.setAttribute("role", "dialog");
      ctx.el.setAttribute("aria-modal", "true");
      ctx.css(`
        position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
        max-width: min(90vw, 480px); padding: var(--quark-space-xl);
        border-radius: var(--quark-radius-lg); z-index: 100;
        ${transitionCss("opacity,transform")}
      `);
      ctx.css(`.quark-overlay-backdrop-${ctx.elementId} {
        position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 99;
      }`, "backdrop-def");
    },
    variants: {
      modern: { css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-lg);` },
      glass: { css: `background: var(--quark-surface-glass); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);` },
      minimal: { css: `background: var(--quark-surface-light); box-shadow: none; border: var(--quark-border-hairline);` },
    },
    modifiers: {
      rounded: { css: `border-radius: var(--quark-radius-lg);` },
      sharp: { css: `border-radius: 0;` },
    },
    mount(ctx) {
      let backdrop = null;
      let releaseTrap = null;
      let releaseEscape = null;

      function open() {
        ctx.el.hidden = false;
        backdrop = document.createElement("div");
        backdrop.className = `quark-overlay-backdrop-${ctx.elementId}`;
        backdrop.addEventListener("click", close);
        document.body.appendChild(backdrop);
        releaseEscape = attachEscapeClose(ctx.el, close);
        releaseTrap = trapFocus(ctx.el);
      }
      function close() {
        ctx.el.hidden = true;
        if (backdrop) backdrop.remove();
        if (releaseEscape) releaseEscape();
        if (releaseTrap) releaseTrap();
      }
      ctx.el.quarkOpen = open;
      ctx.el.quarkClose = close;
      if (!ctx.el.hidden) open();
    },
    unmount(ctx) {
      if (ctx.el.quarkClose) ctx.el.quarkClose();
    },
  });

  register({
    name: "dropdown",
    defaultVariant: "modern",
    parts: ["trigger", "menu"],
    docs: {
      description: "Enhances a trigger + menu pair into a working dropdown.",
      expectedHtml: '<div id="userMenu"><button class="trigger">Account</button><div class="menu"><a href="/profile">Profile</a></div></div>',
      example: "@userMenu dropdown.modern",
    },
    base(ctx) {
      const trigger = ctx.part("trigger") || ctx.el.querySelector("button, a");
      const menu = ctx.part("menu");
      if (!trigger || !menu) {
        console.warn(`Quark: dropdown on #${ctx.elementId} needs a "trigger" and "menu" part`);
        return;
      }
      ctx.css(`position: relative; display: inline-block;`);
      ctx.css(`.menu {
        position: absolute; min-width: 160px; margin-top: var(--quark-space-xs);
        border-radius: var(--quark-radius-sm); display: none; z-index: 50;
        ${transitionCss("opacity")}
      }`, "menu-base");
      ctx.css(`.menu.quark-open { display: block; }`, "menu-open");

      function toggle() {
        menu.classList.toggle("quark-open");
      }
      function closeOnOutside(e) {
        if (!ctx.el.contains(e.target)) menu.classList.remove("quark-open");
      }
      trigger.setAttribute("aria-haspopup", "true");
      trigger.addEventListener("click", toggle);
      document.addEventListener("click", closeOnOutside);
      attachEscapeClose(ctx.el, () => menu.classList.remove("quark-open"));
      ctx.el.quarkCleanup = () => document.removeEventListener("click", closeOnOutside);
    },
    variants: {
      modern: { css: `.menu { background: var(--quark-surface-light); box-shadow: var(--quark-shadow-md); }` },
      minimal: { css: `.menu { background: var(--quark-surface-light); border: var(--quark-border-hairline); }` },
    },
    unmount(ctx) {
      if (ctx.el.quarkCleanup) ctx.el.quarkCleanup();
    },
  });

  register({
    name: "tooltip",
    defaultVariant: "modern",
    docs: {
      description: "Adds a hover/focus tooltip driven by a data-tooltip attribute on the element.",
      expectedHtml: '<button id="helpIcon" data-tooltip="More info">?</button>',
      example: "@helpIcon tooltip.dark",
    },
    base(ctx) {
      const text = ctx.el.getAttribute("data-tooltip");
      if (!text) {
        console.warn(`Quark: tooltip on #${ctx.elementId} needs a data-tooltip attribute`);
        return;
      }
      ctx.css(`position: relative;`);
      const bubble = document.createElement("span");
      bubble.className = "quark-tooltip-bubble";
      bubble.textContent = text;
      bubble.setAttribute("role", "tooltip");
      bubble.hidden = true;
      ctx.el.appendChild(bubble);
      ctx.css(`.quark-tooltip-bubble {
        position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
        margin-bottom: 6px; padding: 4px 8px; border-radius: var(--quark-radius-sm);
        font-size: var(--quark-font-sizeSm); white-space: nowrap; z-index: 60;
        ${transitionCss("opacity")}
      }`, "bubble");
      const show = () => (bubble.hidden = false);
      const hide = () => (bubble.hidden = true);
      ctx.el.addEventListener("mouseenter", show);
      ctx.el.addEventListener("mouseleave", hide);
      ctx.el.addEventListener("focus", show);
      ctx.el.addEventListener("blur", hide);
      ctx.addCleanup(() => {
        bubble.remove();
        ctx.el.removeEventListener("mouseenter", show);
        ctx.el.removeEventListener("mouseleave", hide);
        ctx.el.removeEventListener("focus", show);
        ctx.el.removeEventListener("blur", hide);
      });
    },
    variants: {
      modern: { css: `.quark-tooltip-bubble { background: var(--quark-surface-dark); color: #fff; }` },
      dark: { css: `.quark-tooltip-bubble { background: #000; color: #fff; }` },
      light: { css: `.quark-tooltip-bubble { background: var(--quark-surface-light); color: #000; box-shadow: var(--quark-shadow-sm); }` },
    },
  });

  register({
    name: "popover",
    defaultVariant: "modern",
    parts: ["trigger", "content"],
    docs: {
      description: "Like dropdown, but for arbitrary rich content rather than a menu list.",
      expectedHtml: '<div id="infoPop"><button class="trigger">Info</button><div class="content">...</div></div>',
      example: "@infoPop popover.modern",
    },
    base(ctx) {
      const trigger = ctx.part("trigger") || ctx.el.querySelector("button, a");
      const content = ctx.part("content");
      if (!trigger || !content) {
        console.warn(`Quark: popover on #${ctx.elementId} needs a "trigger" and "content" part`);
        return;
      }
      ctx.css(`position: relative; display: inline-block;`);
      ctx.css(`.content {
        position: absolute; min-width: 220px; margin-top: var(--quark-space-xs);
        padding: var(--quark-space-md); border-radius: var(--quark-radius-md);
        display: none; z-index: 50;
      }`, "content-base");
      ctx.css(`.content.quark-open { display: block; }`, "content-open");
      function toggle() {
        content.classList.toggle("quark-open");
      }
      trigger.addEventListener("click", toggle);
      attachEscapeClose(ctx.el, () => content.classList.remove("quark-open"));
    },
    variants: {
      modern: { css: `.content { background: var(--quark-surface-light); box-shadow: var(--quark-shadow-md); }` },
    },
  });

  register({
    name: "toast",
    defaultVariant: "modern",
    docs: {
      description: "Enhances an existing notification element with entrance/exit + auto-dismiss.",
      expectedHtml: '<div id="saveToast">Saved!</div>',
      example: "@saveToast toast.success",
    },
    base(ctx) {
      ctx.el.setAttribute("role", "status");
      ctx.css(`
        position: fixed; bottom: var(--quark-space-lg); right: var(--quark-space-lg);
        padding: var(--quark-space-md) var(--quark-space-lg); border-radius: var(--quark-radius-md);
        box-shadow: var(--quark-shadow-md); z-index: 80;
        ${transitionCss("opacity,transform")}
        opacity: 0; transform: translateY(8px);
      `);
      requestAnimationFrame(() => {
        ctx.el.style.opacity = "1";
        ctx.el.style.transform = "translateY(0)";
      });
    },
    variants: {
      modern: { css: `background: var(--quark-surface-dark); color: #fff;` },
      success: { css: `background: #14532d; color: #fff;` },
      danger: { css: `background: #7f1d1d; color: #fff;` },
    },
    modifiers: {
      dismissible: {
        behavior: (ctx) => {
          ctx.el.style.cursor = "pointer";
          ctx.el.addEventListener("click", () => ctx.el.remove());
        },
      },
    },
  });

  register({
    name: "accordion",
    defaultVariant: "modern",
    docs: {
      description: "Enhances a list of header+panel pairs into an expand/collapse accordion.",
      expectedHtml: '<div id="faq"><div class="item"><button class="header">Q1</button><div class="panel">A1</div></div></div>',
      example: "@faq accordion.bordered",
    },
    base(ctx) {
      ctx.css(`.panel { display: none; overflow: hidden; ${transitionCss("max-height")} }`, "panel-base");
      ctx.css(`.item.quark-open .panel { display: block; }`, "panel-open");
      const items = ctx.el.querySelectorAll(".item");
      items.forEach((item) => {
        const header = item.querySelector(".header");
        if (!header) return;
        header.setAttribute("role", "button");
        header.tabIndex = 0;
        const toggle = () => item.classList.toggle("quark-open");
        header.addEventListener("click", toggle);
        header.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        });
      });
    },
    variants: {
      modern: { css: `.item { border-bottom: var(--quark-border-hairline); padding: var(--quark-space-sm) 0; }` },
      bordered: { css: `.item { border: var(--quark-border-hairline); border-radius: var(--quark-radius-sm); padding: var(--quark-space-sm); margin-bottom: var(--quark-space-xs); }` },
    },
  });

  // =====================================================================
  // STATUS
  // =====================================================================

  register({
    name: "progress",
    defaultVariant: "modern",
    docs: {
      description: "Enhances an element with a data-progress (0-100) attribute into a progress bar.",
      expectedHtml: '<div id="uploadBar" data-progress="40"></div>',
      example: "@uploadBar progress.pill",
    },
    base(ctx) {
      const pct = Math.max(0, Math.min(100, parseInt(ctx.el.getAttribute("data-progress") || "0", 10)));
      ctx.el.setAttribute("role", "progressbar");
      ctx.el.setAttribute("aria-valuenow", String(pct));
      ctx.el.setAttribute("aria-valuemin", "0");
      ctx.el.setAttribute("aria-valuemax", "100");
      ctx.css(`height: 8px; border-radius: var(--quark-radius-pill); background: rgba(0,0,0,.08); overflow: hidden; position: relative;`);
      const existingFill = ctx.el.querySelector(".quark-progress-fill");
      if (existingFill) existingFill.remove();
      const fill = document.createElement("div");
      fill.className = "quark-progress-fill";
      ctx.el.appendChild(fill);
      ctx.addCleanup(() => fill.remove());
      ctx.css(`.quark-progress-fill {
        height: 100%; width: ${pct}%; background: var(--quark-accent, #2563eb);
        ${transitionCss("width")}
      }`, "fill");
    },
    variants: {
      modern: { css: `` },
      pill: { css: `` }, // pill shape already default; explicit alias
      flat: { css: `border-radius: 0; .quark-progress-fill { border-radius: 0; }` },
    },
  });

  register({
    name: "loader",
    defaultVariant: "spin",
    docs: {
      description: "Turns an empty element into a loading indicator.",
      expectedHtml: '<div id="spinner"></div>',
      example: "@spinner loader.spin",
    },
    base(ctx) {
      ctx.el.setAttribute("role", "status");
      ctx.el.setAttribute("aria-label", "Loading");
      ctx.css(`width: 24px; height: 24px; display: inline-block;`);
    },
    variants: {
      spin: {
        css: `
          border: 3px solid rgba(0,0,0,.1); border-top-color: var(--quark-accent, #2563eb);
          border-radius: 50%;
          ${reducedMotion() ? "" : "animation: quark-spin 0.7s linear infinite;"}
        `,
      },
    },
    mount(ctx) {
      if (reducedMotion()) return;
      Quark.css.apply(
        `@keyframes quark-spin { to { transform: rotate(360deg); } }`,
        "quark-keyframes-spin"
      );
    },
  });

  register({
    name: "skeleton",
    defaultVariant: "modern",
    docs: {
      description: "Turns a placeholder element into a loading skeleton block.",
      expectedHtml: '<div id="cardSkeleton"></div>',
      example: "@cardSkeleton skeleton.modern",
    },
    base(ctx) {
      ctx.el.setAttribute("aria-hidden", "true");
      ctx.css(`
        background: linear-gradient(90deg, rgba(0,0,0,.06) 25%, rgba(0,0,0,.11) 37%, rgba(0,0,0,.06) 63%);
        background-size: 400% 100%; border-radius: var(--quark-radius-sm);
        ${reducedMotion() ? "" : "animation: quark-skeleton 1.4s ease infinite;"}
      `);
    },
    variants: { modern: { css: `` } },
    mount() {
      if (reducedMotion()) return;
      Quark.css.apply(
        `@keyframes quark-skeleton { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }`,
        "quark-keyframes-skeleton"
      );
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
