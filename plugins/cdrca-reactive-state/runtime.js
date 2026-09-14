// cdrca-reactive-state — runtime
//
// Loaded alongside the generated scene JS (a plain <script> tag, no
// bundler, no build step). Exposes window.CDRCA.reactive (aliased to `R`
// inside code the plugin generates). See docs/REACTIVE-STATE.md for the
// full model; this file is the entire implementation — no virtual DOM, no
// reconciliation engine, direct DOM writes only.
//
// Works anywhere the CDRCA-generated scene runs (browser, PWA, or a Tauri
// webview) since it only touches standard DOM/window APIs — see
// docs/REACTIVE-STATE.md#platform-compatibility.

(function (root) {
  "use strict";

  // ---- store -----------------------------------------------------------
  // cells: Map<name, Cell>
  //   state cell:    { kind: "state", value, subscribers: Set<fn> }
  //   computed cell: { kind: "computed", value, subscribers: Set<fn>,
  //                    computeFn, deps: Set<string>, evaluating: bool,
  //                    onDepChange: fn }
  const cells = new Map();

  // Stack of Set<string> — the innermost set collects the names of every
  // state/computed read via val() while a computed/binding is (re)running,
  // giving free dependency tracking without any static analysis.
  const trackingStack = [];

  const globalListeners = new Set(); // subscribeAll() — e.g. a future storage plugin

  function runTracked(fn) {
    const deps = new Set();
    trackingStack.push(deps);
    let value;
    try {
      value = fn();
    } finally {
      trackingStack.pop();
    }
    return { value, deps };
  }

  function val(name) {
    const cell = cells.get(name);
    if (!cell) {
      throw new Error(
        `Reactive: "${name}" is not defined. Declare it first with 'state ${name} = ...' or 'computed ${name} = ...'.`
      );
    }
    if (trackingStack.length > 0) {
      trackingStack[trackingStack.length - 1].add(name);
    }
    return cell.value;
  }

  function notify(name, value, oldValue) {
    const cell = cells.get(name);
    if (cell) {
      for (const sub of Array.from(cell.subscribers)) {
        try {
          sub(value, oldValue);
        } catch (err) {
          console.error(`Reactive: a subscriber for "${name}" threw:`, err);
        }
      }
    }
    for (const listener of Array.from(globalListeners)) {
      try {
        listener({ name, value, oldValue });
      } catch (err) {
        console.error("Reactive: a subscribeAll() listener threw:", err);
      }
    }
  }

  function define(name, initialValue) {
    const existing = cells.get(name);
    if (existing) {
      if (existing.kind !== "state") {
        throw new Error(`Reactive: "${name}" is already declared as a computed value.`);
      }
      // Idempotent: a duplicate 'state' declaration (e.g. re-running scene
      // init) keeps the current value instead of resetting in-progress
      // state — see docs/REACTIVE-STATE.md#lifecycle.
      return;
    }
    cells.set(name, { kind: "state", value: initialValue, subscribers: new Set() });
  }

  function set(name, value) {
    const cell = cells.get(name);
    if (!cell) {
      throw new Error(`Reactive: cannot set "${name}" — declare it first with 'state ${name} = ...'.`);
    }
    if (cell.kind === "computed") {
      throw new Error(`Reactive: "${name}" is computed and cannot be set directly.`);
    }
    const old = cell.value;
    if (Object.is(old, value)) return; // skip redundant notifications/DOM writes
    cell.value = value;
    notify(name, value, old);
  }

  function update(name, fn) {
    set(name, fn(val(name)));
  }

  function computed(name, computeFn) {
    const existing = cells.get(name);
    if (existing) {
      if (existing.kind !== "computed") {
        throw new Error(`Reactive: "${name}" is already declared as state and can't be redeclared as computed.`);
      }
      return; // idempotent, same reasoning as define()
    }
    const cell = {
      kind: "computed",
      value: undefined,
      subscribers: new Set(),
      computeFn,
      deps: new Set(),
      evaluating: false,
    };
    cell.onDepChange = () => recomputeComputed(name);
    cells.set(name, cell);
    recomputeComputed(name);
  }

  function recomputeComputed(name) {
    const cell = cells.get(name);
    if (!cell) return;
    if (cell.evaluating) {
      throw new Error(`Reactive: circular dependency detected around computed "${name}".`);
    }

    // Re-track dependencies BEFORE touching subscriptions (rather than
    // unsubscribing-then-recomputing) so that a compute function which
    // mutates one of its own (still-subscribed) dependencies re-enters
    // this function while `evaluating` is still true, and is caught by
    // the guard above instead of silently losing its subscription.
    cell.evaluating = true;
    let result;
    try {
      result = runTracked(cell.computeFn);
    } finally {
      cell.evaluating = false;
    }

    const oldDeps = cell.deps;
    const newDeps = result.deps;
    for (const dep of oldDeps) {
      if (!newDeps.has(dep)) {
        const depCell = cells.get(dep);
        if (depCell) depCell.subscribers.delete(cell.onDepChange);
      }
    }
    for (const dep of newDeps) {
      if (!oldDeps.has(dep)) {
        const depCell = cells.get(dep);
        if (!depCell) {
          throw new Error(`Reactive: computed "${name}" references unknown state "${dep}".`);
        }
        depCell.subscribers.add(cell.onDepChange);
      }
    }
    cell.deps = newDeps;

    const old = cell.value;
    cell.value = result.value;
    if (!Object.is(old, result.value)) {
      notify(name, result.value, old);
    }
  }

  function watch(name, fn) {
    const cell = cells.get(name);
    if (!cell) {
      throw new Error(`Reactive: cannot watch "${name}" — declare it first with 'state' or 'computed'.`);
    }
    cell.subscribers.add(fn);
    return () => cell.subscribers.delete(fn);
  }

  function subscribeAll(fn) {
    globalListeners.add(fn);
    return () => globalListeners.delete(fn);
  }

  // ---- DOM bindings ------------------------------------------------------

  const bindings = new Map(); // "<id>::<kind>" -> { dispose() }
  const eventBindings = new Map(); // "<id>::event::<name>" -> { el, handler }

  function bindingKey(elementId, kind) {
    return `${elementId}::${kind}`;
  }

  function disposeBinding(key) {
    const existing = bindings.get(key);
    if (existing) {
      existing.dispose();
      bindings.delete(key);
    }
  }

  function applyToDom(el, kind, value) {
    const sepIndex = kind.indexOf(":");
    const base = sepIndex === -1 ? kind : kind.slice(0, sepIndex);
    const sub = sepIndex === -1 ? null : kind.slice(sepIndex + 1);

    switch (base) {
      case "text":
        el.textContent = value == null ? "" : String(value);
        break;
      case "html":
        // Trusted-content only — this plugin does no sanitization.
        el.innerHTML = value == null ? "" : String(value);
        break;
      case "value": {
        const s = value == null ? "" : String(value);
        if (el.value !== s) el.value = s;
        break;
      }
      case "checked":
        el.checked = Boolean(value);
        break;
      case "disabled":
        el.disabled = Boolean(value);
        break;
      case "show":
        el.style.display = value ? "" : "none";
        break;
      case "hide":
        el.style.display = value ? "none" : "";
        break;
      case "class":
        el.classList.toggle(sub, Boolean(value));
        break;
      case "style":
        el.style.setProperty(sub, value == null ? "" : String(value));
        break;
      case "attr":
        if (value === false || value == null) el.removeAttribute(sub);
        else el.setAttribute(sub, value === true ? "" : String(value));
        break;
      case "prop":
        el[sub] = value;
        break;
      default:
        throw new Error(`Reactive: unknown binding kind "${kind}".`);
    }
  }

  function wireTwoWay(el, kind, writableName) {
    if (!writableName) return null;
    const isCheckbox = kind === "checked";
    const eventName = isCheckbox || el.tagName === "SELECT" ? "change" : "input";
    const handler = () => {
      if (isCheckbox) set(writableName, el.checked);
      else set(writableName, el.value);
    };
    el.addEventListener(eventName, handler);
    return () => el.removeEventListener(eventName, handler);
  }

  function bind(elementId, kind, fn, writableName) {
    const key = bindingKey(elementId, kind);
    disposeBinding(key);

    const el = document.getElementById(elementId);
    if (!el) {
      console.error(`Reactive: bind.${kind.replace(":", ".")} on #${elementId} — element not found.`);
      return;
    }

    let currentDeps = new Set();
    let disposed = false;
    const handler = () => refresh();

    function refresh() {
      if (disposed) return;
      for (const dep of currentDeps) {
        const c = cells.get(dep);
        if (c) c.subscribers.delete(handler);
      }
      const result = runTracked(fn);
      currentDeps = result.deps;
      for (const dep of currentDeps) {
        const c = cells.get(dep);
        if (!c) {
          throw new Error(`Reactive: bind.${kind.replace(":", ".")} on #${elementId} references unknown state "${dep}".`);
        }
        c.subscribers.add(handler);
      }
      applyToDom(el, kind, result.value);
    }

    refresh();

    const unwireTwoWay = kind === "value" || kind === "checked" ? wireTwoWay(el, kind, writableName) : null;
    ensureLifecycleObserver();

    bindings.set(key, {
      dispose() {
        disposed = true;
        for (const dep of currentDeps) {
          const c = cells.get(dep);
          if (c) c.subscribers.delete(handler);
        }
        if (unwireTwoWay) unwireTwoWay();
      },
    });
  }

  function on(elementId, eventName, handler) {
    const key = `${elementId}::event::${eventName}`;
    const existing = eventBindings.get(key);
    if (existing) {
      existing.el.removeEventListener(eventName, existing.wrapped);
      eventBindings.delete(key);
    }
    const el = document.getElementById(elementId);
    if (!el) {
      console.error(`Reactive: on(${eventName}) — no element with id "${elementId}" found.`);
      return;
    }
    const wrapped = (evt) => {
      try {
        handler(evt);
      } catch (err) {
        console.error(`Reactive: the "${eventName}" handler on #${elementId} threw:`, err);
      }
    };
    el.addEventListener(eventName, wrapped);
    eventBindings.set(key, { el, wrapped });
    ensureLifecycleObserver();
  }

  // ---- list binding --------------------------------------------------
  //
  // Deliberately minimal: clones a <template>, matches items by an `id`
  // field (falling back to index), reorders/adds/removes real DOM nodes in
  // place (no virtual diffing), and interpolates a handful of `data-bind-*`
  // attributes. Item-level events (e.g. a per-todo delete button) are
  // NOT a DSL feature — since bind.list clones real DOM nodes, ordinary
  // inline HTML event attributes (onclick="...") calling a plain function
  // that uses R.get/R.set work as-is. See
  // docs/REACTIVE-STATE.md#collections for the full rationale and the
  // richer per-item-binding/keyed-diffing ideas left for a later plugin.

  function itemKeyOf(item, index) {
    if (item && typeof item === "object" && "id" in item && item.id != null) return `id:${item.id}`;
    return `idx:${index}`;
  }

  function applyItemBindings(root, item) {
    root.querySelectorAll("[data-bind-text]").forEach((n) => {
      n.textContent = item == null ? "" : item[n.getAttribute("data-bind-text")];
    });
    root.querySelectorAll("[data-bind-html]").forEach((n) => {
      n.innerHTML = item == null ? "" : item[n.getAttribute("data-bind-html")];
    });
    root.querySelectorAll("[data-bind-checked]").forEach((n) => {
      n.checked = Boolean(item && item[n.getAttribute("data-bind-checked")]);
    });
    root.querySelectorAll("[data-bind-class]").forEach((n) => {
      const [cls, field] = n.getAttribute("data-bind-class").split(":");
      n.classList.toggle(cls, Boolean(item && item[field]));
    });
    root.querySelectorAll("[data-bind-attr]").forEach((n) => {
      const [attr, field] = n.getAttribute("data-bind-attr").split(":");
      const v = item ? item[field] : null;
      if (v == null || v === false) n.removeAttribute(attr);
      else n.setAttribute(attr, v === true ? "" : String(v));
    });
  }

  function bindList(containerId, stateName, templateId) {
    const key = bindingKey(containerId, "list");
    disposeBinding(key);

    const container = document.getElementById(containerId);
    const template = document.getElementById(templateId);
    if (!container) {
      console.error(`Reactive: bind.list on #${containerId} — container not found.`);
      return;
    }
    if (!template || template.tagName !== "TEMPLATE") {
      console.error(`Reactive: bind.list on #${containerId} — "#${templateId}" must be a <template> element.`);
      return;
    }

    const rendered = new Map(); // itemKey -> element
    let currentDeps = new Set();
    let disposed = false;
    const handler = () => refresh();

    function renderNewItem(item, key) {
      const frag = template.content.cloneNode(true);
      const rootEl = frag.firstElementChild;
      if (rootEl) {
        rootEl.setAttribute("data-reactive-key", key);
        applyItemBindings(rootEl, item);
      }
      return rootEl;
    }

    function refresh() {
      if (disposed) return;
      for (const dep of currentDeps) {
        const c = cells.get(dep);
        if (c) c.subscribers.delete(handler);
      }
      const result = runTracked(() => val(stateName));
      currentDeps = result.deps;
      for (const dep of currentDeps) {
        const c = cells.get(dep);
        if (!c) throw new Error(`Reactive: bind.list on #${containerId} references unknown state "${dep}".`);
        c.subscribers.add(handler);
      }

      const list = result.value;
      if (!Array.isArray(list)) {
        console.error(`Reactive: bind.list on #${containerId} — "${stateName}" is not an array.`);
        return;
      }

      const seen = new Set();
      let afterNode = null; // insert each item right after this node, in order
      list.forEach((item, index) => {
        const key = itemKeyOf(item, index);
        seen.add(key);
        let node = rendered.get(key);
        if (!node) {
          node = renderNewItem(item, key);
          rendered.set(key, node);
        } else {
          applyItemBindings(node, item);
        }
        const wantedNext = afterNode ? afterNode.nextSibling : container.firstChild;
        if (wantedNext !== node) container.insertBefore(node, wantedNext);
        afterNode = node;
      });

      for (const [key, node] of Array.from(rendered.entries())) {
        if (!seen.has(key)) {
          node.remove();
          rendered.delete(key);
        }
      }
    }

    refresh();
    ensureLifecycleObserver();

    bindings.set(key, {
      dispose() {
        disposed = true;
        for (const dep of currentDeps) {
          const c = cells.get(dep);
          if (c) c.subscribers.delete(handler);
        }
        for (const node of rendered.values()) node.remove();
        rendered.clear();
      },
    });
  }

  // ---- lifecycle / cleanup --------------------------------------------
  //
  // A single shared MutationObserver (not polling) notices when a bound
  // element is removed from the document and disposes its bindings/event
  // listeners, so a page that adds/removes DOM nodes over time doesn't
  // leak subscriptions. See docs/REACTIVE-STATE.md#lifecycle.

  let observer = null;
  function trackedElementIds() {
    const ids = new Set();
    for (const key of bindings.keys()) ids.add(key.slice(0, key.indexOf("::")));
    for (const key of eventBindings.keys()) ids.add(key.slice(0, key.indexOf("::")));
    return ids;
  }

  function ensureLifecycleObserver() {
    if (observer || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    observer = new MutationObserver(() => {
      for (const id of trackedElementIds()) {
        if (document.getElementById(id)) continue;
        for (const key of Array.from(bindings.keys())) {
          if (key.startsWith(`${id}::`)) disposeBinding(key);
        }
        for (const key of Array.from(eventBindings.keys())) {
          if (key.startsWith(`${id}::event::`)) eventBindings.delete(key);
        }
      }
    });
    const target = document.documentElement || document.body;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  // ---- public API --------------------------------------------------------

  const reactive = {
    // state
    define,
    get: val,
    val,
    set,
    update,
    // computed / watch
    computed,
    watch,
    // DOM
    bind,
    bindList,
    on,
    // extension point for e.g. a future storage plugin
    subscribeAll,
    // test-only: not part of the documented API
    __resetForTests() {
      cells.clear();
      trackingStack.length = 0;
      globalListeners.clear();
      for (const key of Array.from(bindings.keys())) disposeBinding(key);
      bindings.clear();
      for (const { el, wrapped } of eventBindings.values()) {
        // best-effort; eventName isn't stored separately, harmless to skip
        void el;
        void wrapped;
      }
      eventBindings.clear();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };

  root.CDRCA = root.CDRCA || {};
  root.CDRCA.reactive = reactive;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = reactive;
  }
})(typeof window !== "undefined" ? window : globalThis);
