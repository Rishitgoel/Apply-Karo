// Apply karo — service worker.
//
// Owns everything that must not live in a page: API keys, network calls, and
// the storage migration. Content scripts ask for work by message and never see
// credentials.

import { migrateFromV1, loadContext, loadResumeFile, save } from "./src/shared/schema.js";
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
  if (resumeMeta.text?.trim()) return resumeMeta.text;
  if (!canReadPdf(settings)) return "";
  if (!resolveProvider(settings).apiKey) return "";

  // Collapse concurrent callers onto one parse — a fill can ask several times.
  if (!resumeTextPromise) {
    resumeTextPromise = (async () => {
      const dataUrl = await loadResumeFile();
      if (!dataUrl) return "";
      const text = await parseResumePdf(settings, dataUrl);
      if (text?.trim()) await save({ resumeMeta: { ...resumeMeta, text } });
      return text || "";
    })().catch((err) => {
      console.warn("Apply karo: could not parse the resume —", err.message);
      return "";
    }).finally(() => { resumeTextPromise = null; });
  }
  return resumeTextPromise;
}

/** Route a message to a handler, keeping the async channel open correctly. */
const handlers = {
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
