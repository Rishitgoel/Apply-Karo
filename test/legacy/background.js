// Apply karo background service worker.
// - Opens the options page on first install.
// - Proxies all Gemini API calls so the network request + API key stay out of
//   page/content contexts, and the fetch runs with the extension's host
//   permissions (required for a cross-origin fetch from the worker).

function rgSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Pull Gemini's suggested retry delay (e.g. "12s") out of a 429 error body.
function rgParseRetryDelay(errData) {
  try {
    const details = (errData && errData.error && errData.error.details) || [];
    for (const d of details) {
      if (d && d.retryDelay) {
        const m = String(d.retryDelay).match(/([\d.]+)s/);
        if (m) return Math.ceil(parseFloat(m[1]) * 1000);
      }
    }
  } catch (_) {}
  return 0;
}

// Gemini generateContent with automatic retry (rate-limit / overload / network),
// model fallback (if the chosen model is unavailable), and a per-attempt timeout.
// Returns the response text, or throws.
async function geminiGenerate(apiKey, model, payload, options) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  const opts = options || {};
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 2; // transient retries per model
  const timeoutMs = opts.timeoutMs || 25000;
  const maxBackoff = 6000;

  const primary = model || "gemini-3.5-flash";
  const fallbackChain = ["gemini-3.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  const modelsToTry = [primary, ...fallbackChain.filter((m) => m !== primary)];

  let lastError = null;

  for (let mi = 0; mi < modelsToTry.length; mi++) {
    const targetModel = modelsToTry[mi];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            if (mi > 0) console.warn(`Apply karo: '${primary}' unavailable, used fallback model '${targetModel}'.`);
            return text;
          }
          // Empty / safety-blocked — not worth retrying the same model.
          const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
          lastError = new Error(reason ? `No content returned (reason: ${reason}).` : "No text content returned from Gemini API.");
          break; // try next model
        }

        const errData = await response.json().catch(() => ({}));
        const errMsg = (errData && errData.error && errData.error.message) || `HTTP error! status: ${response.status}`;
        lastError = new Error(errMsg);

        // Model unavailable → skip straight to the next model in the chain.
        if (response.status === 404 || /not found|not supported|does not exist|unknown name|unsupported/i.test(errMsg)) {
          break;
        }
        // Auth / bad request → not fixable by retry or fallback.
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw lastError;
        }
        // Rate limited / overloaded / server error → backoff and retry same model.
        if (response.status === 429 || response.status >= 500) {
          if (attempt < maxRetries) {
            const suggested = rgParseRetryDelay(errData);
            const backoff = Math.min(suggested || (Math.pow(2, attempt) * 700), maxBackoff);
            await rgSleep(backoff);
            continue;
          }
          break; // exhausted → next model may have separate free quota
        }
        break; // any other status → next model
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (err && /No content|No text content/i.test(err.message)) { lastError = err; break; }
        lastError = (err && err.name === "AbortError")
          ? new Error(`Gemini request timed out after ${timeoutMs}ms.`)
          : err;
        if (attempt < maxRetries) {
          await rgSleep(Math.min(Math.pow(2, attempt) * 700, maxBackoff));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

// Open the options page when the extension is installed.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;

  if (request.action === "open_options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return;
  }

  if (request.type === "gemini_generate") {
    geminiGenerate(request.apiKey, request.model, request.payload, request.options)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: (err && err.message) || "Gemini request failed." }));
    return true; // keep the message channel open for the async response
  }
});
