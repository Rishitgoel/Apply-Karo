// AI request tests — node test/ai.test.mjs
//
// `fetch` is stubbed, so this exercises the real prompt builder and the real
// chunking path without touching the network or needing a key.
//
// The chunking is the dangerous part: answers come back keyed by index, so an
// off-by-one between a chunk's local position and the caller's array would
// write every answer into the wrong field. That is silent and would only be
// noticed after submitting an application, so it is tested directly.

import { analyzeFields, generate, resolveProvider, canReadPdf, PROVIDERS } from "../src/shared/ai.js";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push({ desc, got: g, want: w });
};

const sent = [];
const calls = [];      // { url, headers, body } as actually sent
let nextResponses = null;   // queue of canned responses, when a test needs one

const GEMINI_SETTINGS = { provider: "gemini", geminiApiKey: "k", geminiModel: "gemini-2.0-flash" };
const GROQ_SETTINGS = { provider: "groq", groqApiKey: "gsk_x", groqModel: "llama-3.3-70b-versatile" };

/** Stand in for both APIs, echoing an answer for every index it was asked. */
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const isGroq = String(url).includes("groq.com");
  const prompt = isGroq ? body.messages[0].content : body.contents[0].parts[0].text;

  sent.push(prompt);
  calls.push({ url: String(url), headers: opts.headers || {}, body });

  if (nextResponses?.length) return nextResponses.shift();

  const indices = [...prompt.matchAll(/^(\d+): label=/gm)].map((m) => Number(m[1]));
  const answers = {};
  for (const i of indices) answers[i] = { value: `answer-${i}`, confidence: 0.9 };
  const text = JSON.stringify(answers);

  return {
    ok: true,
    json: async () => isGroq
      ? { choices: [{ message: { content: text } }] }
      : { candidates: [{ content: { parts: [{ text }] } }] }
  };
};

const err = (status, message) => ({
  ok: false, status, json: async () => ({ error: { message } })
});
const okText = (text, isGroq) => ({
  ok: true,
  json: async () => isGroq
    ? { choices: [{ message: { content: text } }] }
    : { candidates: [{ content: { parts: [{ text }] } }] }
});

const PROFILE = { personal: { firstName: "Rishit", email: "a@b.c" }, education: [], experience: [] };
const field = (i) => ({ label: `Question ${i}`, kind: "textarea" });

// ── Chunking and index integrity ──
{
  sent.length = 0;
  const fields = Array.from({ length: 30 }, (_, i) => field(i));
  const answers = await analyzeFields(GEMINI_SETTINGS, fields, PROFILE, "resume text");

  check("30 fields are split into batches", sent.length, 3);
  check("every field gets an answer", Object.keys(answers).length, 30);

  // The critical property: answer N must correspond to field N globally.
  const misaligned = Object.entries(answers).filter(([i, a]) => a.value !== `answer-${i}`);
  check("answers stay aligned to their global index", misaligned.length, 0);

  const first = [...sent[0].matchAll(/^(\d+): label=/gm)].map((m) => Number(m[1]));
  const last = [...sent[2].matchAll(/^(\d+): label=/gm)].map((m) => Number(m[1]));
  check("first batch starts at 0", first[0], 0);
  check("last batch continues the numbering", last[0], 28);
  check("no index is dropped between batches",
    sent.flatMap((p) => [...p.matchAll(/^(\d+): label=/gm)].map((m) => Number(m[1]))).length, 30);
}
{
  sent.length = 0;
  const answers = await analyzeFields(GEMINI_SETTINGS, [field(0), field(1)], PROFILE, "");
  check("a small form is a single request", sent.length, 1);
  check("and still answers everything", Object.keys(answers).length, 2);
}

// ── The instructions that make it fill more, and write like a person ──
{
  sent.length = 0;
  await analyzeFields(GEMINI_SETTINGS, [{ label: "Why do you want to work here?", kind: "textarea" }],
                      PROFILE, "RESUME BODY MARKER");
  const p = sent[0];

  check("resume is included in the prompt", p.includes("RESUME BODY MARKER"), true);
  check("told to answer every field", /Answer EVERY field/.test(p), true);
  check("told to infer rather than skip", /Infer freely/.test(p), true);
  check("null is reserved for the genuinely unanswerable", /genuinely unanswerable/.test(p), true);
  check("low confidence does not mean return null", /not a reason to return null/.test(p), true);

  // The honesty guard has to survive the push toward filling more.
  check("still forbids inventing verifiable facts", /NEVER invent verifiable facts/.test(p), true);
  check("names the facts that must not be invented", /certifications/.test(p) && /GPAs/.test(p), true);

  // Voice
  for (const banned of ["leverage", "spearhead", "delve", "tapestry", "Moreover", "Furthermore"]) {
    check(`voice: bans "${banned}"`, p.includes(banned), true);
  }
  check("voice: bans the excited opener", /I am excited to/.test(p), true);
  check("voice: asks for varied sentence length", /Vary sentence length/.test(p), true);
  check("voice: warns against the rule of three", /rule of three/.test(p), true);
  check("voice: no em dashes", /No em dashes/.test(p), true);
  check("voice: length should match the box", /Match the length to the box/.test(p), true);
}

// ── Option and length hints reach the model ──
{
  sent.length = 0;
  await analyzeFields(GEMINI_SETTINGS, [
    { label: "Notice period", kind: "select", options: ["Immediate", "30 days", "60 days"] },
    { label: "Pitch yourself", kind: "textarea", maxLength: 300 }
  ], PROFILE, "");
  const p = sent[0];
  check("select options are listed", /"Immediate", "30 days", "60 days"/.test(p), true);
  check("maxlength is passed through", /maxlength=300/.test(p), true);
  check("options must be copied exactly", /character for\s+character/.test(p), true);
}

// ── Provider selection ─────────────────────────────────────────────────────
{
  check("defaults to gemini", resolveProvider({}).name, "gemini");
  check("unknown provider falls back to gemini", resolveProvider({ provider: "nope" }).name, "gemini");
  check("groq picks its own key", resolveProvider(GROQ_SETTINGS).apiKey, "gsk_x");
  check("groq picks its own model", resolveProvider(GROQ_SETTINGS).model, "llama-3.3-70b-versatile");
  check("gemini picks its own key", resolveProvider(GEMINI_SETTINGS).apiKey, "k");
  // Keys are stored per provider, so switching must not read the wrong one.
  const both = { ...GEMINI_SETTINGS, ...GROQ_SETTINGS, provider: "gemini" };
  check("holding both keys, gemini reads gemini's", resolveProvider(both).apiKey, "k");
  check("holding both keys, groq reads groq's", resolveProvider({ ...both, provider: "groq" }).apiKey, "gsk_x");
  check("a blank model falls back to the first suggestion",
    resolveProvider({ provider: "groq", groqApiKey: "x" }).model, PROVIDERS.groq.models[0]);

  check("only gemini reads PDFs", canReadPdf(GEMINI_SETTINGS), true);
  check("groq does not read PDFs", canReadPdf(GROQ_SETTINGS), false);
}

// ── Groq request shape ─────────────────────────────────────────────────────
{
  calls.length = 0; sent.length = 0;
  const answers = await analyzeFields(GROQ_SETTINGS, [field(0), field(1)], PROFILE, "resume");
  const c = calls[0];

  check("groq hits the OpenAI-compatible endpoint",
    c.url, "https://api.groq.com/openai/v1/chat/completions");
  check("groq authenticates with a bearer token", c.headers.Authorization, "Bearer gsk_x");
  check("groq key never appears in the URL", c.url.includes("gsk_x"), false);
  check("groq sends the typed model verbatim", c.body.model, "llama-3.3-70b-versatile");
  check("groq uses the chat messages shape", Array.isArray(c.body.messages), true);
  check("groq requests JSON mode", c.body.response_format?.type, "json_object");
  check("groq answers are parsed", Object.keys(answers).length, 2);
}
{
  // A model id the user typed must be passed through untouched, including a
  // namespaced one — this is the whole point of the free-text field.
  calls.length = 0;
  await analyzeFields({ provider: "groq", groqApiKey: "gsk_x", groqModel: "moonshotai/kimi-k2-instruct" },
                      [field(0)], PROFILE, "");
  check("a namespaced custom model survives intact", calls[0].body.model, "moonshotai/kimi-k2-instruct");
}
{
  calls.length = 0;
  await generate(GEMINI_SETTINGS, "hi");
  check("gemini still uses its own endpoint", calls[0].url.includes("generativelanguage"), true);
  // The key goes in a header, never the URL: query strings are what end up in
  // proxy logs and error reports, and a leaked key is billable.
  check("gemini authenticates with a header", calls[0].headers["x-goog-api-key"], "k");
  check("gemini keeps the key out of the URL", /[?&]key=/.test(calls[0].url), false);
}

// ── Groq error handling ────────────────────────────────────────────────────
{
  // Models that reject JSON mode should be retried once without it, rather
  // than failing the whole fill.
  calls.length = 0;
  nextResponses = [err(400, "response_format json_object is not supported for this model"),
                   okText('{"0":{"value":"x","confidence":1}}', true)];
  const out = await analyzeFields(GROQ_SETTINGS, [field(0)], PROFILE, "");
  check("json-mode rejection retries without it", calls.length, 2);
  check("the retry drops response_format", calls[1].body.response_format, undefined);
  check("and the answer still comes back", out["0"].value, "x");
  nextResponses = null;
}
{
  calls.length = 0;
  nextResponses = [err(404, "The model `made-up-model` does not exist")];
  let message = "";
  try { await generate({ provider: "groq", groqApiKey: "gsk_x", groqModel: "made-up-model" }, "hi"); }
  catch (e) { message = e.message; }
  check("a bad groq model fails fast without retrying", calls.length, 1);
  check("and reports the provider's own message", /does not exist/.test(message), true);
  nextResponses = null;
}
{
  calls.length = 0;
  nextResponses = [err(401, "Invalid API Key")];
  let message = "";
  try { await generate(GROQ_SETTINGS, "hi"); } catch (e) { message = e.message; }
  check("a bad key is not retried", calls.length, 1);
  check("and says so plainly", /Invalid API Key/.test(message), true);
  nextResponses = null;
}
{
  // Groq must never silently answer with a different model than asked for.
  calls.length = 0;
  nextResponses = [err(404, "decommissioned"), okText('{}', true)];
  try { await generate(GROQ_SETTINGS, "hi"); } catch {}
  check("groq does not fall back to another model", calls.length, 1);
  nextResponses = null;
}
{
  let message = "";
  try { await generate({ provider: "groq", groqModel: "m" }, "hi"); } catch (e) { message = e.message; }
  check("a missing groq key is caught before any request", /Groq API key/.test(message), true);

  message = "";
  try { await generate(GROQ_SETTINGS, "hi", { pdf: { mimeType: "application/pdf", data: "x" } }); }
  catch (e) { message = e.message; }
  check("asking groq to read a PDF explains the limit", /cannot read PDFs/.test(message), true);
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
