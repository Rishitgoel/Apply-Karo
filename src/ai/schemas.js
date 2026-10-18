export const GEMINI_DECISION_SCHEMA = {
  type: "object", required: ["decisions"], properties: { decisions: { type: "array", items: {
    type: "object", required: ["fieldId", "revision", "status", "factId", "memoryId", "value", "optionIds", "claims"], properties: {
      fieldId: { type: "string" }, revision: { type: "integer" }, status: { type: "string", enum: ["fact", "memory", "draft", "needs_user", "ambiguous"] },
      factId: { type: "string", nullable: true }, memoryId: { type: "string", nullable: true }, value: { type: "string", nullable: true }, optionIds: { type: "array", items: { type: "string" } },
      claims: { type: "array", items: { type: "object", required: ["text", "evidenceId", "quote"], properties: { text: { type: "string" }, evidenceId: { type: "string" }, quote: { type: "string" } } } }
    }
  } } }
};

export const DECISION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["decisions"], properties: { decisions: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["fieldId", "revision", "status", "factId", "memoryId", "value", "optionIds", "claims"], properties: {
      fieldId: { type: "string" }, revision: { type: "integer" }, status: { type: "string", enum: ["fact", "memory", "draft", "needs_user", "ambiguous"] },
      factId: { type: ["string", "null"] }, memoryId: { type: ["string", "null"] }, value: { type: ["string", "null"] }, optionIds: { type: "array", items: { type: "string" } },
      claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "evidenceId", "quote"], properties: { text: { type: "string" }, evidenceId: { type: "string" }, quote: { type: "string" } } } }
    }
  } } }
};

export function decisionSchema(provider = "gemini") {
  return provider === "gemini" ? GEMINI_DECISION_SCHEMA : DECISION_SCHEMA;
}
export function parseDecisions(text, fields) {
  let body; try { body = JSON.parse(text); } catch { throw Object.assign(new Error("The model returned invalid decision JSON."), { schema: true }); }
  if (!body || Object.keys(body).some(k => k !== "decisions") || !Array.isArray(body.decisions)) throw Object.assign(new Error("Invalid decision envelope."), { schema: true });
  const allowed = new Map(fields.map(f => [f.fieldId, f.revision])), seen = new Set(), result = new Map();
  const keys = new Set(Object.keys(DECISION_SCHEMA.properties.decisions.items.properties));
  for (const row of body.decisions) {
    if (!row || Object.keys(row).some(k => !keys.has(k)) || !allowed.has(row.fieldId) || seen.has(row.fieldId) || row.revision !== allowed.get(row.fieldId) ||
      !["fact", "memory", "draft", "needs_user", "ambiguous"].includes(row.status) ||
      !(row.factId === null || typeof row.factId === "string") || !(row.memoryId === null || typeof row.memoryId === "string") || !(row.value === null || typeof row.value === "string") ||
      !Array.isArray(row.optionIds) || row.optionIds.some(id => typeof id !== "string") || !Array.isArray(row.claims) || row.claims.length > 12 ||
      row.claims.some(c => !c || Object.keys(c).length !== 3 || ["text", "evidenceId", "quote"].some(k => typeof c[k] !== "string")))
      throw Object.assign(new Error("Unknown, duplicate or stale model decision."), { schema: true });
    seen.add(row.fieldId); result.set(row.fieldId, row);
  }
  return result; // Missing decisions abstain; an intentional abstention is never retried.
}
export function capabilities(provider, model) { return { schema: provider === "gemini" && /^gemini-/.test(model) || provider === "groq" && /^openai\/gpt-oss-(120b|20b)$/.test(model), json: true }; }
