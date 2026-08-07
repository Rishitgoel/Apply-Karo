// Apply karo — service worker.
//
// Owns everything that must not live in a page: API keys, network calls, and
// the storage migration. Content scripts ask for work by message and never see
// credentials.

import {
  migrateFromV1, loadContext, loadResumeFile, save, resumeTextIsCurrent
} from "./src/shared/schema.js";
// Everything is imported statically: dynamic import() is disallowed inside a
// ServiceWorkerGlobalScope (w3c/ServiceWorker#1356), so a lazy import here fails
// at call time rather than at load time.
import {
  analyzeFields, coverLetter, parseResumePdf, extractProfile,
  matchJob, generate, resolveProvider, canReadPdf
} from "./src/shared/ai.js";

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateFromV1();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => { migrateFromV1(); });

/**
 * The resume as plain text, parsing the stored PDF once if needed and caching
 * the result. Without this the AI pass only ever saw the profile summary, which
 * is why it left most open-ended questions blank.
 *
 * Only Gemini can read a PDF. On Groq this returns whatever text is already
 * stored (pasted or parsed earlier) rather than failing the whole fill.
 */
let resumeTextPromise = null;

async function ensureResumeText(settings) {
  const { resumeMeta } = await loadContext();

  // Not merely "is there text" — is it text about the resume that is stored
  // *now*. Replacing your resume used to leave the previous one's text in place,
  // and this returned it happily, so every AI answer and every job match went on
  // describing the resume you had just swapped out. Nothing on screen said so.
  if (resumeTextIsCurrent(resumeMeta)) return resumeMeta.text;

  if (!canReadPdf(settings)) return resumeMeta.text || "";   // stale beats nothing
  if (!resolveProvider(settings).apiKey) return resumeMeta.text || "";

  // Collapse concurrent callers onto one parse — a fill can ask several times.
  if (!resumeTextPromise) {
    resumeTextPromise = (async () => {
      const dataUrl = await loadResumeFile();
      if (!dataUrl) return resumeMeta.text || "";
      const text = await parseResumePdf(settings, dataUrl);
      if (text?.trim()) {
        await save({ resumeMeta: { ...resumeMeta, text, textFileName: resumeMeta.fileName || "" } });
        return text;
      }
      return resumeMeta.text || "";
    })().catch((err) => {
      console.warn("Apply karo: could not parse the resume —", err.message);
      return resumeMeta.text || "";
    }).finally(() => { resumeTextPromise = null; });
  }
  return resumeTextPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole-tab actions
//
// `chrome.tabs.sendMessage` delivers to every frame in a tab but returns only
// ONE reply — the first frame to call sendResponse wins and the rest are
// discarded. That is the wrong shape for this extension, because the frame
// holding the application is very often not the frame the popup is looking at:
// Greenhouse, Lever and Workable all embed their board into a company careers
// page, so the top frame has no fields and the iframe has all of them.
//
// The result was that the popup either reported the top frame's zero, or — when
// the top frame had no engine at all and so nobody answered — got a closed port
// and told the user "Chrome blocks extensions here", while the iframe had in
// fact just filled twenty fields.
//
// So the reply does not travel back down the broadcast channel. Every frame that
// picks up the work acknowledges, does it, and reports the outcome as a fresh
// message; this collects the acknowledgements to learn how many frames to expect
// and resolves once they have all reported. Page script cannot reach any of it,
// which a window.postMessage relay between frames could not have promised — and
// a fill spends the user's real name, address and phone number, so "the page
// cannot ask for one" is a property worth keeping.
// ─────────────────────────────────────────────────────────────────────────────

/** How long to wait for frames to put their hands up. */
const FRAME_ACK_MS = 500;

/** Ceiling on one whole-tab action. An AI-assisted fill is genuinely slow. */
const FRAME_RESULT_MS = 120000;

let nextRunId = 1;
const runs = new Map();

function fanOut(tabId, action, extra = {}) {
  return new Promise((resolve) => {
    const runId = `r${nextRunId++}`;
    const run = { acks: new Set(), results: [], ackWindowClosed: false, done: false };
    runs.set(runId, run);

    run.finish = () => {
      if (run.done) return;
      run.done = true;
      clearTimeout(run.ackTimer);
      clearTimeout(run.hardTimer);
      runs.delete(runId);
      resolve(run.results);
    };

    // The reply channel is deliberately unused; results arrive as new messages.
    chrome.tabs.sendMessage(tabId, { type: action, runId, ...extra }).catch(() => {});

    run.ackTimer = setTimeout(() => {
      run.ackWindowClosed = true;
      // No acknowledgement from anywhere means no engine is loaded in this tab.
      if (!run.acks.size || run.results.length >= run.acks.size) run.finish();
    }, FRAME_ACK_MS);

    run.hardTimer = setTimeout(run.finish, FRAME_RESULT_MS);
  });
}

/**
 * Fold per-frame results into one.
 *
 * Numbers add, booleans OR, arrays concatenate. Two keys are taken from the top
 * frame instead: `host` and `disabled` describe the page as a whole, and OR-ing
 * `disabled` across frames would report the extension as switched off here
 * because some embedded third-party iframe happened to be on a blocked host.
 */
function mergeFrames(results) {
  const out = {};
  const top = results.find((r) => r?.isTop);

  for (const r of results) {
    for (const [k, v] of Object.entries(r || {})) {
      if (k === "isTop" || k === "host" || k === "disabled") continue;
      if (typeof v === "number") out[k] = (out[k] || 0) + v;
      else if (typeof v === "boolean") out[k] = !!out[k] || v;
      else if (Array.isArray(v)) out[k] = [...(out[k] || []), ...v];
      else if (out[k] === undefined) out[k] = v;
    }
  }

  if (top) {
    if (top.host !== undefined) out.host = top.host;
    if (top.disabled !== undefined) out.disabled = top.disabled;
  }
  return out;
}

/** Route a message to a handler, keeping the async channel open correctly. */
const handlers = {
  /** A frame has picked up a whole-tab action and intends to report back. */
  async rf_frame_ack({ runId }, sender) {
    const run = runs.get(runId);
    if (run) run.acks.add(sender?.frameId ?? 0);
    return { ok: true };
  },

  /** A frame has finished. Resolve the run once every acked frame is in. */
  async rf_frame_result({ runId, result }) {
    const run = runs.get(runId);
    if (!run) return { ok: true };                 // arrived after the timeout
    run.results.push(result || {});
    if (run.ackWindowClosed && run.results.length >= run.acks.size) run.finish();
    return { ok: true };
  },

  /**
   * Run one action across every frame of a tab and return the total.
   *
   * `tabId` comes from the popup, which knows it; a content script (the on-page
   * panel) omits it and is identified by its sender instead.
   */
  async tab_action({ action, tabId, ...rest }, sender) {
    const id = tabId ?? sender?.tab?.id;
    if (id === undefined) return { ok: false, error: "No tab to act on." };

    const results = await fanOut(id, action, rest);
    const merged = mergeFrames(results);

    // Hand the tab-wide total to the top frame so the tracker can record it.
    // `recordApplication` keeps one row per URL and takes the larger `filled`,
    // so this settling on top of a frame's own smaller count is harmless.
    if (action === "rf_fill" && merged.filled > 0) {
      chrome.tabs.sendMessage(id, {
        type: "rf_log_fill", filled: merged.filled, total: merged.total || 0
      }).catch(() => {});
    }

    // `frames` is what tells the caller apart from a tab with no engine in it,
    // which is a retryable state rather than a failure.
    return { ok: true, frames: results.length, ...merged };
  },

  async open_options() {
    chrome.runtime.openOptionsPage();
    return { ok: true };
  },

  /**
   * Number of fields filled, on the toolbar icon.
   *
   * Per tab, so switching tabs cannot leave a stale count claiming that the page
   * you are now looking at was filled. It clears itself once you navigate.
   */
  async set_badge({ count }, sender) {
    const tabId = sender?.tab?.id;
    if (tabId === undefined) return { ok: true };
    const text = count > 0 ? String(Math.min(count, 999)) : "";
    await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#4f46e5" }).catch(() => {});
      await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" }).catch(() => {});
    }
    return { ok: true };
  },

  async ai_fill({ fields, profile }) {
    const { settings } = await loadContext();
    const { apiKey, label } = resolveProvider(settings);
    if (!apiKey) return { ok: false, error: `No ${label} API key configured.` };

    // Always source the resume here rather than trusting the caller. It used to
    // be passed in from the page, where it was empty unless the resume had been
    // parsed by hand in the dashboard — so in practice the model was answering
    // from the profile alone and had never seen the resume.
    const resumeText = await ensureResumeText(settings);
    const answers = await analyzeFields(settings, fields, profile, resumeText);
    return { ok: true, answers };
  },

  async cover_letter({ jobDescription, profile, resumeText, match }) {
    const { settings } = await loadContext();
    const text = await coverLetter(settings, jobDescription, profile,
                                   resumeText || await ensureResumeText(settings),
                                   match || null);
    return { ok: true, text };
  },

  /**
   * Compare the candidate against one posting.
   *
   * Like the AI fill, the resume is sourced here rather than trusted from the
   * page: a comparison run against the profile summary alone reports gaps the
   * resume would have closed.
   */
  async match_job({ jobDescription, profile }) {
    const { settings } = await loadContext();
    const { apiKey, label } = resolveProvider(settings);
    if (!apiKey) return { ok: false, error: `No ${label} API key configured.` };

    const resumeText = await ensureResumeText(settings);
    const match = await matchJob(settings, jobDescription, profile, resumeText);
    return { ok: true, match };
  },

  async parse_resume({ dataUrl }) {
    const { settings } = await loadContext();
    const text = await parseResumePdf(settings, dataUrl);
    return { ok: true, text };
  },

  async extract_profile({ resumeText }) {
    const { settings } = await loadContext();
    const profile = await extractProfile(settings, resumeText);
    return { ok: true, profile };
  },

  /**
   * Verify a key/model pair the dashboard has typed but not yet saved, so the
   * test reflects what is on screen rather than what was stored.
   */
  async test_key({ provider, apiKey, model }) {
    const probe = provider === "groq"
      ? { provider: "groq", groqApiKey: apiKey, groqModel: model }
      : { provider: "gemini", geminiApiKey: apiKey, geminiModel: model };
    const text = await generate(probe, "Reply with the single word: OK",
                                { maxRetries: 0, timeoutMs: 15000 });
    return { ok: true, reply: String(text).trim().slice(0, 40) };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return;

  handler(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;   // async response
});

// A count left over from the previous page would be a lie about this one.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard shortcut
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alt+Shift+F, declared in the manifest under `commands`.
 *
 * This lives here rather than as a keydown listener in the engine because the
 * engine only exists on pages detection accepted — which left the shortcut dead
 * on the pages most likely to need it. Pressing an extension's shortcut grants
 * `activeTab` for the current tab, the same way clicking the toolbar icon does,
 * so this needs no permission the popup did not already rely on.
 *
 * The user can rebind or clear it at chrome://extensions/shortcuts; Chrome
 * silently drops a suggested key another extension already claimed, in which
 * case nothing here fires and the popup button remains the way in.
 */
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "fill-page") return;

  const target = tab?.id !== undefined
    ? tab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;

  // A frame count of zero means no engine is loaded anywhere in the tab. That is
  // recoverable — detection is deliberately conservative, and pressing the
  // shortcut is an unambiguous instruction — so force the engine in and retry.
  // A rejected `rf_force_load` is the other case: nothing is listening at all,
  // on a chrome:// page, the Web Store or the PDF viewer, and that is hopeless.
  const filled = await fanOut(target.id, "rf_fill");
  if (filled.length) return;

  let reachable = true;
  await chrome.tabs.sendMessage(target.id, { type: "rf_force_load" })
    .catch(() => { reachable = false; });
  if (!reachable) return;

  // The engine arrives by dynamic import, so give it a few beats to land rather
  // than calling it dead on one miss.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if ((await fanOut(target.id, "rf_fill")).length) return;
  }
});
