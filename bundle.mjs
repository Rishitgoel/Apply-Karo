// Apply karo — engine bundler.
//
//   node bundle.mjs
//
// Flattens the engine's ES module graph into ONE classic script,
// src/engine/bundle.js, which the service worker injects with
// chrome.scripting.executeScript().
//
// Why this exists at all
// ──────────────────────
// The engine used to reach the page as a dynamic import from the content
// script, which meant listing src/engine/*.js and src/shared/*.js in
// web_accessible_resources. That is the thing worth avoiding: a web-accessible
// resource at a predictable chrome-extension://<id>/... URL lets any page you
// visit probe for it and learn the extension is installed. `use_dynamic_url`
// was the intended answer to that, and it does hide the URL — but Chrome will
// not serve a module-script fetch from the rotating GUID origin it hands back,
// so `import()` failed with "Failed to fetch dynamically imported module" on
// every site, and the engine never loaded anywhere.
//
// executeScript() has neither problem: nothing is web-accessible, so there is
// nothing to probe, and Chrome injects the file directly rather than making the
// page fetch it, so no page CSP or URL-mapping sits in the way. The cost is
// that executeScript cannot run ES modules — hence this file.
//
// What it supports, and what it refuses
// ─────────────────────────────────────
// Deliberately not a general bundler. It handles exactly the subset the engine
// uses — named imports and named exports over an acyclic graph — and THROWS on
// anything else rather than emitting something subtly wrong. A bundler that
// quietly mistranslates `export default` is worse than one that will not build.
//
// Each module keeps its own scope, wrapped in a factory. That is not tidiness:
// flattened into one scope, `runSteps` in engine/steps.js and `runSteps` in
// engine/index.js would collide silently and one would win.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath, relative, sep } from "node:path";

const ROOT = import.meta.dirname;
const ENTRY = "src/engine/index.js";
const OUT = "src/engine/bundle.js";

const toId = (abs) => relative(ROOT, abs).split(sep).join("/");
const read = (id) => readFileSync(resolvePath(ROOT, id), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Forms this bundler will not guess at
// ─────────────────────────────────────────────────────────────────────────────

const REFUSED = [
  [/^import\s+\*\s+as\s/m, "namespace import (import * as x)"],
  [/^import\s+[A-Za-z_$]/m, "default import"],
  [/^import\s+["']/m, "side-effect-only import"],
  [/^export\s+default\b/m, "export default"],
  [/^export\s*\*/m, "export * re-export"],
  [/^export\s*\{/m, "export list / re-export (export { x })"],
  [/^export\s+(let|var)\b/m, "mutable export (live binding)"]
];

/**
 * Named bindings of one import clause, as an object-destructuring pattern.
 * `a, b as c` → `a, b: c`. Aliasing is why this cannot be a plain string copy:
 * engine/index.js imports `runSteps as stepThrough` and exports its own
 * `runSteps`, and only the alias keeps those apart.
 */
function bindings(clause) {
  return clause
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const as = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return as ? `${as[1]}: ${as[2]}` : s;
    })
    .join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform one module
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;
const DYNAMIC_IMPORT = /import\(\s*chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)\s*\)/g;
const EXPORT_DECL = /^export\s+(async\s+function|function|const|class)\s+([A-Za-z_$][\w$]*)/gm;

function transform(id) {
  let src = read(id);
  const deps = new Set();

  for (const [re, what] of REFUSED) {
    if (re.test(src)) throw new Error(`${id}: unsupported ${what} — the bundler would have to guess`);
  }

  // Static imports become a destructure off the dependency's exports object.
  // Safe only because the graph is acyclic and nothing exports a `let`: both
  // are enforced above and in build(), so a snapshot equals a live binding.
  src = src.replace(STATIC_IMPORT, (_m, clause, spec) => {
    const dep = toId(resolvePath(dirname(resolvePath(ROOT, id)), spec));
    deps.add(dep);
    return `const { ${bindings(clause)} } = __req(${JSON.stringify(dep)});`;
  });

  // `await import(chrome.runtime.getURL("src/engine/panel.js"))` — the panel is
  // in the bundle now, so this resolves without a fetch. It stays a promise so
  // the `await` at the call site keeps working untouched.
  src = src.replace(DYNAMIC_IMPORT, (_m, spec) => {
    deps.add(spec);
    return `Promise.resolve(__req(${JSON.stringify(spec)}))`;
  });

  // Exports lose the keyword and are published in one assignment at the end of
  // the body. End, not inline: a module is fully evaluated before __req hands
  // its exports to anyone, so late publication is invisible — and it avoids
  // rewriting the middle of a declaration.
  const names = [];
  src = src.replace(EXPORT_DECL, (_m, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });

  const leftover = src.match(/^(import|export)\b.*/m);
  if (leftover) throw new Error(`${id}: unhandled module syntax — ${leftover[0].trim()}`);

  return {
    deps: [...deps],
    code: `__m[${JSON.stringify(id)}] = (__x, __req) => {\n${src}\n` +
          (names.length ? `Object.assign(__x, { ${names.join(", ")} });\n` : "") +
          `};\n`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Walk the graph
// ─────────────────────────────────────────────────────────────────────────────

export function buildBundle() {
  const modules = new Map();
  const stack = [];

  /** Depth-first, with the path carried so a cycle can name itself. */
  const visit = (id, path) => {
    if (path.includes(id)) {
      throw new Error(`import cycle: ${[...path, id].join(" -> ")}\n` +
        "  Snapshot destructuring cannot express a cycle. Break it before bundling.");
    }
    if (modules.has(id)) return;
    const { deps, code } = transform(id);
    modules.set(id, code);                      // set before recursing: DAG only
    for (const d of deps) visit(d, [...path, id]);
  };

  visit(ENTRY, stack);

  const body = [...modules.values()].join("\n");

  const out = `// GENERATED FILE — DO NOT EDIT.
//
// Built from ${ENTRY} and its imports by \`node bundle.mjs\`.
// Edit the sources under src/engine/ and src/shared/, then rebuild.
//
// This is a classic script on purpose: chrome.scripting.executeScript() cannot
// run ES modules, and executeScript is how the engine gets onto the page —
// nothing here is web-accessible, so no site can probe for the extension.
(() => {
  "use strict";

  // boot() is async and nothing here awaits it, so a failed start would leave
  // no trace but an unhandled rejection. Say so instead — this is the failure
  // that makes every button in the popup report "Couldn't reach the page".
  const __start = (engine) => Promise.resolve(engine.boot())
    .catch((err) => console.error("Apply karo: engine failed to start —", err));

  // Injected once per frame, but the service worker is asked to inject on both
  // automatic detection and an explicit "Fill this page". A second run must not
  // build a second module registry: that would mean a second message listener,
  // a second MutationObserver and a second panel. The isolated world is shared
  // with the content script, so this flag survives between injections.
  if (window.__applyKaroEngine) { __start(window.__applyKaroEngine); return; }

  const __m = {};
  const __c = {};
  const __req = (id) => {
    if (__c[id]) return __c[id];
    const x = (__c[id] = {});
    __m[id](x, __req);
    return x;
  };

${body}
  window.__applyKaroEngine = __req(${JSON.stringify(ENTRY)});
  __start(window.__applyKaroEngine);
})();
`;

  // Parse it before writing. A bundle that does not compile fails here, at
  // build time, rather than as a silent dead extension on someone's browser.
  try {
    new Function(out);
  } catch (err) {
    throw new Error(`generated bundle does not parse: ${err.message}`);
  }

  writeFileSync(resolvePath(ROOT, OUT), out);
  return { path: OUT, modules: [...modules.keys()], bytes: Buffer.byteLength(out) };
}

if (import.meta.filename === process.argv[1]) {
  const r = buildBundle();
  console.log(`${r.path}`);
  console.log(`  ${r.modules.length} modules · ${(r.bytes / 1024).toFixed(1)} KB`);
  for (const m of r.modules) console.log(`    ${m}`);
}
