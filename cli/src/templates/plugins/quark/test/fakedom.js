// Minimal fake DOM — just enough surface area for quark-core.js and the
// component library to run under plain Node with zero dependencies.
// Not a full DOM; only implements what Quark's own code actually calls.
"use strict";

class FakeClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(c) { this.set.add(c); this.el._syncClass(); }
  remove(c) { this.set.delete(c); this.el._syncClass(); }
  toggle(c) { this.set.has(c) ? this.remove(c) : this.add(c); return this.set.has(c); }
  contains(c) { return this.set.has(c); }
}

class FakeStyle {
  constructor() { this._props = {}; }
  setProperty(k, v) { this._props[k] = v; }
  getPropertyValue(k) { return this._props[k] || ""; }
  set cssText(v) { this._cssText = v; }
  get cssText() { return this._cssText || ""; }
}

class FakeElement {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this._listeners = {};
    this.hidden = false;
    this.tabIndex = -1;
    this.textContent = "";
    this.className = "";
  }
  _syncClass() { this.className = Array.from(this.classList.set).join(" "); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === "id") this.id = v; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn); }
  dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt || {})); }
  focus() { this._focused = true; }
  querySelector(sel) {
    return this._query(sel, true)[0] || null;
  }
  querySelectorAll(sel) {
    return this._query(sel, false);
  }
  _query(sel, first) {
    const results = [];
    const matches = (el) => {
      if (sel.startsWith(".")) return (el.className || "").split(/\s+/).includes(sel.slice(1));
      if (sel.startsWith("[")) {
        const m = sel.match(/^\[([\w-]+)(="([^"]*)")?\]$/);
        if (!m) return false;
        const val = el.getAttribute(m[1]);
        return m[3] !== undefined ? val === m[3] : val !== null;
      }
      if (sel.includes(",")) return sel.split(",").some((s) => matches2(el, s.trim()));
      return matches2(el, sel);
    };
    const matches2 = (el, s) => el.tagName === s.toUpperCase();
    const walk = (el) => {
      for (const c of el.children) {
        if (matches(c)) {
          results.push(c);
          if (first) return true;
        }
        if (walk(c)) return true;
      }
      return false;
    };
    walk(this);
    return results;
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this._byId = new Map();
    this._listeners = {};
  }
  createElement(tag) { return new FakeElement(tag); }
  getElementById(id) { return this._byId.get(id) || null; }
  register(el) { this._byId.set(el.id, el); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn); }
}

function makeElementWithId(doc, id, tag) {
  const el = new FakeElement(tag);
  el.setAttribute("id", id);
  doc.register(el);
  return el;
}

function installFakeGlobals() {
  const document = new FakeDocument();
  global.document = document;
  global.window = global;
  global.requestAnimationFrame = (fn) => fn();
  global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  return { document, makeElementWithId: (id, tag) => makeElementWithId(document, id, tag) };
}

module.exports = { installFakeGlobals, FakeElement };
