// Whole-tab fan-out tests — node test/frames.test.mjs
//
// `chrome.tabs.sendMessage` broadcasts to every frame of a tab but returns only
// ONE reply. That is the wrong shape here, because on an embedded board —
// Greenhouse, Lever, Workable and SmartRecruiters all ship one, and employers
// use it constantly — the top frame has no fields and the iframe has all of
// them. The popup either reported the top frame's zero, or got a closed port and
// told the user "Chrome blocks extensions here" while the iframe had just filled
// twenty fields.
//
// The replacement collects acknowledgements to learn how many frames to expect,
// then waits for all of them. That is a small piece of concurrency with three
// ways to go wrong — never resolving, resolving before the slow frame is in, or
// resolving twice — so it is tested against a fake tab rather than by eye.

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../background.js", import.meta.url), "utf8");

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push({ desc, got: g, want: w });
};

/**
 * Load `fanOut` and `mergeFrames` out of the real background.js.
 *
 * The module imports chrome-only code and registers listeners at load, so the
 * two functions under test are lifted out by source rather than by importing the
 * module. They are self-contained; the extraction is checked below so this
 * cannot silently start testing nothing.
 */
function loadCoordinator({ frames, ackDelay = 0, resultDelay = () => 0 }) {
  const grab = (name) => {
    const start = SRC.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} not found in background.js`);

    // Walk the parameter list out first. A default like `extra = {}` puts a
    // balanced pair of braces in the *signature*, so counting braces from the
    // first one found closes the function before its body has even started.
    let parens = 0, bodyStart = -1;
    for (let j = SRC.indexOf("(", start); j < SRC.length; j++) {
      if (SRC[j] === "(") parens++;
      else if (SRC[j] === ")" && --parens === 0) { bodyStart = SRC.indexOf("{", j); break; }
    }
    if (bodyStart === -1) throw new Error(`${name} has no body`);

    let depth = 0;
    for (let j = bodyStart; j < SRC.length; j++) {
      if (SRC[j] === "{") depth++;
      else if (SRC[j] === "}" && --depth === 0) return SRC.slice(start, j + 1);
    }
    throw new Error(`${name} has unbalanced braces`);
  };

  const runs = new Map();
  let nextRunId = 1;

  // The fake tab: every frame acks, then reports after its own delay.
  const chrome = {
    tabs: {
      sendMessage: async (_tabId, message) => {
        if (message.type === "rf_log_fill") return;
        for (const [i, f] of frames.entries()) {
          if (message.skipTop && f.isTop) continue;
          setTimeout(() => {
            const run = runs.get(message.runId);
            if (run) run.acks.add(i);
          }, ackDelay);
          setTimeout(() => {
            const run = runs.get(message.runId);
            if (!run) return;
            run.results.push({ ...f.result, isTop: f.isTop });
            if (run.ackWindowClosed && run.results.length >= run.acks.size) run.finish();
          }, resultDelay(f));
        }
      }
    }
  };

  const factory = new Function("chrome", "runs", "nextRunIdRef", "FRAME_ACK_MS", "FRAME_RESULT_MS", `
    let nextRunId = nextRunIdRef.v;
    ${grab("fanOut")}
    ${grab("mergeFrames")}
    return { fanOut, mergeFrames };
  `);

  return factory(chrome, runs, { v: nextRunId }, 60, 2000);
}

// ── The extraction itself ────────────────────────────────────────────────────
//
// Everything below runs code lifted out of background.js by string search. If
// that search ever quietly returns the wrong slice, every assertion after it
// becomes a test of nothing — so the lifted source is checked for the parts that
// carry the behaviour before any of it is trusted.
{
  const src = SRC.slice(SRC.indexOf("function fanOut("));
  check("fanOut acknowledges before waiting", /ackWindowClosed/.test(src), true);
  check("fanOut broadcasts to the tab", /chrome\.tabs\.sendMessage/.test(src), true);
  check("fanOut has a hard timeout", /hardTimer/.test(src), true);
  check("mergeFrames prefers the top frame for host/disabled",
    /k === "isTop" \|\| k === "host" \|\| k === "disabled"/.test(SRC), true);
}

const FRAMES = {
  // The case this exists for: a company careers page with the form in an iframe.
  embedded: [
    { isTop: true,  result: { ok: true, filled: 0, total: 0 } },
    { isTop: false, result: { ok: true, filled: 20, total: 24 } }
  ],
  ordinary: [{ isTop: true, result: { ok: true, filled: 12, total: 15 } }],
  none: []
};

// ── The embedded-board case ──────────────────────────────────────────────────
{
  const { fanOut, mergeFrames } = loadCoordinator({ frames: FRAMES.embedded });
  const results = await fanOut(1, "rf_fill");
  check("both frames report", results.length, 2);

  const merged = mergeFrames(results);
  check("the iframe's fill is counted, not the top frame's zero", merged.filled, 20);
  check("totals add up across frames", merged.total, 24);
}

// ── A slow frame must not be dropped ─────────────────────────────────────────
{
  // The top frame answers instantly; the one doing the real work takes a while,
  // which is exactly what an AI-assisted fill looks like. Resolving on the first
  // reply would report zero.
  const { fanOut, mergeFrames } = loadCoordinator({
    frames: FRAMES.embedded,
    resultDelay: (f) => (f.isTop ? 0 : 400)
  });
  const merged = mergeFrames(await fanOut(1, "rf_fill"));
  check("waits for the slow frame that holds the form", merged.filled, 20);
}

// ── No engine anywhere ───────────────────────────────────────────────────────
{
  const { fanOut } = loadCoordinator({ frames: FRAMES.none });
  const results = await fanOut(1, "rf_fill");
  // Resolving empty rather than hanging is what lets the caller tell "no engine
  // loaded here yet" (retry after forcing it in) from "this page is off limits".
  check("an empty tab resolves instead of hanging", results.length, 0);
}

// ── The ordinary single-frame page still works ───────────────────────────────
{
  const { fanOut, mergeFrames } = loadCoordinator({ frames: FRAMES.ordinary });
  const merged = mergeFrames(await fanOut(1, "rf_fill"));
  check("a plain page reports its own count", merged.filled, 12);
}

// ── skipTop, used by the on-page panel ───────────────────────────────────────
{
  // The panel fills its own frame directly so it can show progress, then asks
  // for the rest of the tab. Its own frame must not run twice.
  const { fanOut, mergeFrames } = loadCoordinator({ frames: FRAMES.embedded });
  const merged = mergeFrames(await fanOut(1, "rf_fill", { skipTop: true }));
  check("skipTop leaves the panel's own frame alone", merged.filled, 20);
}

// ── Merging rules ────────────────────────────────────────────────────────────
{
  const { mergeFrames } = loadCoordinator({ frames: FRAMES.none });

  check("numbers add", mergeFrames([{ filled: 2 }, { filled: 3 }]).filled, 5);
  check("booleans OR", mergeFrames([{ canUndo: false }, { canUndo: true }]).canUndo, true);
  check("arrays concatenate",
    mergeFrames([{ trail: ["a"] }, { trail: ["b"] }]).trail, ["a", "b"]);

  // `disabled` and `host` describe the page, so they come from the top frame.
  // OR-ing `disabled` would report the extension as switched off here because
  // some unrelated embedded iframe happened to sit on a blocked host.
  const mixed = mergeFrames([
    { isTop: true, host: "acme.com", disabled: false },
    { isTop: false, host: "greenhouse.io", disabled: true }
  ]);
  check("host comes from the top frame", mixed.host, "acme.com");
  check("a blocked subframe does not switch the whole tab off", mixed.disabled, false);
  check("isTop is not leaked into the merged result", mixed.isTop, undefined);
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
