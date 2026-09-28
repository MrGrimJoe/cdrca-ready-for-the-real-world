// Packages a plugin author's changes to their workspace copy of the grammar.
//
//   const { packageWorkspace } = require("./packager");
//   const r = packageWorkspace(baseSource, workspaceSource, { owner: "my-plugin" });
//   r.ok ? r.package : r.errors
//
// The author gets a full copy of the base grammar (plugin.js) to develop and
// test against. Packaging does NOT ship that copy and does NOT patch it onto
// some later version of the shared file. It works out what the author ADDED
// and turns that into an isolated package, or fails. There is no guessing:
//
//   1. Nothing from the base may change. Every base line must still be there,
//      in order, untouched. Only insertions are allowed.
//   2. Insertions must land between top-level statements of the base, never
//      inside an existing function, so no existing behaviour can be altered.
//   3. Every inserted top-level statement must be one of:
//        - a new function declaration            (helper)
//        - a new const/let                        (helper)
//        - PLUGIN.register(list, name, fn)        (additive registration)
//        - PLUGIN.declare(plugin, { ...static })  (declaration)
//      Anything else is ambiguous and fails.
//   4. Code may only use its own names, plus the plugin API (PLUGIN and the
//      helpers in PLUGIN_API_NAMES). Using another base-internal name fails,
//      because the packaged plugin is loaded without them.
//   5. Registration names must be new, and declared capability names must not
//      exist anywhere yet (checked by loading against a fresh base registry).
//
// The package is { format, owner, source, registrations, declarations }.
// `source` is the inserted code verbatim; applyPackage() in plugin.js runs it
// in isolation.

const acorn = require("acorn");

const LISTS = ["element", "statement", "guard"];

function fail(errors, line, message) {
  errors.push({ line, message });
}

// ---- line diff (LCS). Returns the base lines kept, and the inserted runs.
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const deleted = []; // base line numbers (1-based) not present in the workspace
  const inserted = []; // { afterBase, startLine, lines[] } — afterBase = base lines before it
  let i = 0;
  let j = 0;
  let cur = null;
  const flush = () => {
    if (cur) inserted.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      if (!cur) cur = { afterBase: i, startLine: j + 1, lines: [] };
      cur.lines.push(b[j]);
      j++;
    } else {
      flush();
      deleted.push(i + 1);
      i++;
    }
  }
  flush();
  return { deleted, inserted };
}

function parse(src, extra) {
  return acorn.parse(src, Object.assign({ ecmaVersion: "latest", sourceType: "script", locations: true }, extra || {}));
}

function topLevelNames(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") names.add(node.id.name);
    else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) collectPatternNames(d.id, names);
    }
  }
  return names;
}

function collectPatternNames(p, out) {
  if (!p) return;
  if (p.type === "Identifier") out.add(p.name);
  else if (p.type === "ObjectPattern") p.properties.forEach((q) => collectPatternNames(q.value || q.argument, out));
  else if (p.type === "ArrayPattern") p.elements.forEach((q) => collectPatternNames(q, out));
  else if (p.type === "AssignmentPattern") collectPatternNames(p.left, out);
  else if (p.type === "RestElement") collectPatternNames(p.argument, out);
}

// Every identifier used as a variable (not a property name) plus every name
// declared anywhere in the code. A used name that is declared somewhere in
// the added code is treated as its own; this can only ever miss an error, not
// invent one.
function referencesAndDeclarations(node) {
  const refs = [];
  const declared = new Set();
  (function walk(n, parent, key) {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier": {
        const isProp = parent && ((parent.type === "MemberExpression" && key === "property" && !parent.computed) || (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand) || (parent.type === "MethodDefinition" && key === "key" && !parent.computed) || (parent.type === "PropertyDefinition" && key === "key" && !parent.computed) || ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && key === "label"));
        if (!isProp) refs.push({ name: n.name, line: n.loc.start.line });
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.id) declared.add(n.id.name);
        n.params.forEach((p) => collectPatternNames(p, declared));
        break;
      case "VariableDeclarator":
        collectPatternNames(n.id, declared);
        break;
      case "CatchClause":
        if (n.param) collectPatternNames(n.param, declared);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (n.id) declared.add(n.id.name);
        break;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "type") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, n, k));
      else if (v && typeof v.type === "string") walk(v, n, k);
    }
  })(node, null, null);
  return { refs, declared };
}

// A static value (JSON-like) from a literal AST node, or throws.
function staticValue(n) {
  switch (n.type) {
    case "Literal":
      if (n.regex || typeof n.value === "bigint") throw new Error("only plain strings, numbers, booleans and null are allowed");
      return n.value;
    case "TemplateLiteral":
      if (n.expressions.length) throw new Error("template literals with ${} are not static");
      return n.quasis[0].value.cooked;
    case "ArrayExpression":
      return n.elements.map((e) => {
        if (!e || e.type === "SpreadElement") throw new Error("spread and holes are not static");
        return staticValue(e);
      });
    case "ObjectExpression": {
      const o = {};
      for (const p of n.properties) {
        if (p.type !== "Property" || p.computed || p.kind !== "init" || p.method) throw new Error("only plain `key: value` properties are static");
        const k = p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : null;
        if (k === null) throw new Error("property keys must be names or strings");
        o[k] = staticValue(p.value);
      }
      return o;
    }
    case "UnaryExpression":
      if (n.operator === "-" && n.argument.type === "Literal" && typeof n.argument.value === "number") return -n.argument.value;
      throw new Error("expressions are not static");
    default:
      throw new Error(`${n.type} is not static`);
  }
}

function packageWorkspace(baseSource, workspaceSource, opts) {
  const owner = opts && opts.owner;
  const errors = [];
  if (!owner || typeof owner !== "string" || !/^[a-z][a-z0-9-]*$/.test(owner) || owner === "base" || owner === "workspace") {
    return { ok: false, errors: [{ line: 0, message: "packaging needs a plugin name (lowercase letters, digits, hyphens; not 'base' or 'workspace')" }] };
  }

  const baseLines = baseSource.split("\n");
  const workLines = workspaceSource.split("\n");
  const { deleted, inserted } = diffLines(baseLines, workLines);

  // 1. nothing from the base may change
  for (const n of deleted.slice(0, 5)) {
    fail(errors, n, `shared grammar code was changed or removed (base line ${n}: ${JSON.stringify(baseLines[n - 1].trim().slice(0, 70))}) — a plugin may only add to the grammar`);
  }
  if (deleted.length > 5) fail(errors, deleted[5], `...and ${deleted.length - 5} more shared line(s) changed or removed`);
  if (errors.length) return { ok: false, errors };
  if (!inserted.length) return { ok: false, errors: [{ line: 0, message: "nothing to package — the workspace has no additions" }] };

  let baseAst;
  try {
    baseAst = parse(baseSource);
  } catch (e) {
    return { ok: false, errors: [{ line: 0, message: "the base grammar does not parse: " + e.message }] };
  }
  const baseNames = topLevelNames(baseAst);
  const currentBase = (opts && opts.currentBase) || require.resolve("./plugin.js");
  const { PLUGIN_API_NAMES } = require(currentBase).__internals;
  const allowedNames = new Set(PLUGIN_API_NAMES.concat(["PLUGIN"]));

  // 2. insertions must sit between top-level statements of the base
  for (const h of inserted) {
    for (const node of baseAst.body) {
      if (node.loc.start.line <= h.afterBase && h.afterBase < node.loc.end.line) {
        fail(errors, h.startLine, `code was added inside an existing top-level ${node.type === "FunctionDeclaration" ? `function '${node.id.name}'` : "statement"} (workspace line ${h.startLine}) — additions must go between top-level statements, never inside shared code`);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  // 3. classify every inserted top-level statement
  const addedNames = new Set();
  const registrations = [];
  const declarations = [];
  const sourceParts = [];
  let codeNodes = 0;

  for (const h of inserted) {
    const text = h.lines.join("\n");
    let ast;
    try {
      ast = parse(text);
    } catch (e) {
      fail(errors, h.startLine + ((e.loc && e.loc.line) || 1) - 1, `added code does not parse: ${e.message.replace(/ \(\d+:\d+\)$/, "")}`);
      continue;
    }
    // Ship the code, not the comments between statements (a workspace's
    // guide block, say). Comments inside a function or declaration stay.
    for (const node of ast.body) sourceParts.push(text.slice(node.start, node.end));
    codeNodes += ast.body.length;
    const lineOf = (node) => h.startLine + node.loc.start.line - 1;

    for (const node of ast.body) {
      const line = lineOf(node);
      const declare = (name, at) => {
        if (baseNames.has(name)) fail(errors, at, `'${name}' already exists in the base grammar — pick another name`);
        else if (addedNames.has(name)) fail(errors, at, `'${name}' is declared twice`);
        else addedNames.add(name);
      };
      if (node.type === "FunctionDeclaration") {
        declare(node.id.name, line);
      } else if (node.type === "VariableDeclaration") {
        if (node.kind === "var") fail(errors, line, "use const or let, not var");
        for (const d of node.declarations) {
          const names = new Set();
          collectPatternNames(d.id, names);
          names.forEach((nm) => declare(nm, line));
        }
      } else if (node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.type === "MemberExpression" && node.expression.callee.object.type === "Identifier" && node.expression.callee.object.name === "PLUGIN" && !node.expression.callee.computed) {
        const call = node.expression;
        const method = call.callee.property.name;
        const args = call.arguments;
        if (method === "register") {
          if (args.length !== 3 || args[0].type !== "Literal" || typeof args[0].value !== "string" || args[1].type !== "Literal" || typeof args[1].value !== "string") {
            fail(errors, line, 'PLUGIN.register needs (list, name, fn): a literal list name, a literal rule name, and a function — e.g. PLUGIN.register("statement", "myRule", myRule)');
          } else if (LISTS.indexOf(args[0].value) === -1) {
            fail(errors, line, `'${args[0].value}' is not a rule list (use ${LISTS.join(", ")})`);
          } else if (!["Identifier", "FunctionExpression", "ArrowFunctionExpression"].includes(args[2].type)) {
            fail(errors, line, "PLUGIN.register's third argument must be a function or the name of one");
          } else {
            registrations.push({ list: args[0].value, name: args[1].value, line });
          }
        } else if (method === "declare") {
          if (args.length !== 2 || args[0].type !== "Literal" || typeof args[0].value !== "string" || args[1].type !== "ObjectExpression") {
            fail(errors, line, "PLUGIN.declare needs (pluginName, { capabilities: { ... } }) with a literal name and a static object");
          } else {
            try {
              declarations.push({ plugin: args[0].value, decl: staticValue(args[1]), line });
            } catch (e) {
              fail(errors, line, `PLUGIN.declare must be static data: ${e.message}`);
            }
          }
        } else {
          fail(errors, line, `PLUGIN.${method} is not part of the plugin API (use PLUGIN.register or PLUGIN.declare)`);
        }
      } else {
        fail(errors, line, `ambiguous top-level ${node.type === "ExpressionStatement" ? "expression" : node.type} — a plugin may add only new functions, new const/let values, PLUGIN.register(...) and PLUGIN.declare(...)`);
      }
    }

    // 4. only the plugin's own names and the plugin API
    const { refs, declared } = referencesAndDeclarations(ast);
    const seen = new Set();
    for (const r of refs) {
      if (declared.has(r.name) || allowedNames.has(r.name) || seen.has(r.name)) continue;
      if (baseNames.has(r.name)) {
        seen.add(r.name);
        fail(errors, h.startLine + r.line - 1, `'${r.name}' is internal to the base grammar and is not part of the plugin API — the packaged plugin can't use it (available: ${PLUGIN_API_NAMES.join(", ")})`);
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  if (!codeNodes) return { ok: false, errors: [{ line: 0, message: "nothing to package — the workspace has no additions" }] };

  // 5. a real load against a fresh base registry: names must be new and
  // declarations valid. Anything it throws is a packaging error.
  const pkg = {
    format: 1,
    owner,
    source: sourceParts.join("\n\n") + "\n",
    registrations: registrations.map(({ list, name }) => ({ list, name })),
    declarations: declarations.map(({ plugin, decl }) => ({ plugin, decl })),
  };
  try {
    // Loaded against the CURRENT base grammar, which may be newer than the
    // one the workspace was copied from: the package is additions only, so
    // what matters is that those additions still fit the grammar as it is now.
    const G = require(currentBase).__internals;
    const reg = G.createBaseRegistry();
    G.applyPackage(reg, pkg);
    const d = reg.describe();
    for (const r of pkg.registrations) {
      if (!d[r.list].some((e) => e.name === r.name && e.owner === owner)) throw new Error(`'${r.name}' was not registered in the ${r.list} list`);
    }
  } catch (e) {
    return { ok: false, errors: [{ line: 0, message: e.message.replace(/^grammar registry: /, "") }] };
  }
  return { ok: true, package: pkg };
}

module.exports = { packageWorkspace, diffLines };
