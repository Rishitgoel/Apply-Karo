import { createResolver, newBudget } from "./src/resolver/service.js";
import { releasePolicy, DEFAULT_RELEASE } from "./src/shared/release.js";
import { syntheticProviderProbe } from "./src/release/probe.js";
// Apply karo — service worker.
//
// Owns everything that must not live in a page: API keys, network calls, and
// the storage migration. Content scripts ask for work by message and never see
// credentials.

import {
  migrateFromV1, loadContext, loadResumeFile, save, resumeTextIsCurrent,
  loadJob, patchJob, setJob, recordMatch, loadLetters, saveLetters
} from "./src/shared/schema.js";
import { createFillJobs } from "./src/shared/fill-jobs.js";
import { createKnowledgeService } from "./src/knowledge/service.js";
import { scopeForQuestion } from "./src/shared/field-identity.js";
import { answerPolicy } from "./src/shared/answer-policy.js";
import { postingFromPage, MIN_JD_CHARS } from "./src/shared/posting.js";
// Everything is imported statically: dynamic import() is disallowed inside a
// ServiceWorkerGlobalScope (w3c/ServiceWorker#1356), so a lazy import here fails
// at call time rather than at load time.
import {
  coverLetter, parseResumePdf, extractProfile,
  matchJob, generate, resolveProvider, canReadPdf,
  analyzeFields, generateExclusiveAnswer, matchOption
} from "./src/shared/ai.js";

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateFromV1();
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.release) await chrome.storage.local.set({ settings: { ...settings, release: { ...DEFAULT_RELEASE, cohort: crypto.getRandomValues(new Uint32Array(1))[0] % 100 } } });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

const resolver = createResolver();
const resolutionRuns = new Map();
let providerProbeRunning = false;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings && !releasePolicy(changes.settings.newValue || {}).enabled) for (const run of resolutionRuns.values()) run.controller.abort();
});
const knowledgeService = createKnowledgeService(chrome.storage.local);

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

  if (!canReadPdf(settings)) return "";   // stale text is not evidence
  if (!resolveProvider(settings).apiKey) return "";

  // Collapse concurrent callers onto one parse — a fill can ask several times.
  if (!resumeTextPromise) {
    resumeTextPromise = (async () => {
      const dataUrl = await loadResumeFile();
      if (!dataUrl) return "";
      const text = await parseResumePdf(settings, dataUrl);
      if (text?.trim()) {
        const current = await loadContext();
        if (JSON.stringify(current.resumeMeta) !== JSON.stringify(resumeMeta) || await loadResumeFile() !== dataUrl) return "";
        await save({ resumeMeta: { ...resumeMeta, text, textFileName: resumeMeta.fileName || "" } });
        return text;
      }
      return "";
    })().catch((err) => {
      console.warn("Apply karo: could not parse the resume —", err.message);
      return "";
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

/**
 * How long to wait for frames to put their hands up.
 *
 * A frame that acknowledges after this is gone: the run it belongs to has
 * already resolved and been deleted, so its result is dropped even though the
 * frame goes on to fill the form. That is the expensive failure here — the
 * frame doing the real work is the embedded board, which is also the frame most
 * likely to be mid-hydration with a blocked main thread when the broadcast
 * lands. Half a second of React and a payments SDK is not much.
 *
 * The only thing a longer window delays is a tab with no engine in it at all,
 * and nobody is watching that: it is a retry loop in the command handler.
 */
const FRAME_ACK_MS = 2000;

/** Ceiling on one whole-tab action. An AI-assisted fill is genuinely slow. */
const FRAME_RESULT_MS = 120000;

let nextRunId = 1;
const runs = new Map();

function fanOut(tabId, action, extra = {}) {
  return new Promise((resolve) => {
    const runId = `${crypto.randomUUID?.() || Date.now()}-r${nextRunId++}`;
    const run = { tabId, expected: extra.expectedFrames || [], acks: new Set((extra.expectedFrames || []).map((f) => f.frameId)), seen: new Set(), results: [], ackWindowClosed: false, done: false, lastActivity: Date.now() };
    runs.set(runId, run);

    run.finish = () => {
      if (run.done) return;
      run.done = true;
      clearTimeout(run.ackTimer);
      clearTimeout(run.hardTimer);
      clearInterval(run.idleTimer);
      runs.delete(runId);
      resolve(run.results);
    };

    // Closing the window says "no further frame will introduce itself" — that
    // is re-checked on every fresh ack by resetting this timer (see the
    // `rf_frame_ack` handler below) rather than leaving the deadline fixed at
    // the first broadcast. A frame whose main thread was still busy hydrating
    // when a fixed deadline would have closed the window got counted as never
    // joining, and its result — arriving after `finish()` had already deleted
    // the run — was silently dropped despite the frame having filled the form.
    run.closeAckWindow = () => {
      run.ackWindowClosed = true;
      // No acknowledgement from anywhere means no engine is loaded in this tab.
      if (!run.acks.size || run.results.length >= run.acks.size) run.finish();
    };

    // The reply channel is deliberately unused; results arrive as new messages.
    chrome.tabs.sendMessage(tabId, { ...extra, type: action, runId }).catch(() => {});

    run.ackTimer = setTimeout(run.closeAckWindow, FRAME_ACK_MS);
    run.timeout = () => {
      if (extra.jobId) chrome.tabs.sendMessage(tabId, { type: "rf_cancel_job", jobId: extra.jobId }).catch(() => {});
      run.results.push({ ok: false, error: "A form frame stopped replying. Review filled fields before retrying." });
      run.finish();
    };
    run.idleTimer = setInterval(() => { if (run.acks.size && Date.now() - run.lastActivity > 8000) run.timeout(); }, 500);
    run.hardTimer = setTimeout(run.timeout, FRAME_RESULT_MS);
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
      // First frame with something to say wins. "Something" matters: frames
      // report `aiError: ""` when nothing went wrong, and taking the first
      // *defined* value meant one quiet frame could bury the reason another
      // frame had for leaving half its form blank.
      else if (out[k] === undefined || out[k] === "") out[k] = v;
    }
  }

  if (top) {
    if (top.host !== undefined) out.host = top.host;
    if (top.disabled !== undefined) out.disabled = top.disabled;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stored posting
//
// Both of these write their result into the job slot before they return it, and
// that is the point rather than a nicety. The toolbar popup is a window that
// closes the instant you look away — at a letter, at the form behind it — and a
// letter takes the better part of a minute. Whoever asked for the work is
// usually gone by the time it lands, so the answer cannot be theirs alone to
// hold: it goes to storage, and the popup renders whatever is in the slot the
// next time it opens.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one model task against the stored posting.
 *
 * @param {"match"|"letter"} what
 * @returns {Promise<object|string>} the match, or the letter text
 */
async function runJobTask(what) {
  const { settings, profile } = await loadContext();
  const { apiKey, label } = resolveProvider(settings);
  if (!apiKey) throw new Error(`No ${label} API key set. Add one in the Apply karo dashboard.`);

  const job = await loadJob();
  if (String(job.text || "").length < MIN_JD_CHARS) {
    throw new Error("No job description saved. Open the posting and press Capture in the toolbar.");
  }

  // Marked before the call, so a popup opened while this is in flight says
  // "working" instead of looking like nothing ever happened.
  await patchJob({ running: what, runningSince: Date.now(), error: "" });

  try {
    // Sourced here rather than trusted from the caller: a comparison run against
    // the profile summary alone reports gaps the resume would have closed.
    const resumeText = await ensureResumeText(settings);

    if (what === "match") {
      const match = await matchJob(settings, job.text, profile, resumeText);
      await patchJob({ match: { ...match, ts: Date.now() }, running: "" });

      // A comparison you ran before deciding whether to apply is worth keeping
      // even if you never fill the form in.
      if (settings.trackApplications && job.url) {
        recordMatch(job.url, match, { host: job.host, company: job.company, role: job.role })
          .catch((err) => console.debug("Apply karo: could not save the match —", err.message));
      }
      return match;
    }

    // Built on the comparison when there is one: it stops the letter leading
    // with something the employer never asked for, and stops it claiming a
    // requirement the comparison just established is missing.
    const text = String(await coverLetter(settings, job.text, profile, resumeText, job.match)).trim();
    if (!text) throw new Error("The model returned an empty letter.");

    await patchJob({ letter: text, letterTs: Date.now(), running: "" });
    await keepLetter(job, text);
    return text;
  } catch (err) {
    await patchJob({ running: "", error: err?.message || String(err) });
    throw err;
  }
}

/**
 * File a letter under Saved letters in the dashboard.
 *
 * Automatic because the alternative is losing it: the popup that asked for it
 * has usually closed by now, and a minute of model time should not evaporate
 * because you clicked on the form behind it. Redrafting for the same posting
 * replaces that posting's entry rather than stacking a fourth near-identical
 * letter on the list.
 */
async function keepLetter(job, text) {
  try {
    const letters = await loadLetters();
    const title = [job.company, job.role].filter(Boolean).join(" — ") || "Untitled letter";
    const rest = letters.filter((l) => !(job.url && l.url === job.url));
    rest.unshift({ id: `${Date.now()}`, title, text, ts: Date.now(), url: job.url || "" });
    await saveLetters(rest);
  } catch (err) {
    console.debug("Apply karo: could not save the letter —", err.message);
  }
}

/** Route a message to a handler, keeping the async channel open correctly. */
const handlers = {
  async synthetic_provider_probe(_message, sender) {
    if (!String(sender?.url || "").startsWith(chrome.runtime.getURL(""))) return { ok: false, error: "Run the synthetic check from the dashboard." };
    if (providerProbeRunning) return { ok: false, error: "A synthetic provider check is already running." };
    providerProbeRunning = true;
    try { const { settings = {} } = await chrome.storage.local.get("settings"), result = await syntheticProviderProbe(settings); await chrome.storage.local.set({ releaseProbe: result }); return { ok: true, result }; }
    finally { providerProbeRunning = false; }
  },
  async knowledge({ action, ...payload }, sender) {
    return { ok: true, result: await knowledgeService.execute(action, payload, sender) };
  },
  /** A frame has picked up a whole-tab action and intends to report back. */
  async rf_frame_ack({ runId }, sender) {
    const run = runs.get(runId);
    if (!run) return { ok: true };

    const frameId = sender?.frameId ?? 0;
    // A genuinely new voice, before the window closed: give it (and anyone
    // else still hydrating) the same runway rather than cutting it off
    // mid-count — see the comment on `closeAckWindow` above.
    if (!run.acks.has(frameId) && !run.ackWindowClosed) {
      clearTimeout(run.ackTimer);
      run.ackTimer = setTimeout(run.closeAckWindow, FRAME_ACK_MS);
    }
    if (sender?.tab?.id !== undefined && sender.tab.id !== run.tabId) return { ok: false };
    if (run.expected.length && !run.expected.some((f) => f.frameId === frameId && (!f.documentId || f.documentId === sender.documentId))) return { ok: false };
    run.lastActivity = Date.now();
    run.acks.add(frameId);
    return { ok: true };
  },

  async start_fill({ tabId }, sender) {
    const id = tabId ?? sender?.tab?.id;
    if (id === undefined) return { ok: false, error: "No tab to fill." };
    return fillJobs.start(id);
  },
  async save_question_fix({ locator, original, question }, sender) {
    if (!sender?.tab || !/^https?:/.test(sender.url || "") || typeof locator !== "string" || !locator || locator.length > 1000 ||
        typeof original !== "string" || typeof question !== "string" || !question.trim() || question.length > 50000) throw new Error("The question could not be saved for this page.");
    const scope = scopeForQuestion(sender.url);
    const { questionFixes = {} } = await chrome.storage.local.get("questionFixes");
    questionFixes[scope] ||= {};
    questionFixes[scope][locator] = { original, question: question.trim() };
    await chrome.storage.local.set({ questionFixes });
    return { ok: true };
  },
  async prepare_engine({ tabId }, sender) {
    const id = tabId ?? sender?.tab?.id;
    await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, files: ["src/engine/bundle.js"], injectImmediately: true });
    const results = await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: async () => {
      if (!window.__applyKaroEngine) return false;
      try {
        await window.__applyKaroEngine.ready();
        return true;
      } catch {
        return false;
      }
    } });
    return { ok: true, state: "ready", frames: results.length };
  },
  async fill_job_status({ tabId, runId }, sender) {
    return { ok: true, job: await fillJobs.get(tabId ?? sender?.tab?.id, runId) };
  },
  async rf_frame_progress({ runId, jobId, state, detail }, sender) {
    const run = runs.get(runId);
    if (run && run.tabId === sender?.tab?.id && run.acks.has(sender.frameId ?? 0)) run.lastActivity = Date.now();
    if (jobId) {
      const job = await fillJobs.get(sender?.tab?.id, jobId);
      if (job?.frames.some((f) => f.frameId === sender.frameId && (!f.documentId || f.documentId === sender.documentId))) await fillJobs.progress(jobId, state, detail);
    }
    return { ok: true };
  },
  /** A frame has finished. Resolve the run once every acked frame is in. */
  async rf_frame_result({ runId, result }, sender) {
    const run = runs.get(runId);
    if (!run) return { ok: true };                 // arrived after the timeout
    const frameId = sender?.frameId ?? 0;
    if (sender?.tab?.id !== undefined && sender.tab.id !== run.tabId) return { ok: false };
    if (!run.acks.has(frameId) || run.seen.has(frameId)) return { ok: false };
    if (run.expected.length && !run.expected.some((f) => f.frameId === frameId && (!f.documentId || f.documentId === sender.documentId))) return { ok: false };
    run.seen.add(frameId); run.lastActivity = Date.now();
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

    if (action === "rf_fill" && !rest.skipTop) {
      const start = await fillJobs.start(id);
      while (true) {
        const job = await fillJobs.get(id, start.runId);
        if (["completed", "needs_attention", "failed", "interrupted"].includes(job.state)) return { ok: job.state !== "failed" && job.state !== "interrupted", frames: job.frames.length, ...job, aiError: job.error };
        await new Promise((r) => setTimeout(r, 100));
      }
    }
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

  /**
   * Put the engine into the frame that asked for it.
   *
   * src/detect.js decided this frame holds an application (or the user pressed
   * Fill), and cannot load the engine itself: doing that by dynamic import
   * meant publishing the engine as a web-accessible resource, which is a
   * chrome-extension:// URL any page can probe to detect the extension.
   * Injecting from here keeps the whole engine unreachable from the web.
   *
   * `files` takes the flattened classic build rather than the ES modules under
   * src/engine/, because executeScript cannot run a module. Rebuild it with
   * `node bundle.mjs` after touching anything the engine imports.
   *
   * Scoped to `sender.frameId`, not the whole tab: an embedded Greenhouse or
   * Lever board is one frame among several, each of which decides for itself,
   * and injecting tab-wide would load 240 KB into ad frames that will never be
   * asked to fill anything.
   */
  async rf_inject(_msg, sender) {
    const tabId = sender?.tab?.id;
    if (tabId === undefined) return { ok: false, error: "No tab to inject into." };
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        files: ["src/engine/bundle.js"],
        injectImmediately: true
      });
      const [ready] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, func: async () => { await window.__applyKaroEngine.ready(); return true; } });
      return { ok: ready.result === true, state: "ready" };
    } catch (err) {
      // chrome:// pages, the Web Store and the PDF viewer land here, and so
      // does a missing bundle.js — which is why the message carries the cause
      // rather than a flat "couldn't inject".
      return { ok: false, error: err?.message || String(err) };
    }
  },

  async open_options({ tab } = {}) {
    if (tab === "tab-learned") await chrome.tabs.create({ url: chrome.runtime.getURL("options.html#tab-learned") });
    else chrome.runtime.openOptionsPage();
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

  /**
   * Answer what the rules could not.
   *
   * Note the shape of the reply: `ok` says whether the request completed, and
   * `error` is filled in independently of it. A batched fill can lose some
   * batches and keep others — most often to a spent quota partway through — and
   * the caller needs both halves of that: the answers it did get, and a reason
   * to show for the fields that stayed blank. Returning only `{ok:true}` is why
   * a quota failure used to reach the user as "Nothing left to fill here".
   */
  async ai_fill({ fields, jobContext, runId, regenerate = false }, sender = {}) {
    const { settings, profile, resumeMeta } = await loadContext();
    if (!releasePolicy(settings).enabled) return { ok: false, error: releasePolicy(settings).reason };
    const owner = [sender.tab?.id, sender.frameId, sender.documentId].join(":");
    const key = owner + ":" + (runId || crypto.randomUUID());
    let session = resolutionRuns.get(key);
    if (!session) { session = { controller: new AbortController() }; session.budget = newBudget({ signal: session.controller.signal }); resolutionRuns.set(key, session); }
    for (const [id, run] of resolutionRuns) if (run.budget.deadline < Date.now()) { run.controller.abort(); resolutionRuns.delete(id); }
    while (resolutionRuns.size > 128) { const id = resolutionRuns.keys().next().value; resolutionRuns.get(id).controller.abort(); resolutionRuns.delete(id); }
    const state = await knowledgeService.execute("snapshot", {}, { url: chrome.runtime.getURL("background.js") });
    if (Object.values(state.facts).some(f => f.status === "confirmed" && f.intent === "disclosure.preference" && ["skip", "ask"].includes(f.value))) settings.skipSensitive = true;
    const normalized = fields.map((field, i) => ({ ...field, fieldId: field.fieldId || "legacy-field-" + i, revision: field.revision || 1, questionFull: field.questionFull || field.label }));
    // Factual passes never parse a PDF or make a provider request.
    const resumeText = resumeTextIsCurrent(resumeMeta) ? resumeMeta.text : "";
    const result = await resolver.resolve(normalized, { settings, profile, knowledge: state, resumeText, url: sender.url || "https://invalid.local/", jobContext }, { useAI: !!settings.aiAutofillEnabled, useCache: !regenerate, budget: session.budget });

    if (settings.aiAutofillEnabled && resolveProvider(settings).apiKey && !session.budget.signal?.aborted && !result.quota) {
      let currentResume = resumeText;
      if (!currentResume) {
        try { currentResume = await ensureResumeText(settings); } catch {}
      }

      const unfulfilled = [];
      for (let i = 0; i < normalized.length; i++) {
        const d = result.decisions[i];
        const f = normalized[i];
        if (!d || !["resolved", "draft"].includes(d.status) || d.value === null || d.value === undefined || String(d.value).trim() === "") {
          if (answerPolicy({ ...f, rawLabel: f.questionFull }, settings).allowed) {
            const isLegalDeclaration = /citizen|certificat|licen[cs]|criminal|convict|consent|agree|declar|attest/i.test(f.questionFull || f.label || "");
            if (!isLegalDeclaration) {
              const wasProseAbstention = (f.kind === "textarea" || f.kind === "richtext") && ["model_abstained", "needs_user", "ambiguous"].includes(d?.reason);
              if (!wasProseAbstention) {
                unfulfilled.push({ i, field: f });
              }
            }
          }
        }
      }

      if (unfulfilled.length > 0) {
        try {
          const aiAnswers = await analyzeFields(settings, unfulfilled.map(u => u.field), profile, currentResume, null, jobContext);
          let anyFilled = false;
          for (let uIdx = 0; uIdx < unfulfilled.length; uIdx++) {
            const ans = aiAnswers[uIdx];
            const { i, field } = unfulfilled[uIdx];
            if (ans?.value && String(ans.value).trim() && !["missing_fact", "ambiguous"].includes(ans.status)) {
              let finalVal = String(ans.value).trim();
              let optionIds = [];
              if (field.options?.length) {
                const optMatch = matchOption(field.options, finalVal);
                if (optMatch) {
                  finalVal = optMatch.value;
                  optionIds = optMatch.optionIds;
                } else {
                  finalVal = null;
                }
              }
              if (finalVal) {
                result.decisions[i] = {
                  fieldId: field.fieldId,
                  revision: field.revision,
                  status: "draft",
                  value: finalVal,
                  optionIds,
                  confidence: typeof ans.confidence === "number" ? ans.confidence : 0.85,
                  source: "ai_draft",
                  reason: "AI draft generated from profile and resume; review before submitting"
                };
                anyFilled = true;
              }
            }
          }
          if (anyFilled) {
            result.error = "";
          }
        } catch (err) {
          if (err.quota) result.quota = true;
          console.warn("Apply karo: AI fallback pass failed —", err.message);
        }
      }
    }

    const current = await knowledgeService.execute("snapshot", {}, { url: chrome.runtime.getURL("background.js") });
    if (JSON.stringify([current.dependencies, current.recordRevisions, current.answers]) !== JSON.stringify([state.dependencies, state.recordRevisions, state.answers])) {
      result.decisions = normalized.map(f => ({ fieldId: f.fieldId, revision: f.revision, status: "deferred", value: null, reason: "source_changed" }));
      result.error = "Your profile, resume or saved answers changed. Run fill again.";
    }
    return { ok: true, ...result, answers: Object.fromEntries(result.decisions.map((d,i) => [i,d])) };
  },
  async cancel_resolution({ runId }, sender = {}) {
    const key = [sender.tab?.id, sender.frameId, sender.documentId].join(":") + ":" + runId;
    resolutionRuns.get(key)?.controller.abort();
    return { ok: true };
  },

  /**
   * Exclusive single-field AI generation for paragraph/long-form questions,
   * supporting custom instructions.
   */
  async ai_exclusive_field({ field, customInstruction, jobContext }, sender) {
    const result = await handlers.ai_fill({ fields: [{ ...field, helperText: [field.helperText, customInstruction].filter(Boolean).join("\n") }], jobContext, regenerate: true }, sender);
    let answer = result.answers?.[0];
    if (!answer?.value) {
      const { settings, profile } = await loadContext();
      if (settings.aiAutofillEnabled && resolveProvider(settings).apiKey) {
        try {
          const resumeText = await ensureResumeText(settings);
          const drafted = await generateExclusiveAnswer(settings, field, profile, resumeText, jobContext, customInstruction);
          if (drafted?.trim()) {
            answer = { fieldId: field.fieldId, revision: field.revision, status: "draft", value: drafted.trim(), optionIds: [], source: "ai_exclusive", reason: "Single-field AI draft" };
          }
        } catch {}
      }
    }
    return answer?.value ? { ok: true, answer: answer.value, status: answer.status, decision: answer } : { ok: false, error: result.error || "A confirmed fact or supporting evidence is missing. No answer was filled." };
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

  /**
   * Read the posting off a tab and store it, without loading the engine.
   *
   * This is the piece that makes the toolbar's Capture button work on a job
   * listing — a page with no form on it, which detection deliberately ignores
   * and which therefore has no engine to ask. `postingFromPage` is injected
   * straight into the tab instead. It is written to survive that (see the note
   * at the top of shared/posting.js: it may not reference anything outside its
   * own body), and it only reads text.
   *
   * Every frame is asked, because an embedded board puts the description in an
   * iframe as often as not, and the longest answer wins — the top frame of a
   * careers page is usually navigation and a footer.
   */
  async read_posting({ tabId }) {
    if (tabId === undefined) return { ok: false, error: "No tab to read." };

    let frames;
    try {
      frames = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: postingFromPage
      });
    } catch (err) {
      // chrome:// pages, the Web Store, the PDF viewer, a tab still loading.
      return { ok: false, error: err?.message || String(err) };
    }

    const best = frames
      .map((f) => f?.result)
      .filter((p) => p && typeof p.text === "string")
      .sort((a, b) => b.text.length - a.text.length)[0];

    if (!best || best.text.length < MIN_JD_CHARS) {
      return {
        ok: false,
        short: true,
        error: "No job description found on this page. Open the posting itself, or paste it in."
      };
    }

    return { ok: true, job: await setJob({ ...best, source: "capture" }) };
  },

  /** Store a description typed or pasted in by hand. */
  async save_posting({ text, company, role, url, host }) {
    const body = String(text || "").trim();
    if (body.length < MIN_JD_CHARS) {
      return { ok: false, error: `That is only ${body.length} characters — paste a bit more of the posting.` };
    }
    return {
      ok: true,
      job: await setJob({
        text: body,
        company: company || "", role: role || "", title: role || "",
        url: url || "", host: host || "",
        source: "manual"
      })
    };
  },

  /** Compare the candidate against the stored posting. */
  async job_match() {
    return { ok: true, match: await runJobTask("match") };
  },

  /** Draft a letter for the stored posting. */
  async job_letter() {
    return { ok: true, text: await runJobTask("letter") };
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

const fillJobs = createFillJobs({
  storage: chrome.storage.session || chrome.storage.local,
  identify: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:/.test(tab.url || "")) throw new Error("Extensions cannot fill this type of page.");
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => {
      window.__applyKaroDocumentId ||= crypto.randomUUID(); return window.__applyKaroDocumentId;
    } });
    return { documentId: r.documentId || r.result };
  },
  prepare: async (job) => {
    await chrome.scripting.executeScript({ target: { tabId: job.tabId, allFrames: true }, files: ["src/engine/bundle.js"], injectImmediately: true });
    const ready = await chrome.scripting.executeScript({ target: { tabId: job.tabId, allFrames: true }, func: async () => {
      const engine = window.__applyKaroEngine;
      if (!engine) return null;
      try {
        await engine.ready();
        return { url: location.href, surface: engine.inventory() };
      } catch {
        return null;
      }
    } });
    return ready.filter((r) => r.result?.url).map((r) => ({ frameId: r.frameId, documentId: r.documentId, ...r.result }));
  },
  dispatch: (job) => fanOut(job.tabId, "rf_fill", { jobId: job.runId, expectedFrames: job.frames, deadline: job.deadline }),
  observe: async (job) => {
    const states = await chrome.scripting.executeScript({ target: { tabId: job.tabId, allFrames: true }, func: (id) => window.__applyKaroEngine?.jobStatus(id) || { state: "unknown" }, args: [job.runId] });
    return job.frames.map((f) => states.find((s) => s.frameId === f.frameId && s.documentId === f.documentId)?.result || { state: "unknown" });
  },
  notify: (job) => chrome.tabs.sendMessage(job.tabId, { type: "rf_job_progress", job }).catch(() => {})
});

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

  await fillJobs.start(target.id).catch((err) => console.warn("Apply karo: shortcut fill failed", err.message));
});
