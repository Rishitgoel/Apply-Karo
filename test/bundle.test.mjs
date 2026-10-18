// Engine bundle tests — node test/bundle.test.mjs
//
// src/engine/bundle.js is generated, and it is the only copy of the engine that
// ever reaches a page: the service worker injects it with executeScript, and
// nothing under src/engine/ is web-accessible any more. So a bundler bug is not
// a build-time annoyance, it is a dead extension — and the last one of those
// (`use_dynamic_url` making the engine unfetchable) shipped precisely because
// nothing here ran the thing end to end.
//
// `node bundle.mjs` already refuses the module syntax it cannot translate and
// parses its own output. What it cannot tell you is whether the result RUNS,
// which is what this file is for.

import { buildBundle } from "../bundle.mjs";
import { readFileSync } from "node:fs";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push({ desc, got: g, want: w });
};

const built = buildBundle();
const SRC = readFileSync(new URL(`../${built.path}`, import.meta.url), "utf8");

// ── The bundler covered the whole graph ──
for (const id of [
  "src/engine/index.js", "src/engine/scan.js", "src/engine/fill.js",
  "src/engine/steps.js", "src/engine/panel.js", "src/engine/inline.js",
  "src/shared/schema.js", "src/shared/rules.js", "src/shared/values.js",
  "src/shared/icons.js", "src/shared/theme.js", "src/shared/contact.js",
  // Reading a posting lives outside the engine — the service worker injects it
  // on its own, into listing pages the engine never reaches — but the engine
  // still uses it, so it has to come along.
  "src/shared/posting.js"
]) {
  check(`bundle includes ${id}`, built.modules.includes(id), true);
}

// ── Nothing web-accessible survived, and no module syntax leaked ──
check("no static import left", /^\s*import\s/m.test(SRC), false);
check("no export keyword left", /^\s*export\s/m.test(SRC), false);
check("panel is required, not fetched", SRC.includes('__req("src/engine/panel.js")'), true);
check("aliased import kept its alias", SRC.includes("runSteps: stepThrough"), true);

// ─────────────────────────────────────────────────────────────────────────────
// Run it
//
// Enough of a browser to get the engine through evaluation and boot(). This is
// not a DOM: it is the smallest surface the engine touches on the way in, and
// anything it reaches for that is missing shows up as a thrown error below.
// ─────────────────────────────────────────────────────────────────────────────

function fakeWorld() {
  const listeners = [];
  const el = () => {
    const node = {
      id: "", textContent: "", innerHTML: "", tagName: "DIV", dataset: {},
      style: { setProperty() {}, getPropertyValue: () => "" },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild: (c) => c, append() {}, prepend() {}, insertBefore: (c) => c,
      setAttribute() {}, getAttribute: () => null, removeAttribute() {}, remove() {},
      addEventListener() {}, removeEventListener() {},
      // querySelectorAll returns nothing (the page has no fields), but
      // querySelector hands back a node: the panel builds its own markup with
      // innerHTML and then looks its parts up, and a stub that cannot parse
      // HTML would fail those lookups for reasons that say nothing about the
      // bundler. `closest` stays null — the engine reads it as "not inside our
      // own UI", which is the answer that keeps its guards honest.
      querySelectorAll: () => [], querySelector: () => el(), closest: () => null,
      getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
      getClientRects: () => [], focus() {}, blur() {}, scrollIntoView() {},
      // The panel mounts into a shadow root; without this the boot path stops
      // at mount() and the panel half of the graph is never actually executed.
      attachShadow: () => el(),
      animate: () => ({ finished: Promise.resolve(), cancel() {} })
    };
    return node;
  };

  const document = {
    documentElement: el(),
    head: el(),
    body: { ...el(), textContent: "" },
    visibilityState: "visible",
    title: "",
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: el,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null
  };

  const window = {
    document,
    requestIdleCallback: (fn) => { fn(); return 0; },
    requestAnimationFrame: (fn) => { fn(); return 0; },
    addEventListener: () => {},
    location: { hostname: "boards.greenhouse.io", href: "https://boards.greenhouse.io/acme/jobs/1" },
    getComputedStyle: () => ({ getPropertyValue: () => "" })
  };
  window.top = window;               // IS_TOP, read at module evaluation time
  window.self = window;

  const store = {};
  const chrome = {
    runtime: {
      id: "test",
      getURL: (p) => `chrome-extension://test/${p}`,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: () => Promise.resolve({ ok: true })
    },
    storage: {
      onChanged: { addListener: () => {} },
      local: {
        get: async () => ({ ...store }),
        set: async (patch) => { Object.assign(store, patch); }
      }
    }
  };

  return { window, document, chrome, listeners };
}

// boot() is async and reports its own failures through console.error rather
// than by throwing at the injection site, so a boot that dies halfway would
// otherwise pass every assertion below. Collect them and check.
const bootErrors = [];
const quietConsole = {
  ...console,
  debug() {}, info() {}, warn() {},
  error: (...args) => bootErrors.push(args.map(String).join(" "))
};

const world = fakeWorld();

/**
 * Inject the bundle into `world`, the way executeScript would.
 *
 * The globals listed here are the complete set the engine reaches for on the
 * way in — anything it needs and this misses arrives as a ReferenceError, which
 * is the honest signal that the injected surface has changed.
 */
function inject() {
  try {
    new Function("window", "document", "chrome", "location", "self", "performance",
                 "console", "MutationObserver", "setTimeout", "matchMedia",
                 "requestAnimationFrame", "requestIdleCallback", SRC)(
      world.window, world.document, world.chrome, world.window.location, world.window,
      { now: () => 0 },
      quietConsole,
      function () { return { observe() {}, disconnect() {} }; },
      (fn) => { if (typeof fn === "function") fn(); return 0; },
      () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      (fn) => { fn(); return 0; },
      (fn) => { fn(); return 0; }
    );
    return null;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

check("the bundle evaluates without throwing", inject(), null);

const engine = world.window.__applyKaroEngine;
check("it publishes the engine on the isolated-world global", !!engine, true);

// The exports the popup, the panel and the service worker actually call. A
// name-collision bug in the bundler — two modules exporting `runSteps` — shows
// up right here as the wrong function or none at all.
for (const name of ["boot", "run", "runSteps", "undoFill", "canUndo", "pageStatus",
                    "highlightEmpty", "matchThisJob", "writeCoverLetter",
                    "placeLetter", "ruleValue", "widgetTurn"]) {
  check(`exports ${name}()`, typeof engine?.[name], name === "canUndo" ? "function" : "function");
}

// ── Injecting twice must not build a second engine ──
{
  const before = world.window.__applyKaroEngine;
  check("a second injection does not throw", inject(), null);
  check("a second injection reuses the first engine", world.window.__applyKaroEngine === before, true);
}

// ── boot() ran to completion ──
//
// Last, so the storage reads and the panel mount inside it have had their
// turn on the microtask queue.
await new Promise((r) => setTimeout(r, 0));
check("boot() completed without reporting an error", bootErrors, []);

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) {
  console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
}
if (fails.length) process.exit(1);
