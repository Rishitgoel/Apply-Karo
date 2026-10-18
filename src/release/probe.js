import { createResolver, newBudget } from "../resolver/service.js";
import { generate, resolveProvider } from "../ai/transport.js";
export async function syntheticProviderProbe(configuration, request = generate) {
  const settings = { provider: configuration.provider, groqApiKey: configuration.groqApiKey, groqModel: configuration.groqModel,
    geminiApiKey: configuration.geminiApiKey, geminiModel: configuration.geminiModel, skipSensitive: true, defaultCustomInstruction: "" };
  const selected = resolveProvider(settings), started = Date.now(), usage = [];
  if (!selected.apiKey) return { status: "pending", passed: false, provider: selected.name, model: selected.model, reason: "Configure the selected provider key to run this synthetic check.", requests: 0, usage: null, costUsd: null };
  const profile = { personal: { firstName: "Morgan", lastName: "Vale", fullName: "Morgan Vale" }, customFields: {} };
  const fields = [
    { fieldId: "probe-name", revision: 1, questionFull: "First name", kind: "text", type: "text", section: "personal", entityId: "personal:0" },
    { fieldId: "probe-project", revision: 1, questionFull: "Describe a project you built.", kind: "textarea", section: "personal", entityId: "personal:0" },
    { fieldId: "probe-salary", revision: 1, questionFull: "Current annual salary in USD", kind: "text", type: "number", section: "personal", entityId: "personal:0" }
  ].map(field => ({ ...field, label: field.questionFull.toLowerCase(), rawLabel: field.questionFull, nameTokens: [], options: [] }));
  let attempts = 0;
  const resolver = createResolver({ request: async (settings, prompt, options) => { attempts++; return request(settings, prompt, { ...options, onUsage: value => usage.push(Object.fromEntries(["inputTokens", "outputTokens", "totalTokens"].map(key => [key, Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null]))) }); } });
  const budget = newBudget({ deadlineMs: 60000, maxRequests: 2, maxTokens: 14000 });
  const result = await resolver.resolve(fields, { settings, profile, resumeText: "Morgan Vale built a parser at Fictional Labs.", knowledge: { answers: {}, evidence: {}, dependencies: {} }, url: "https://synthetic.invalid/application" }, { useAI: true, useCache: false, budget });
  const checks = { knownFactPreserved: result.decisions[0].value === "Morgan", groundedDraft: result.decisions[1].status === "draft", missingSalaryAbstained: result.decisions[2].value === null,
    boundedRequests: attempts <= 2, partialFactsAvailable: result.decisions[0].status === "resolved" };
  return { measuredAt: new Date().toISOString(), status: Object.values(checks).every(Boolean) ? "passed" : "needs_attention", passed: Object.values(checks).every(Boolean),
    provider: selected.name, model: selected.model, elapsedMs: Date.now() - started, requests: attempts, retries: Math.max(0, attempts - 1), checks,
    outcomes: result.decisions.map(d => ({ fieldId: d.fieldId, status: d.status, reason: d.reason })), usage: usage.length ? usage : null, costUsd: null,
    failure: result.error ? "provider_or_schema_failure" : null, syntheticOnly: true, limitations: ["Small probe; not general prose quality or ATS acceptance.", "Cost is unknown without a current billing rate; token usage is reported when provided.", "Timeout/cancellation and malformed partial batches are tested offline; no deliberately expensive live failure loop."] };
}
