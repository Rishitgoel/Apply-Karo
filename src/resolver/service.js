import { assign, RULE_BY_ID } from "../shared/rules.js";
import { answerPolicy } from "../shared/answer-policy.js";
import { candidates, questionContext } from "../knowledge/retrieve.js";
import { prepareField, formatFact } from "./format.js";
import { sourceForRule, groundedClaims, compatibleIntent, ruleCandidate, proseTarget } from "./validate.js";
import { resolveFields, decision, PROMPT_VERSION } from "./resolve.js";
import { interpret } from "../ai/interpret.js";
import { relevantEvidence } from "../ai/draft.js";
import { resolveProvider } from "../ai/transport.js";
export function newBudget({ deadlineMs = 120000, maxRequests = 16, maxTokens = 100000, signal } = {}) { return { deadline: Date.now() + deadlineMs, maxRequests, maxTokens, requests: 0, tokens: 0, signal }; }
export function cacheKey(field, context) {
  const provider = resolveProvider(context.settings);
  return JSON.stringify([PROMPT_VERSION, field, context.url, context.knowledge?.dependencies || {}, context.knowledge?.recordRevisions || {}, context.knowledge?.answers || {}, context.knowledge?.evidence || {}, context.profile, context.resumeText, provider.name, provider.model, context.settings?.defaultCustomInstruction || "", context.jobContext || null]);
}
export function createResolver({ request } = {}) {
  const cache = new Map();
  async function resolve(rawFields, context, { useAI = false, useCache = true, budget = newBudget() } = {}) {
    const fields = rawFields.map(prepareField), mappings = context.mappings || assign(fields, { skipSensitive: context.settings?.skipSensitive, hasAnswerFor: () => true, canMap: ruleCandidate });
    const decisions = resolveFields(fields, { ...context, mappings });
    if (!useAI) return { decisions, requests: 0, deferred: 0, error: "" };
    const pending = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (decisions[i].status !== "needs_user" || field.extraction?.conflicting || field.extraction?.truncated || field.extraction?.ambiguous || answerPolicy({ ...field, rawLabel: field.questionFull }, context.settings).critical) continue;
      const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheKey(field, context))))].map(v => v.toString(16).padStart(2,"0")).join("");
      const cached = cache.get(key);
      if (useCache && cached?.expires > Date.now() && cached.decision.status === "draft" && groundedClaims(cached.decision, relevantEvidence(context.knowledge || {}, context.profile || {}, context.resumeText || "", [field]), context.profile)) { decisions[i] = { ...cached.decision, cached: true }; continue; }
      pending.push({ field, i, key });
    }
    let error = "", deferred = 0, quota = false;
    for (let cursor = 0; cursor < pending.length; cursor += 8) {
      const batch = pending.slice(cursor, cursor + 8), batchFields = batch.map(r => r.field);
      const evidence = relevantEvidence(context.knowledge || {}, context.profile || {}, context.resumeText || "", batchFields);
      const available = new Map();
      const packetFields = batch.map(({ field }) => {
        const facts = [...RULE_BY_ID.values()].map(rule => sourceForRule(field, { ruleId: rule.id, instance: field.instance || 0 }, context.profile || {})).filter(Boolean).slice(0, 8);
        const memory = candidates({ answers: {}, dependencies: {}, ...context.knowledge }, questionContext(field, context.url), { limit: 4 });
        available.set(field.fieldId, { facts, memory });
        return { ...field, draftAllowed: proseTarget(field), facts, memory: memory.map(r => ({ id: r.id, question: r.question, value: r.value, context: r.context, exact: r.exact })) };
      });
      try {
        const entries = await interpret(context.settings, { version: PROMPT_VERSION, fields: packetFields, evidence, job: context.jobContext || null,
          instruction: context.settings?.defaultCustomInstruction || "" }, budget, request);
        if (budget.signal?.aborted) throw Object.assign(new Error("AI filling cancelled."), { cancelled: true });
        for (const row of batch) {
          const entry = entries.get(row.field.fieldId), resources = available.get(row.field.fieldId);
          if (!entry || ["needs_user", "ambiguous"].includes(entry.status)) { decisions[row.i] = decision(row.field, "needs_user", entry?.status || "model_abstained"); continue; }
          let resolved = null;
          if (entry.status === "fact") {
            const fact = resources.facts.find(f => f.id === entry.factId);
            if (fact && compatibleIntent(row.field, fact.intent) && entry.memoryId === null && !entry.claims.length) {
              const formatted = formatFact(row.field, fact.value, fact.intent);
              if (formatted.value && (entry.value === null || entry.value === formatted.value) && entry.optionIds.every(id => formatted.optionIds.includes(id)))
                resolved = decision(row.field, "resolved", "model_selected_compatible_fact", { ...formatted, intent: fact.intent, source: "profile", evidenceIds: [fact.id] });
            }
          } else if (entry.status === "memory") {
            const memory = resources.memory.find(m => m.id === entry.memoryId);
            // Semantic memory suggestions stay drafts until independently confirmed.
            if (memory?.exact && entry.factId === null && !entry.claims.length) {
              const formatted = formatFact(row.field, memory.value);
              if (formatted.value && (entry.value === null || entry.value === formatted.value) && entry.optionIds.every(id => formatted.optionIds.includes(id)))
                resolved = decision(row.field, "resolved", "model_selected_exact_memory", { ...formatted, source: "approved_memory", evidenceIds: [memory.id] });
            }
            if (memory && !memory.exact && entry.factId === null && !entry.claims.length && !entry.optionIds.length && !row.field.options.length && ["textarea", "richtext"].includes(row.field.kind) &&
              (entry.value === null || entry.value === memory.value) && (!row.field.maxLength || memory.value.length <= row.field.maxLength)) {
              resolved = decision(row.field, "draft", "semantic_memory_needs_review", { value: memory.value, source: "memory_draft", evidenceIds: [memory.id] });
            }
          } else if (entry.status === "draft" && proseTarget(row.field) && !row.field.options.length && !entry.optionIds.length && entry.factId === null && entry.memoryId === null) {
            const grounded = groundedClaims(entry, evidence, context.profile);
            const limit = row.field.maxLength || row.field.constraints?.maxLength;
            if (grounded && (!limit || grounded.value.length <= limit)) resolved = decision(row.field, "draft", "extractive_claims_need_review", { ...grounded, source: "resume_draft" });
          }
          decisions[row.i] = resolved || decision(row.field, "needs_user", "unsupported_model_decision");
          if (resolved) {
            cache.set(row.key, { decision: resolved, expires: Date.now() + 10 * 60000 });
            while (cache.size > 128) cache.delete(cache.keys().next().value);
          }
        }
      } catch (failure) {
        error = failure.message; quota = !!failure.quota; deferred = pending.length - cursor;
        for (const row of pending.slice(cursor)) decisions[row.i] = decision(row.field, "deferred", failure.cancelled ? "cancelled" : failure.budget ? "budget" : "provider_or_schema_failure");
        break;
      }
    }
    return { decisions, requests: budget.requests, deferred, error, quota };
  }
  return { resolve, clearCache: () => cache.clear() };
}
