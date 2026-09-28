// campfire — a branching-dialogue/narrative plugin for CDRCA
//
// Registers on the ("syntax", "customRule") hook — the same extension
// point Quark's "@directive" plugin and cdrca-reactive-state's
// "state/computed/watch/@bind" plugin both use (see
// docs/PLUGIN-DEVELOPMENT.md in the cdrca-ready-for-the-real-world repo
// this plugin was scaffolded from, and quark/plugin.js +
// cdrca-reactive-state/plugin.js there for the reference implementations
// this file's conventions are deliberately copied from).
//
// Recognizes three statement forms:
//
//   def SPEAKER <id> name "<Display Name>" color <colorExpr>
//   say <speakerId> "<line>" [wait <ms>]
//   choice <speakerId> "<prompt>"
//     option "<label>" -> <signalName>
//     option "<label>" -> <signalName>
//     ...
//   end choice
//
// Every recognized form rewrites into a JS_BLOCK node — CDRCA's own "raw
// embedded JS" AST node — the same strategy Quark and cdrca-reactive-state
// both use, so no changes to CDRCA's code generator are needed. The
// generated code calls into a small browser-side runtime (campfire-core.js,
// the always-load-first library bundle — see cdrca.json's `libraries` map
// and this plugin's README) that owns the actual dialogue queue, speaker
// registry, and choice-signal dispatch. This file only turns DSL tokens
// into that runtime's calls; it never touches fs/child_process, so it
// declares `permissions: []` in cdrca.json.
//
// Coexistence with `animations` and other plugins: `def` is shared with
// the built-in `animations` plugin's own `def ACTION`/`def PROP` — this
// plugin only claims a `def` statement when the token immediately after
// it is the literal identifier `SPEAKER`; any other word after `def` and
// this plugin declines (returns undefined) immediately, before consuming
// anything, so `animations` (or any other plugin) gets a clean look at
// it. `say`/`choice`/`end` are otherwise-unclaimed keywords in every
// plugin shipped alongside this one at the time of writing, so no
// higher-priority coexistence dance is needed the way
// cdrca-reactive-state needed for its generic "@id identifier" clash with
// Quark — this plugin still follows the same "bail if a higher-priority
// plugin already produced a node" guard as its first line, for free
// forward-compatibility with a plugin published later that claims one of
// these words first.
//
// Tokenizer workaround (same documented, verified bug Quark and
// cdrca-reactive-state both work around): a single-character identifier
// or single-digit number immediately followed by another token can have
// its `.type` silently overwritten with the *following* token's type.
// `.value` is never corrupted — this file classifies every token by the
// shape of `.value`, never by `.type`.

module.exports = function (pluginAPI /*, hostAPI */) {
  pluginAPI.register(0, "syntax", "customRule", campfireCustomRule);
};

// ---------------------------------------------------------------------
// Token-shape helpers (never trust `.type` — see the note above)
// ---------------------------------------------------------------------

function isIdentifierLike(t) {
  return !!t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value);
}

function isKeyword(t, word) {
  return !!t && t.value === word;
}

function isNewlineToken(t) {
  return !!t && t.value === "\n";
}

function isStringLike(t) {
  return (
    !!t &&
    typeof t.value === "string" &&
    t.value.length >= 2 &&
    t.value[0] === '"' &&
    t.value[t.value.length - 1] === '"'
  );
}

function isNumberLike(t) {
  return !!t && /^\d+(\.\d+)?$/.test(t.value);
}

function skipNewlines(tokens, pos) {
  let p = pos;
  while (p < tokens.length && isNewlineToken(tokens[p])) p++;
  return p;
}

// Concatenates every token's literal text with no added whitespace, up to
// (but not including) the terminating newline/end-of-input. Used for
// color expressions for the exact reason Quark's plugin.js uses it for
// `= <value>`: CDRCA's real tokenizer can split what looks like one
// literal into several tokens (a verified behavior for `#RRGGBB`-style
// CSS hex; campfire standardizes on animations' own `0xRRGGBB` numeric
// convention instead — see BGcolor in the animations plugin — but this
// plugin still makes no assumption about how many tokens that becomes,
// for the same robustness reason Quark didn't).
function readRawUntilNewline(tokens, pos) {
  const parts = [];
  let p = pos;
  while (p < tokens.length && !isNewlineToken(tokens[p])) {
    parts.push(tokens[p].value);
    p++;
  }
  return { raw: parts.join(""), newPosition: p };
}

function jsBlock(code, newPosition) {
  return { type: "JS_BLOCK", prams: { code }, newPosition };
}

// ---------------------------------------------------------------------
// def SPEAKER <id> name "<Display Name>" color <colorExpr>
// ---------------------------------------------------------------------

function parseSpeakerDecl(tokens, pos) {
  // pos is at "SPEAKER" — already confirmed by the dispatcher.
  let p = pos + 1;

  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("campfire: expected a speaker id after 'def SPEAKER'");
  }
  const id = tokens[p].value;
  p++;

  if (!isKeyword(tokens[p], "name")) {
    throw new Error(`campfire: expected 'name' after 'def SPEAKER ${id}'`);
  }
  p++;

  if (p >= tokens.length || !isStringLike(tokens[p])) {
    throw new Error(`campfire: expected a quoted display name after 'def SPEAKER ${id} name'`);
  }
  const displayNameLiteral = tokens[p].value; // already includes its own quotes
  p++;

  if (!isKeyword(tokens[p], "color")) {
    throw new Error(`campfire: expected 'color' after 'def SPEAKER ${id} name ${displayNameLiteral}'`);
  }
  p++;

  const { raw: colorExpr, newPosition } = readRawUntilNewline(tokens, p);
  if (!colorExpr) {
    throw new Error(`campfire: expected a color value after 'def SPEAKER ${id} ... color'`);
  }

  const code = `Campfire.defineSpeaker(${JSON.stringify(id)}, { name: ${displayNameLiteral}, color: (${colorExpr}) });`;
  return jsBlock(code, newPosition);
}

// ---------------------------------------------------------------------
// say <speakerId> "<line>" [wait <ms>]
// ---------------------------------------------------------------------

function parseSay(tokens, pos) {
  // pos is at the token right after "say".
  let p = pos;

  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("campfire: expected a speaker id after 'say'");
  }
  const speakerId = tokens[p].value;
  p++;

  if (p >= tokens.length || !isStringLike(tokens[p])) {
    throw new Error(`campfire: expected a quoted line after 'say ${speakerId}'`);
  }
  const lineLiteral = tokens[p].value;
  p++;

  let waitMs = null;
  if (isKeyword(tokens[p], "wait")) {
    p++;
    if (p >= tokens.length || !isNumberLike(tokens[p])) {
      throw new Error(`campfire: expected a number of milliseconds after 'say ${speakerId} ${lineLiteral} wait'`);
    }
    waitMs = tokens[p].value;
    p++;
  }

  if (p < tokens.length && !isNewlineToken(tokens[p])) {
    throw new Error(`campfire: unexpected token after 'say ${speakerId} ${lineLiteral}${waitMs !== null ? " wait " + waitMs : ""}'`);
  }

  const optsArg = waitMs !== null ? `, { wait: ${waitMs} }` : "";
  const code = `Campfire.say(${JSON.stringify(speakerId)}, ${lineLiteral}${optsArg});`;
  return jsBlock(code, p);
}

// ---------------------------------------------------------------------
// choice <speakerId> "<prompt>"
//   option "<label>" -> <signalName>
//   ...
// end choice
// ---------------------------------------------------------------------

function parseChoice(tokens, pos) {
  // pos is at the token right after "choice".
  let p = pos;

  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("campfire: expected a speaker id after 'choice'");
  }
  const speakerId = tokens[p].value;
  p++;

  if (p >= tokens.length || !isStringLike(tokens[p])) {
    throw new Error(`campfire: expected a quoted prompt after 'choice ${speakerId}'`);
  }
  const promptLiteral = tokens[p].value;
  p++;

  p = skipNewlines(tokens, p);

  const options = [];
  while (true) {
    if (p >= tokens.length) {
      throw new Error(`campfire: 'choice ${speakerId} ${promptLiteral}' is missing its closing 'end choice'`);
    }

    if (isKeyword(tokens[p], "end")) {
      if (!isKeyword(tokens[p + 1], "choice")) {
        throw new Error("campfire: expected 'choice' after 'end' to close a choice block");
      }
      p += 2;
      break;
    }

    if (!isKeyword(tokens[p], "option")) {
      throw new Error(
        `campfire: expected 'option' or 'end choice' inside 'choice ${speakerId} ${promptLiteral}', found '${tokens[p].value}'`
      );
    }
    p++;

    if (p >= tokens.length || !isStringLike(tokens[p])) {
      throw new Error("campfire: expected a quoted label after 'option'");
    }
    const labelLiteral = tokens[p].value;
    p++;

    if (!(isKeyword(tokens[p], "-") && isKeyword(tokens[p + 1], ">"))) {
      throw new Error(`campfire: expected '->' after 'option ${labelLiteral}'`);
    }
    p += 2;

    if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
      throw new Error(`campfire: expected a signal name after 'option ${labelLiteral} ->'`);
    }
    const signal = tokens[p].value;
    p++;

    options.push({ label: labelLiteral, signal });
    p = skipNewlines(tokens, p);
  }

  if (options.length === 0) {
    throw new Error(`campfire: 'choice ${speakerId} ${promptLiteral}' needs at least one 'option'`);
  }

  const optionsArg = options
    .map((o) => `{ label: ${o.label}, signal: ${JSON.stringify(o.signal)} }`)
    .join(", ");
  const code = `Campfire.choice(${JSON.stringify(speakerId)}, ${promptLiteral}, [${optionsArg}]);`;
  return jsBlock(code, p);
}

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------

function campfireCustomRule(currentValue, ctx) {
  // Another (higher-priority) plugin already produced a node for this
  // statement — don't override it.
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};
  if (!token) return undefined;

  if (token.value === "def") {
    // Only claim it if the very next word is exactly SPEAKER — anything
    // else (ACTION, PROP, ...) belongs to a different plugin, decline
    // before consuming a single extra token.
    if (!isKeyword(tokens[pos + 1], "SPEAKER")) return undefined;
    return parseSpeakerDecl(tokens, pos + 1);
  }

  if (token.value === "say") {
    return parseSay(tokens, pos + 1);
  }

  if (token.value === "choice") {
    return parseChoice(tokens, pos + 1);
  }

  return undefined;
}

module.exports.__internals = {
  campfireCustomRule,
  parseSpeakerDecl,
  parseSay,
  parseChoice,
  isIdentifierLike,
  isStringLike,
  isNumberLike,
  isNewlineToken,
};
