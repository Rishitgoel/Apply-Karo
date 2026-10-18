const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Catalogue checked against official provider documentation on 2026-10-07.
// Use the selected model only; changing models requires user selection.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    readsPdf: true,
    // First entry is what `resolveProvider` falls back to when no model is
    // stored, so it must stay equal to DEFAULT_SETTINGS.geminiModel in
    // schema.js. Those two drifting apart means a fresh install and a
    // half-configured one quietly use different models.
    models: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
  },
  groq: {
    label: "Groq",
    keyPlaceholder: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    readsPdf: false,
    // Suggestions only. Groq's catalogue changes often, which is exactly why the
    // model field takes free text instead of being a closed dropdown.
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3-32b"
    ]
  }
};

/** Which provider a settings object selects, with its key and model. */
export function resolveProvider(settings = {}) {
  const name = PROVIDERS[settings.provider] ? settings.provider : "gemini";
  const apiKey = (name === "groq" ? settings.groqApiKey : settings.geminiApiKey) || "";
  const model = (name === "groq" ? settings.groqModel : settings.geminiModel) || PROVIDERS[name].models[0];
  return { name, apiKey, model, label: PROVIDERS[name].label };
}

export function providerHealth(settings = {}) {
  const { name, model } = resolveProvider(settings);
  if (settings.provider && !PROVIDERS[settings.provider]) return { ok: false, error: "Choose a supported AI provider in the dashboard." };
  if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(model)) return { ok: false, error: "The model name is invalid. Check it in the dashboard." };
  if (name === "gemini" && /^gemini-(1\.[05]|2\.0)(-|$)/.test(model)) return { ok: false, error: `${model} has retired. Your selection was preserved; choose a current model in the dashboard, then Test key.` };
  if (/embedding|(?:^|-)tts|(?:^|-)live|(?:^|-)image/.test(model)) return { ok: false, error: "Choose a text-generation model for autofill." };
  return { ok: true, model };
}

/** Reading a PDF needs a multimodal model; Groq's text models cannot. */
export function canReadPdf(settings = {}) {
  return PROVIDERS[resolveProvider(settings).name].readsPdf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

/** Tolerant JSON parse — strips code fences and stray prose. */
export function extractJson(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) t = t.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const a = t.indexOf(open), b = t.lastIndexOf(close);
    if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  }
  return null;
}

function retryDelayFrom(errData) {
  for (const d of errData?.error?.details || []) {
    const m = String(d?.retryDelay || "").match(/([\d.]+)s/);
    if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  }
  return 0;
}

/** One Gemini attempt. Returns text, or throws a classified error. */
async function geminiOnce(apiKey, model, prompt, { json, pdf, signal, schema, maxTokens, onUsage }) {
  const parts = [];
  if (pdf) parts.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.data } });
  parts.push({ text: prompt });

  const body = { contents: [{ parts }] };
  if (json) body.generationConfig = { responseMimeType: "application/json" };
  if (schema) body.generationConfig = { ...body.generationConfig, responseMimeType: "application/json", responseJsonSchema: schema };
  if (maxTokens) body.generationConfig = { ...body.generationConfig, maxOutputTokens: maxTokens };

  // The key travels as a header, not `?key=`. A query string is the part of a
  // request that ends up in proxy logs, crash dumps and error reports, and a
  // leaked Gemini key is billable to whoever finds it. Groq already does this,
  // via Authorization.
  const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": String(apiKey || "").trim() },
    body: JSON.stringify(body),
    signal
  });

  if (res.ok) {
    const data = await res.json();
    onUsage?.({ inputTokens: data.usageMetadata?.promptTokenCount ?? null, outputTokens: data.usageMetadata?.candidatesTokenCount ?? null, totalTokens: data.usageMetadata?.totalTokenCount ?? null });
    // Every part, not just the first. A long JSON reply comes back split across
    // several parts, and taking `parts[0]` alone handed the caller the opening
    // fragment of an object — unparseable, and read as "the model answered
    // nothing" on exactly the forms with the most to answer.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p?.text || "").join("");
    if (text.trim()) return text;

    const why = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "empty";
    // Running out of output tokens is not a permanent failure of the request,
    // it is this model spending its allowance before it wrote anything — the
    // thinking models do it routinely. Let the next model in the chain try,
    // and let the caller re-ask in smaller batches, rather than failing the
    // whole fill outright.
    throw Object.assign(new Error(`No content returned (${why}).`), {
      truncated: why === "MAX_TOKENS",
      fatal: why !== "MAX_TOKENS"
    });
  }

  const err = await res.json().catch(() => ({}));
  const msg = err?.error?.message || `HTTP ${res.status}`;
  const badModel = res.status === 404 || /not found|not supported|unknown name|invalid model/i.test(msg) || (res.status === 400 && /model|name|support/i.test(msg));
  throw Object.assign(new Error(msg), {
    status: res.status,
    retryAfter: retryDelayFrom(err),
    badModel,
    // Out of quota. Kept apart from the other retryable failures because the
    // response to it is different: a rate limit is worth one wait, a spent
    // daily allowance is worth none at all — see `generate`.
    quota: res.status === 429,
    fatal: !badModel && (res.status === 400 || res.status === 401 || res.status === 403)
  });
}

/** One Groq attempt. OpenAI chat-completions shape. */
async function groqOnce(apiKey, model, prompt, { json, signal, noJsonMode, schema, maxTokens, onUsage }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    // A little warmth. Prose at temperature 0 comes out uniform and stilted,
    // which is the opposite of what these answers need.
    temperature: json ? 0.6 : 0.8,
    max_tokens: maxTokens || 8000
  };
  if (json && !noJsonMode) body.response_format = { type: "json_object" };
  if (schema && !noJsonMode) body.response_format = { type: "json_schema", json_schema: { name: "autofill_decisions", strict: true, schema } };

  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal
  });

  if (res.ok) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    onUsage?.({ inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null, totalTokens: data.usage?.total_tokens ?? null });
    if (text) return text;
    throw Object.assign(new Error("No content returned."), { fatal: true });
  }

  const err = await res.json().catch(() => ({}));
  const msg = err?.error?.message || `HTTP ${res.status}`;
  const jsonModeIssue = /response_format|json_object|json mode/i.test(msg);
  // Groq states the wait in prose rather than in a field: "Please try again in
  // 7.66s". Reading it is what tells a one-minute rate limit apart from a spent
  // daily allowance, which is the difference between waiting and giving up.
  const wait = msg.match(/try again in ([\d.]+)\s*s/i);
  throw Object.assign(new Error(msg), {
    status: res.status,
    badModel: res.status === 404 || /does not exist|not found|decommissioned|invalid model/i.test(msg),
    quota: res.status === 429,
    retryAfter: wait ? Math.ceil(parseFloat(wait[1]) * 1000) : 0,
    // Not every Groq model supports JSON mode; worth one retry without it.
    noJsonMode: jsonModeIssue,
    fatal: (res.status === 400 && !jsonModeIssue) || res.status === 401 || res.status === 403
  });
}

/**
 * A 429, said in words the user can act on.
 *
 * The provider's own message is written for whoever wrote the request, not for
 * whoever is standing in front of a half-filled application form: "Quota
 * exceeded for quota metric 'Generate Content API requests per day'" does not
 * tell you that the rest of your form is blank because of it, or what to do.
 * The three things that matter are what stopped, when it comes back, and which
 * lever moves it — so those are what this says.
 */
function quotaError(name, label, err) {
  const secs = err.retryAfter ? Math.ceil(err.retryAfter / 1000) : 0;
  const when = secs
    ? `That is a per-minute rate limit — it clears in about ${secs}s, so pressing Fill again shortly should work.`
    : name === "gemini"
      ? "Free-tier limits are counted per model and per day; the daily one resets at midnight US Pacific."
      : "Free-tier limits are counted per model, per minute and per day.";

  return Object.assign(
    new Error(
      `${label} has no quota left (429). ${when} ` +
      `You can pick a different model or provider in the Apply karo dashboard, or use a key with billing enabled. ` +
      `Everything the rules could answer was still filled in.`
    ),
    { quota: true, status: 429, retryAfter: err.retryAfter || 0, provider: label }
  );
}

/**
 * Send a prompt to whichever provider `settings` selects.
 * Retries transient failures with backoff.
 *
 * @param {object} settings  the stored settings object
 * @param {string} prompt
 * @param {object} [opts]    { json, pdf, maxRetries, timeoutMs }
 * @returns {Promise<string>} the model's text
 */
export async function generate(settings, prompt, opts = {}) {
  const { maxRetries = 2, timeoutMs = 30000, json = false, pdf = null } = opts;
  const { name, apiKey, model, label } = resolveProvider(settings);

  if (!apiKey) {
    throw new Error(`No ${label} API key set. Add one in the Apply karo dashboard.`);
  }
  if (pdf && !PROVIDERS[name].readsPdf) {
    throw new Error(`${label} cannot read PDFs. Paste your resume text in the dashboard, or switch to Gemini for parsing.`);
  }

  const health = providerHealth(settings);
  if (!health.ok) throw new Error(health.error);
  const chain = [model];

  let lastError = null;
  let noJsonMode = false;

  for (const target of chain) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const args = { json, pdf, signal: opts.signal ? AbortSignal.any([opts.signal, ctl.signal]) : ctl.signal, noJsonMode, schema: opts.schema, maxTokens: opts.maxTokens, onUsage: opts.onUsage };
        const text = name === "groq"
          ? await groqOnce(apiKey, target, prompt, args)
          : await geminiOnce(apiKey, target, prompt, args);
        clearTimeout(timer);
        return text;
      } catch (e) {
        clearTimeout(timer);
        if (opts.signal?.aborted) throw Object.assign(new Error("AI filling was cancelled."), { cancelled: true });
        lastError = e.name === "AbortError"
          ? new Error(`${label} timed out after ${timeoutMs}ms.`)
          : e;

        if (e.noJsonMode && !noJsonMode) { noJsonMode = true; continue; }  // same model, plain text
        if (e.fatal) throw lastError;
        if (e.badModel) break;                                            // next model, if any
        // Asking the same model the same question again gets the same reply cut
        // off at the same place. Only a different model, or a smaller question,
        // changes the outcome — and the caller does the second of those.
        if (e.truncated) break;

        // Out of quota. A stated retry delay means a per-minute limit and is
        // worth one wait; anything else is an allowance that will not come back
        // within this fill, and retrying it three times per model across the
        // whole fallback chain only turns a clear failure into a half-minute
        // hang that ends in the same place. Move on to the next model instead —
        // Gemini counts free quota per model, so the next one may well answer.
        if (e.quota) {
          if (e.retryAfter && e.retryAfter <= 15000 && attempt < maxRetries) {
            await sleep(e.retryAfter);
            continue;
          }
          break;
        }

        if (attempt < maxRetries) {
          await sleep(Math.min(e.retryAfter || 2 ** attempt * 700, 6000));
          continue;
        }
        break;
      }
    }
  }

  // Every model in the chain refused for want of quota. Say that in one clear
  // sentence rather than handing on the last provider message, which names a
  // model the user never chose and a metric they have never heard of.
  if (lastError?.quota) throw quotaError(name, label, lastError);

  throw lastError || new Error(`${label} request failed.`);
}
