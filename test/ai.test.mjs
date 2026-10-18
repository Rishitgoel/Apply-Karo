// AI request tests â€” node test/ai.test.mjs
//
// `fetch` is stubbed, so this exercises the real prompt builder and the real
// chunking path without touching the network or needing a key.
//
// The chunking is the dangerous part: answers come back keyed by index, so an
// off-by-one between a chunk's local position and the caller's array would
// write every answer into the wrong field. That is silent and would only be
// noticed after submitting an application, so it is tested directly.

import {
  analyzeFields, generate, resolveProvider, canReadPdf, PROVIDERS,
  readAnswers, batchFields, generateExclusiveAnswer
} from "../src/shared/ai.js";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push({ desc, got: g, want: w });
};

const sent = [];
const calls = [];      // { url, headers, body } as actually sent
let nextResponses = null;   // queue of canned responses, when a test needs one

const GEMINI_SETTINGS = { provider: "gemini", geminiApiKey: "k", geminiModel: "gemini-3.8-flash" };
const GROQ_SETTINGS = { provider: "groq", groqApiKey: "gsk_x", groqModel: "llama-3.3-70b-versatile" };

/** Stand in for both APIs, echoing an answer for every index it was asked. */
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const isGroq = String(url).includes("groq.com");
  const prompt = isGroq ? body.messages[0].content : body.contents[0].parts[0].text;

  sent.push(prompt);
  calls.push({ url: String(url), headers: opts.headers || {}, body });

  if (nextResponses?.length) return nextResponses.shift();

  // Answers are keyed by the position the *prompt* used, but their content is
  // taken from the label. Every request numbers its fields from zero, so a
  // reply that echoed the number back would look aligned no matter which
  // fields the batch held â€” the label is the only thing that says which
  // question was actually answered.
  const answers = {};
  for (const [, idx, label] of prompt.matchAll(/^(\d+): label="([^"]*)"/gm)) {
    const q = label.match(/^Question (\d+)$/);
    answers[idx] = { value: q ? `answer-${q[1]}` : `answer-${idx}`, confidence: 0.9 };
  }
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

// â”€â”€ Chunking and index integrity â”€â”€
{
  sent.length = 0;
  const fields = Array.from({ length: 30 }, (_, i) => field(i));
  const answers = await analyzeFields(GEMINI_SETTINGS, fields, PROFILE, "resume text");

  check("30 paragraph fields are split into batches", sent.length, 4);
  check("every field gets an answer", Object.keys(answers).length, 30);

  // The critical property: answer N must correspond to field N globally.
  const misaligned = Object.entries(answers).filter(([i, a]) => a.value !== `answer-${i}`);
  check("answers stay aligned to their global index", misaligned.length, 0);

  // Each request numbers its own fields from zero. Numbering them globally â€”
  // "16:" through "30:" in the second request â€” reads as a list starting at 16,
  // and models routinely answer 0..14 regardless; those keys then landed on the
  // first batch's fields.
  const batches = sent.map((p) => [...p.matchAll(/^(\d+): label=/gm)].map((m) => Number(m[1])));
  check("every batch numbers its fields from 0", batches.every((b) => b[0] === 0), true);
  check("every batch numbers them consecutively",
    batches.every((b) => b.every((n, i) => n === i)), true);
  check("the prompt states the range it expects back",
    /numbered 0 to 7\b/.test(sent[0]), true);
  check("no field is dropped between batches", batches.flat().length, 30);
}
{
  const entry = (kind) => ({ field: { kind }, index: 0 });
  check("short fields batch by count",
    batchFields(Array.from({ length: 20 }, () => entry("text"))).map((b) => b.length), [16, 4]);
  // A paragraph box costs more because what truncates a reply is the length of
  // the answers, not the number of questions.
  check("paragraph boxes batch smaller",
    batchFields(Array.from({ length: 10 }, () => entry("textarea"))).map((b) => b.length), [8, 2]);
  check("a maxlength that implies an essay counts as long",
    batchFields(Array.from({ length: 9 }, () => ({ field: { kind: "text", maxLength: 2000 }, index: 0 })))
      .map((b) => b.length), [8, 1]);
}
{
  sent.length = 0;
  const answers = await analyzeFields(GEMINI_SETTINGS, [field(0), field(1)], PROFILE, "");
  check("a small form is a single request", sent.length, 1);
  check("and still answers everything", Object.keys(answers).length, 2);
}

// â”€â”€ Reading a reply that is not the clean shape asked for â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Every one of these arrived at the user as "the AI filled nothing". None of
// them is a model that had nothing to say.
{
  check("answers given as an array map by position",
    readAnswers('[{"value":"a","confidence":1},{"value":"b","confidence":1}]', 2)[1].value, "b");
  // A model that drops one field mid-array would otherwise shift every answer
  // after it onto the wrong control.
  check("an index inside the entry beats its position",
    readAnswers('[{"index":1,"value":"b"},{"index":0,"value":"a"}]', 2)[0].value, "a");
  check("a wrapped object is unwrapped",
    readAnswers('{"answers":{"0":{"value":"a"}}}', 1)[0].value, "a");
  check("a fenced reply is read",
    readAnswers('```json\n{"0":{"value":"a"}}\n```', 1)[0].value, "a");
  check("field_N keys are read as indices",
    readAnswers('{"field_1":{"value":"b"}}', 2)[1].value, "b");
  check("an index the batch never asked about is ignored",
    Object.keys(readAnswers('{"7":{"value":"x"}}', 2)).length, 0);
  check("a null answer is not an answer",
    Object.keys(readAnswers('{"0":{"value":null},"1":{"value":"y"}}', 2)).length, 1);
  check("a number answer survives as text",
    readAnswers('{"0":{"value":2027}}', 1)[0].value, "2027");
  check("a missing confidence remains unknown",
    readAnswers('{"0":{"value":"a"}}', 1)[0].confidence, null);
  // The one that matters most: a reply cut off at the output limit still holds
  // every answer written before the break.
  const cut = '{"0": {"value": "kept one", "confidence": 0.9}, "1": {"value": "kept two", "confidence": 0.8}, "2": {"value": "cut off mid-sen';
  check("a truncated reply keeps the answers before the break",
    Object.keys(readAnswers(cut, 3)).length, 2);
  check("and they are the right ones", readAnswers(cut, 3)[1].value, "kept two");
}

// â”€â”€ Fields the model skipped are asked again â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  sent.length = 0;
  nextResponses = [okText('{"0":{"value":"a","confidence":1},"1":{"value":"b","confidence":1}}', false)];
  const out = await analyzeFields(GEMINI_SETTINGS, [field(0), field(1), field(2)], PROFILE, "");

  check("a missing fact is not re-asked", sent.length, 1);
  check("the request allows abstention", /return value:null/.test(sent[0]), true);
  check("the request has no forced second attempt", /SECOND ATTEMPT/.test(sent[0]), false);
  check("unknown facts are not excluded from abstention", /Return null ONLY/.test(sent[0]), false);
  check("the missing answer stays unresolved", out[2], undefined);
  check("supported answers survive", out[0]?.value, "a");
  nextResponses = null;
}
{
  // A model that insists a field is unanswerable must not be asked forever â€”
  // every round is another request against a free-tier quota.
  sent.length = 0;
  let reported = null;
  nextResponses = [
    okText('{"0":{"value":"a","confidence":1},"1":{"value":null,"confidence":0}}', false),
    ...Array.from({ length: 8 }, () => okText('{"0":{"value":null,"confidence":0}}', false))
  ];
  const out = await analyzeFields(GEMINI_SETTINGS, [field(0), field(1)], PROFILE, "",
                                  (e) => { reported = e; });
  check("an unknown fact consumes one request", sent.length, 1);
  check("a refusal is not reported as an unreadable reply",
    reported === null, true);
  check("what did come back is kept", out[0]?.value, "a");
  check("and the blank stays blank rather than being invented", out[1], undefined);
  nextResponses = null;
}
{
  // A reply that parsed to nothing is a failure, not an empty form. Swallowed
  // as {}, this was the largest single source of a silently unfilled page.
  sent.length = 0;
  let reported = null;
  nextResponses = [okText("Sorry, I can't help with that.", false)];
  let failure;
  try { await analyzeFields(GEMINI_SETTINGS, [field(0)], PROFILE, "", (e) => { reported = e; }); } catch (e) { failure = e; }
  check("an unreadable reply is reported", /could not be read/.test(reported?.message || ""), true);
  check("invalid schema does not trigger forced-answer retries", sent.length, 1);
  check("an all-invalid batch fails explicitly", failure?.parse, true);
  nextResponses = null;
}

// â”€â”€ Gemini reply shapes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  // A long JSON answer comes back split across parts; reading parts[0] alone
  // handed the caller the opening fragment of an object.
  nextResponses = [{
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [
      { text: '{"0": {"value": "spl' }, { text: 'it", "confidence": 1}}' }
    ] } }] })
  }];
  const out = await analyzeFields(GEMINI_SETTINGS, [field(0)], PROFILE, "");
  check("a reply split across parts is joined", out[0]?.value, "split");
  nextResponses = null;
}
{
  // Spending the whole output allowance on thinking is this model failing, not
  // the request failing â€” the next model in the chain gets a go.
  calls.length = 0;
  nextResponses = [{
    ok: true,
    json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] })
  }];
  let error;
  try { await analyzeFields(GEMINI_SETTINGS, [field(0)], PROFILE, ""); } catch (e) { error = e; }
  check("output exhaustion does not silently switch model", calls.length, 1);
  check("the selected provider was used", calls[0].body.contents !== undefined, true);
  check("and the failure is actionable", error?.truncated, true);
  nextResponses = null;
}
{
  // A block, on the other hand, is not something another model fixes.
  calls.length = 0;
  nextResponses = [{
    ok: true,
    json: async () => ({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] })
  }];
  let message = "";
  try { await generate(GEMINI_SETTINGS, "hi"); } catch (e) { message = e.message; }
  check("a blocked reply fails without walking the chain", calls.length, 1);
  check("and names the reason", /SAFETY/.test(message), true);
  nextResponses = null;
}

// â”€â”€ The instructions that make it fill more, and write like a person â”€â”€
{
  sent.length = 0;
  await analyzeFields(GEMINI_SETTINGS, [{ label: "Why do you want to work here?", kind: "textarea" }],
                      PROFILE, "RESUME BODY MARKER");
  const p = sent[0];

  check("resume is included in the prompt", p.includes("RESUME BODY MARKER"), true);
  check("told to answer every field", /Answer EVERY field/.test(p), false);
  check("told to infer rather than skip", /Infer freely/.test(p), false);
  check("null is reserved for the genuinely unanswerable", /missing or the question is ambiguous/.test(p), true);
  check("low confidence does not mean return null", /Confidence alone does not authorize/.test(p), true);

  // The honesty guard has to survive the push toward filling more.
  check("still forbids inventing verifiable facts", /Do not invent facts/.test(p), true);
  check("names the facts that must not be invented", /credentials/.test(p) && /metrics/.test(p), true);

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

// â”€â”€ Option and length hints reach the model â”€â”€
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

// â”€â”€ Provider selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Groq request shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // namespaced one â€” this is the whole point of the free-text field.
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

// â”€â”€ Groq error handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// â”€â”€ Quota (429) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// The failure this guards is not a crash, it is a silence: a spent quota used
// to reach the user as a half-filled form and the words "Nothing left to fill
// here". Two properties matter â€” the refusal must be fast (no sleeping through
// three retries per model across the whole fallback chain), and it must arrive
// as something the user can act on rather than as Google's quota-metric prose.
{
  calls.length = 0;
  nextResponses = [err(429, "Quota exceeded for quota metric 'Generate Content API requests per day'")];
  let e = null;
  try { await generate(GROQ_SETTINGS, "hi"); } catch (x) { e = x; }
  check("a 429 is not retried when no delay is offered", calls.length, 1);
  check("and is flagged as a quota failure", e?.quota, true);
  check("and says so in words the user can act on", /no quota left/i.test(e?.message || ""), true);
  check("and names the provider", /Groq/.test(e?.message || ""), true);
  check("and says the rules still filled what they could",
    /rules could answer/i.test(e?.message || ""), true);
  nextResponses = null;
}
{
  // Gemini counts free quota per model, so the chain is still walked â€” once per
  // model, not three times each.
  calls.length = 0;
  nextResponses = Array.from({ length: 8 }, () => err(429, "RESOURCE_EXHAUSTED"));
  let e = null;
  try { await generate(GEMINI_SETTINGS, "hi"); } catch (x) { e = x; }
  // The chosen model plus the fallbacks it is not already one of â€” one attempt
  // each. Retried three times apiece, this same refusal took ~30s to arrive.
  check("Gemini preserves the selected model on quota failure", calls.length, 1);
  check("and reports quota rather than the last raw message", e?.quota, true);
  nextResponses = null;
}
{
  // A batch that runs out partway must keep what it already paid for.
  calls.length = 0; sent.length = 0;
  nextResponses = [okText('{"0":{"value":"kept","confidence":1}}', false),
                   ...Array.from({ length: 6 }, () => err(429, "RESOURCE_EXHAUSTED"))];
  let reported = null;
  const out = await analyzeFields(GEMINI_SETTINGS, Array.from({ length: 20 }, (_, i) => field(i)),
                                  PROFILE, "", (x) => { reported = x; });
  check("answers from the batches that succeeded survive a later 429", out["0"]?.value, "kept");
  check("and the quota failure is reported to the caller", reported?.quota, true);
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

// â”€â”€ Exclusive single-field AI generation â”€â”€
{
  sent.length = 0; calls.length = 0;
  nextResponses = [okText("I built a scalable microservice architecture.", false)];
  const ans = await generateExclusiveAnswer(
    GEMINI_SETTINGS,
    { label: "Describe a project you led", kind: "textarea", maxLength: 500 },
    PROFILE,
    "Resume with Python and Go",
    { company: "Acme Corp", role: "Staff Engineer", text: "Looking for high scale systems" },
    "Keep it under 3 sentences and emphasize leadership."
  );

  check("exclusive answer returns clean text", ans, "I built a scalable microservice architecture.");
  check("prompt contains question label", /Describe a project you led/.test(sent[0]), true);
  check("prompt contains custom instruction", /Keep it under 3 sentences and emphasize leadership\./.test(sent[0]), true);
  check("prompt contains target job company", /Company: Acme Corp/.test(sent[0]), true);
  check("prompt contains character limit", /500 characters/.test(sent[0]), true);
  nextResponses = null;
}
{
  // Strips markdown fences if returned
  sent.length = 0;
  nextResponses = [okText('```markdown\nMy authentic project answer.\n```', false)];
  const ans = await generateExclusiveAnswer(
    GEMINI_SETTINGS,
    { label: "Leadership experience" },
    PROFILE,
    ""
  );
  check("markdown code blocks are stripped from answer", ans, "My authentic project answer.");
  nextResponses = null;
}
{
  // Helper text, section title, and placeholder are incorporated into the prompt
  sent.length = 0;
  nextResponses = [okText("Detailed tailored project answer.", false)];
  await generateExclusiveAnswer(
    GEMINI_SETTINGS,
    {
      label: "Project Details",
      helperText: "Include metrics, timeline, and technologies.",
      section: "Work Experience",
      placeholder: "e.g. Led migration to Kubernetes"
    },
    PROFILE,
    ""
  );
  check("prompt contains helperText", /Include metrics, timeline, and technologies\./.test(sent[0]), true);
  check("prompt contains section", /Form section: "Work Experience"/.test(sent[0]), true);
  check("prompt contains placeholder", /Field placeholder: "e\.g\. Led migration to Kubernetes"/.test(sent[0]), true);
  nextResponses = null;
}
{
  // Character limit is enforced on oversized model output
  sent.length = 0;
  const longAnswer = "This is a great achievement. It solved an important problem. It had measurable impact across the team. More extra sentences that go way beyond the maximum allowed character limit.";
  nextResponses = [okText(longAnswer, false)];
  const ans = await generateExclusiveAnswer(
    GEMINI_SETTINGS,
    { label: "Brief summary", maxLength: 60 },
    PROFILE,
    ""
  );
  check("answer is trimmed cleanly within maxLength", ans.length <= 60, true);
  check("answer ends with period or ellipsis", ans.endsWith(".") || ans.endsWith("â€¦"), true);
  nextResponses = null;
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
