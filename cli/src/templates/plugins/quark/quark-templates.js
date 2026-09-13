// Quark templates — reusable STRUCTURAL patterns, not hardcoded content.
//
// A template describes the recommended sub-part shape for a component
// (which data-quark-part elements a component-specific layout expects) and
// can optionally scaffold empty part containers into an element that has
// none yet. It never invents copy, links, or data — that always stays the
// developer's own HTML/CDRCA content, per the core architecture rule that
// HTML remains the content source.
//
// This is intentionally a thin, optional layer on top of quark-core.js's
// registry — Quark.components.mount() never requires a template to exist.

(function (global) {
  "use strict";

  const Quark = global.Quark;
  if (!Quark) {
    console.error("Quark templates: quark-core.js must be loaded first.");
    return;
  }

  const templates = new Map(); // "component.templateName" -> definition

  /**
   * definition = {
   *   component: "navbar",
   *   name: "logo-links-actions",
   *   parts: ["brand", "navigation", "actions"],   // documented shape
   *   describe: "Logo on the left, nav links centered, actions on the right.",
   *   scaffold(el) -> void   // optional: create empty part containers if missing
   * }
   */
  function register(definition) {
    if (!definition || !definition.component || !definition.name) {
      throw new Error("Quark.templates.register: component and name are required");
    }
    templates.set(`${definition.component}.${definition.name}`, definition);
  }

  function get(component, name) {
    return templates.get(`${component}.${name}`);
  }

  function listFor(component) {
    return Array.from(templates.values()).filter((t) => t.component === component);
  }

  /** Scaffold an element with a template's expected empty part containers,
   * skipping any part that already exists (never overwrites real content). */
  function scaffold(component, name, el) {
    const tpl = get(component, name);
    if (!tpl) {
      console.warn(`Quark: unknown template "${component}.${name}"`);
      return;
    }
    if (typeof tpl.scaffold === "function") {
      tpl.scaffold(el);
      return;
    }
    (tpl.parts || []).forEach((part) => {
      if (Quark.components.findPart(el, part)) return;
      const container = document.createElement("div");
      container.setAttribute("data-quark-part", part);
      el.appendChild(container);
    });
  }

  Quark.templates = { register, get, listFor, scaffold };
  global.Quark = Quark;
  if (typeof module !== "undefined") module.exports = Quark;

  // ---------------------------------------------------------------------
  // A representative starter set — structural shapes only, per component
  // family named in the architecture brief. More can be registered the
  // same way without touching this file.
  // ---------------------------------------------------------------------

  register({ component: "navbar", name: "logo-links", parts: ["brand", "navigation"], describe: "Logo + inline nav links." });
  register({ component: "navbar", name: "logo-links-actions", parts: ["brand", "navigation", "actions"], describe: "Logo, nav links, and right-aligned actions (e.g. login button)." });
  register({ component: "navbar", name: "centered", parts: ["navigation"], describe: "Centered navigation with no brand slot." });
  register({ component: "navbar", name: "split", parts: ["brand", "navigation", "actions", "mobileMenu"], describe: "Split layout with a dedicated mobile menu part." });

  register({ component: "sidebar", name: "logo-nav", parts: ["header", "navigation"], describe: "Logo/header + navigation list." });
  register({ component: "sidebar", name: "grouped", parts: ["header", "navigation"], describe: "Navigation grouped into sections inside the navigation part." });
  register({ component: "sidebar", name: "nav-footer", parts: ["header", "navigation", "footer"], describe: "Adds a footer slot, e.g. for a user account block." });
  register({ component: "sidebar", name: "dashboard", parts: ["header", "navigation", "footer"], describe: "Dashboard-style sidebar: header, primary nav, footer." });

  register({ component: "card", name: "basic", parts: ["body"], describe: "Just a body — the simplest card shape." });
  register({ component: "card", name: "header-body-footer", parts: ["header", "body", "footer"], describe: "Full three-part card." });
  register({ component: "card", name: "media", parts: ["media", "body"], describe: "Image/media slot above a body." });
  register({ component: "card", name: "profile", parts: ["avatar", "body", "actions"], describe: "Avatar, info body, and action buttons." });
  register({ component: "card", name: "statistic", parts: ["label", "value"], describe: "A label + a large value, for dashboard stat tiles." });
  register({ component: "card", name: "action", parts: ["body", "actions"], describe: "Body content plus a row of action buttons." });

  // Layout-level combinations (not single components) are documented, not
  // scaffolded here — see docs/QUARK.md's "Composing layouts" section.
})(typeof window !== "undefined" ? window : globalThis);
