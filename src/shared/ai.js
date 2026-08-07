// Apply karo — model access. Runs in the service worker only, so API keys
// never reach a page context.
//
// Two providers are supported. Groq speaks the OpenAI chat-completions shape,
// Gemini has its own; everything below `generate` works in plain text and never
// learns which is in use.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Gemini model names are versioned and get retired, so a failed one falls back
// down this chain. Groq has no equivalent: the model there is whatever the user
// typed, and quietly answering with a different one would be worse than saying so.
//
// This chain is also the safety net under the default. v1 shipped a default of
// `gemini-3.5-flash` that was never generally available, and every AI feature
// failed on a fresh install until the user went and changed it by hand; the
// migration in schema.js still exists to clean that up. Newest first, so a
// retired default degrades to a working model rather than to an error.
const GEMINI_FALLBACKS = [
  "gemini-3.5-flash-lite", "gemini-3.5-flash",
  "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"
];

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
    models: [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-flash"
    ]
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
      "moonshotai/kimi-k2-instruct",
      "qwen/qwen3-32b",
      "deepseek-r1-distill-llama-70b"
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
async function geminiOnce(apiKey, model, prompt, { json, pdf, signal }) {
  const parts = [];
  if (pdf) parts.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.data } });
  parts.push({ text: prompt });

  const body = { contents: [{ parts }] };
  if (json) body.generationConfig = { responseMimeType: "application/json" };

  // The key travels as a header, not `?key=`. A query string is the part of a
  // request that ends up in proxy logs, crash dumps and error reports, and a
  // leaked Gemini key is billable to whoever finds it. Groq already does this,
  // via Authorization.
  const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal
  });

  if (res.ok) {
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;
    const why = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "empty";
    throw Object.assign(new Error(`No content returned (${why}).`), { fatal: true });
  }

  const err = await res.json().catch(() => ({}));
  const msg = err?.error?.message || `HTTP ${res.status}`;
  throw Object.assign(new Error(msg), {
    status: res.status,
    retryAfter: retryDelayFrom(err),
    badModel: res.status === 404 || /not found|not supported|unknown name/i.test(msg),
    fatal: res.status === 400 || res.status === 401 || res.status === 403
  });
}

/** One Groq attempt. OpenAI chat-completions shape. */
async function groqOnce(apiKey, model, prompt, { json, signal, noJsonMode }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    // A little warmth. Prose at temperature 0 comes out uniform and stilted,
    // which is the opposite of what these answers need.
    temperature: json ? 0.6 : 0.8,
    max_tokens: 8000
  };
  if (json && !noJsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal
  });

  if (res.ok) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text) return text;
    throw Object.assign(new Error("No content returned."), { fatal: true });
  }

  const err = await res.json().catch(() => ({}));
  const msg = err?.error?.message || `HTTP ${res.status}`;
  const jsonModeIssue = /response_format|json_object|json mode/i.test(msg);
  throw Object.assign(new Error(msg), {
    status: res.status,
    badModel: res.status === 404 || /does not exist|not found|decommissioned|invalid model/i.test(msg),
    // Not every Groq model supports JSON mode; worth one retry without it.
    noJsonMode: jsonModeIssue,
    fatal: (res.status === 400 && !jsonModeIssue) || res.status === 401 || res.status === 403
  });
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

  const chain = name === "gemini"
    ? [model, ...GEMINI_FALLBACKS.filter((m) => m !== model)]
    : [model];

  let lastError = null;
  let noJsonMode = false;

  for (const target of chain) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const args = { json, pdf, signal: ctl.signal, noJsonMode };
        const text = name === "groq"
          ? await groqOnce(apiKey, target, prompt, args)
          : await geminiOnce(apiKey, target, prompt, args);
        clearTimeout(timer);
        return text;
      } catch (e) {
        clearTimeout(timer);
        lastError = e.name === "AbortError"
          ? new Error(`${label} timed out after ${timeoutMs}ms.`)
          : e;

        if (e.noJsonMode && !noJsonMode) { noJsonMode = true; continue; }  // same model, plain text
        if (e.fatal) throw lastError;
        if (e.badModel) break;                                            // next model, if any
        if (attempt < maxRetries) {
          await sleep(Math.min(e.retryAfter || 2 ** attempt * 700, 6000));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error(`${label} request failed.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice
//
// The failure mode in these answers is not incorrectness, it is uniformity:
// text that is grammatical, balanced and completely flat, which a recruiter
// reading fifty applications spots immediately.
// ─────────────────────────────────────────────────────────────────────────────

const VOICE = `WRITING STYLE — this matters as much as the content:

Write the way a real person writes when they are being straightforward. Specifically:

- Vary sentence length. Put a short one after a long one. Some sentences can be four words.
- Lead with the concrete thing. Name the tool, the number, the outcome. "I built the access-management portal on Keycloak and Postgres" beats "I have extensive experience with identity management solutions."
- Use contractions where they fall naturally: I've, don't, it's, that's.
- Never open with "I am excited to", "I am passionate about", "As a [role] with X years of experience", or by restating the question.
- Ban these words and their variants outright: leverage, utilize, spearhead, delve, tapestry, testament, robust, seamless, cutting-edge, synergy, holistic, myriad, pivotal, realm, landscape, embark, foster, underscore, meticulous, adept, poised, "in today's fast-paced".
- Ban these connectors: Moreover, Furthermore, Additionally, In conclusion, Overall, Ultimately.
- Avoid the rule of three. Not everything needs three parallel items. Two is fine. One is often better.
- Do not end with a sentence that summarises what you just said.
- No em dashes. Use a full stop or a comma.
- Let the structure be slightly uneven. Perfectly balanced paragraphs read as generated.
- It is fine to be plain. Do not reach for an impressive word when an ordinary one is accurate.

Match the length to the box: a one-line field gets one line; a paragraph field gets 3-6 sentences unless the question implies otherwise.`;

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Answer the fields the rule engine could not resolve.
 *
 * Long-answer fields make responses big, so requests are chunked — a single
 * call covering thirty fields hits the output limit and truncates, which lands
 * as "the AI filled almost nothing".
 */
export async function analyzeFields(settings, fields, profile, resumeText) {
  const CHUNK = 14;
  if (fields.length <= CHUNK) return analyzeChunk(settings, fields, profile, resumeText, 0);

  const merged = {};
  for (let i = 0; i < fields.length; i += CHUNK) {
    const part = await analyzeChunk(settings, fields.slice(i, i + CHUNK), profile, resumeText, i);
    Object.assign(merged, part);
  }
  return merged;
}

async function analyzeChunk(settings, fields, profile, resumeText, offset) {
  const list = fields.map((f, i) => {
    let d = `${i + offset}: label="${f.label}"  control=${f.kind || f.type}`;
    if (f.placeholder) d += `  placeholder="${f.placeholder}"`;
    if (f.maxLength) d += `  maxlength=${f.maxLength}`;
    if (f.options?.length) {
      d += `\n     CHOOSE ONE OF THESE, copied exactly: ${f.options.slice(0, 40).map((o) => `"${o}"`).join(", ")}`;
    }
    return d;
  }).join("\n");

  const text = await generate(settings,
`You are filling in a job application for the candidate below. They will read
everything before submitting, so your job is to give them a complete first draft
they can edit — not a half-filled form.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

RESUME:
${(resumeText || "").slice(0, 12000) || "(not provided — work from the profile above)"}

FIELDS TO ANSWER:
${list}

HOW TO ANSWER:
1. Answer EVERY field. A blank the candidate has to fill in by hand is a failure;
   a reasonable draft they tweak is a success. Use null only when a field is
   genuinely unanswerable by anyone but them (a password, a file upload, a
   one-time code, a question about a company detail nobody could know).
2. Infer freely from the profile and resume. If they ask for "years of
   programming experience" and the resume shows work from 2023, compute it. If
   they ask for a preferred location and the profile has a city, use it. If they
   ask something the resume implies but does not state, make the sensible call.
3. NEVER invent verifiable facts: employers, job titles, dates, degrees, GPAs,
   certifications, licences, visa status, or metrics that would appear on a
   background check. Those must come from the profile or resume verbatim. This
   is the one place where a blank is better than a guess.
4. Subjective and open-ended questions ("Why do you want to work here?", "Tell
   us about a challenge") always get a full, confident answer built from the
   candidate's real projects and experience.
5. When a field lists options, it is a dropdown or a set of buttons — it cannot
   hold words of your own. The value MUST be one of the listed options, copied
   character for character, including its punctuation and any trailing clause.
   "Yes" is NOT a valid answer to a field offering "Yes, I am legally
   authorized" — return that whole string. Pick the closest fit rather than
   returning null.
6. confidence is your honest probability (0.0-1.0) that the answer is right.
   Answer the field regardless — confidence below 0.7 highlights it for review
   rather than discarding it, so a low number is not a reason to return null.

${VOICE}

Return only JSON mapping each field index to {"value": <string|null>, "confidence": <number>}.
Include an entry for every index listed above.
{"0": {"value": "…", "confidence": 0.9}, "1": {"value": "…", "confidence": 0.5}}`,
    { json: true, timeoutMs: 60000 });

  return extractJson(text) || {};
}

/**
 * Score this candidate against one posting.
 *
 * The useful half of this is not the number, it is the two lists. "You meet 7
 * of their 10 requirements, and the three you miss are Kubernetes, Terraform
 * and a security clearance" tells you whether to apply and what to write about.
 * A bare percentage tells you nothing you can act on, which is why `score` here
 * is derived from the requirement lists rather than asked for on its own.
 *
 * This is explicitly NOT an ATS simulation. No employer's ranker works this
 * way, and a product that claims "87% ATS match" is inventing a number. What
 * this measures is whether a careful reader would see the posting's stated
 * requirements evidenced in your resume.
 *
 * @returns {Promise<{score:number, verdict:string, summary:string,
 *   meets:Array<{requirement:string, evidence:string}>,
 *   gaps:Array<{requirement:string, severity:string, closeable:string}>,
 *   leadWith:string[], keywords:string[]}>}
 */
export async function matchJob(settings, jobDescription, profile, resumeText) {
  const text = await generate(settings,
`Compare this candidate against the job posting below. The candidate is deciding
whether to apply and what to emphasise if they do, so be accurate rather than
encouraging — an inflated score wastes their time on a job they will not get,
and a deflated one talks them out of a job they would.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

RESUME:
${(resumeText || "").slice(0, 12000) || "(not provided — work from the profile above)"}

JOB POSTING:
${String(jobDescription || "").slice(0, 9000)}

HOW TO JUDGE:
1. Pull out the posting's actual requirements — the things it asks for. Ignore
   boilerplate about the company, benefits, and equal-opportunity statements.
2. For each requirement, decide whether the resume evidences it. "meets" needs
   real evidence you can point at: name the project, role or tool it comes from.
   Do not credit a requirement because the candidate could probably learn it.
3. Requirements with no evidence go in "gaps", with severity "blocking" (a hard
   filter: a licence, a clearance, a degree they lack, years they do not have),
   "important" (a core skill of the role) or "minor" (nice-to-have). Be honest:
   most postings have a few gaps and that is normal.
4. "closeable" says briefly how they could address that gap — adjacent
   experience to point at, or "" when nothing in their background touches it.
5. "leadWith" is the 3-4 things from their background this specific employer
   would care most about. Concrete, not adjectives.
6. "keywords" are terms the posting uses that do not appear in the resume at
   all and honestly should, given what the candidate has actually done. Never
   suggest a keyword for something they have not done.
7. NEVER invent experience, employers, dates or skills the resume does not show.
   A gap is information, not a failure to paper over.

Return only JSON in exactly this shape:
{
  "summary": "two sentences on whether this is worth applying to and why",
  "verdict": "strong" | "fair" | "weak",
  "meets":   [{"requirement": "...", "evidence": "..."}],
  "gaps":    [{"requirement": "...", "severity": "blocking|important|minor", "closeable": "..."}],
  "leadWith": ["...", "..."],
  "keywords": ["...", "..."]
}`,
    { json: true, timeoutMs: 60000 });

  const raw = extractJson(text);
  if (!raw) throw new Error("Could not read the comparison the model returned. Try again or pick another model.");
  return normalizeMatch(raw);
}

/**
 * Put a model's answer into a fixed shape and compute the score ourselves.
 *
 * Asking for the number separately invites it to disagree with its own lists —
 * a "90%" sitting above two blocking gaps. Deriving it here means the headline
 * and the detail can never contradict each other. A blocking gap is weighted an
 * order of magnitude above a minor one because that is how a filter behaves:
 * one missing clearance sinks an otherwise perfect fit.
 */
export function normalizeMatch(raw) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === "string" ? v.trim() : "");

  const meets = list(raw.meets)
    .map((m) => ({ requirement: str(m?.requirement), evidence: str(m?.evidence) }))
    .filter((m) => m.requirement);

  const SEVERITIES = new Set(["blocking", "important", "minor"]);
  const gaps = list(raw.gaps)
    .map((g) => ({
      requirement: str(g?.requirement),
      severity: SEVERITIES.has(str(g?.severity)) ? str(g.severity) : "important",
      closeable: str(g?.closeable)
    }))
    .filter((g) => g.requirement);

  // Weighted: a met requirement is worth 1, a miss costs by how hard it filters.
  const COST = { blocking: 10, important: 3, minor: 1 };
  const missed = gaps.reduce((n, g) => n + COST[g.severity], 0);
  const total = meets.length + missed;
  const score = total === 0 ? 0 : Math.round((meets.length / total) * 100);

  return {
    score,
    // Derived too, so the word and the number always agree.
    verdict: score >= 70 ? "strong" : score >= 40 ? "fair" : "weak",
    summary: str(raw.summary),
    meets,
    gaps,
    leadWith: list(raw.leadWith).map(str).filter(Boolean),
    keywords: list(raw.keywords).map(str).filter(Boolean)
  };
}

export async function coverLetter(settings, jobDescription, profile, resumeText, match = null) {
  const p = profile.personal || {};
  const name = p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "the candidate";

  // When the posting has already been analysed, hand the letter the conclusions
  // rather than making it re-derive them from the raw text. It stops the letter
  // leading with something the employer never asked for, and it stops it
  // claiming a requirement the analysis just established is missing.
  const steer = match ? `
WHAT THE COMPARISON AGAINST THIS POSTING FOUND — build the letter on this:
Lead with: ${match.leadWith?.join("; ") || "(nothing specific)"}
Requirements they meet, with the evidence to cite:
${(match.meets || []).slice(0, 8).map((m) => `- ${m.requirement} — ${m.evidence}`).join("\n") || "- (none identified)"}
Do NOT claim any of these, which the resume does not evidence:
${(match.gaps || []).slice(0, 8).map((g) => `- ${g.requirement}`).join("\n") || "- (none)"}
` : "";

  return generate(settings,
`Write a tailored cover letter for ${name}.

PROFILE:
${JSON.stringify(profile, null, 2)}

RESUME:
${resumeText || "(none provided)"}

JOB DESCRIPTION:
${jobDescription}
${steer}
Requirements:
- 300-400 words, professional greeting, 3-4 body paragraphs, sign-off.
- Draw on the candidate's real, specific achievements. Invent nothing.
- Use "[Company Name]" / "[Hiring Manager]" if those are not identifiable.
- Return only the letter text.

${VOICE}`,
    { timeoutMs: 60000 });
}

export async function parseResumePdf(settings, dataUrl) {
  const [head, data] = String(dataUrl).split(",");
  if (!data) throw new Error("Invalid resume file.");
  const mimeType = head.match(/:(.*?);/)?.[1] || "application/pdf";

  return generate(settings,
    "Extract all text from this resume verbatim — experience, education, skills, summary. Return plain text only, no commentary.",
    { pdf: { mimeType, data }, timeoutMs: 60000 });
}

export async function extractProfile(settings, resumeText) {
  const text = await generate(settings,
`Extract a structured profile from this resume.

${resumeText}

Return only JSON in exactly this shape. Use "" for anything absent:
{
  "personal": {
    "firstName":"","lastName":"","fullName":"","email":"","phone":"",
    "website":"","linkedin":"","github":"","portfolio":"",
    "address":"","city":"","state":"","postalCode":"","country":"","location":"",
    "visaStatus":"Citizen | Authorized to work | Requires sponsorship",
    "authorizedToWork":"Yes | No","sponsorshipRequired":"Yes | No"
  },
  "education":[{"school":"","degree":"","fieldOfStudy":"","startDate":"","endDate":"","gpa":""}],
  "experience":[{"company":"","title":"","location":"","timeframe":"","description":""}],
  "summary":"",
  "skills":"comma-separated list"
}`,
    { json: true, timeoutMs: 60000 });

  const parsed = extractJson(text);
  if (!parsed) throw new Error("Could not parse the profile the model returned. Try again or pick another model.");
  return parsed;
}
