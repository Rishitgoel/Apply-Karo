import { createRepository, putRecord, deleteRecord, undoDelete } from "./repository.js";
import { flattenProfile, fingerprint, syncDependencies, recordProfile, proposeResume, setPath, getPath, SETUP_FIELDS } from "./facts.js";
import { migrateLegacy } from "./migrate.js";
import { questionContext, answerIdentity, scopedAnswerIdentity, candidates } from "./retrieve.js";
import { canonicalQuestion } from "../shared/field-identity.js";
import { reusableQuestion, correctionKind } from "./learning.js";

export function createKnowledgeService(storage, repository = createRepository()) {
  let queue = Promise.resolve();
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
  async function rawState() {
    const raw = await storage.get(["profile", "learned", "answerTrust", "corrections", "resumeMeta", "resumeFile", "job"]);
    const pending = (await repository.read()).pendingProfile;
    if (pending) {
      const current = fingerprint(raw.profile || {});
      if (current !== pending.before && current !== fingerprint(pending.profile)) {
        await repository.mutate(state => { state.legacy.recoveryProfile = { ...pending, status: "unverified", reason: "newer-profile-conflict" }; });
      } else { await storage.set({ profile: pending.profile }); raw.profile = pending.profile; }
      await repository.mutate(state => { delete state.pendingProfile; });
    }
    [raw.profileDigest, raw.resumeMetaDigest, raw.resumeDigest, raw.jobDigest] = await Promise.all([
      digest(fingerprint(raw.profile || {})), digest(fingerprint(raw.resumeMeta || {})), digest(raw.resumeFile?.base64 || ""), digest(fingerprint(raw.job || {}))
    ]);
    return raw;
  }
  function pendingProfile(state, before, profile) { state.pendingProfile = { before: fingerprint(before || {}), profile: structuredClone(profile) }; }
  async function projectProfile(profile, extra = {}) { await storage.set({ profile, ...extra, knowledgeRevision: Date.now() }); await repository.mutate(state => { delete state.pendingProfile; }); }
  function execute(action, payload = {}, sender = {}) {
    const task = queue.catch(() => {}).then(async () => {
      const raw = await rawState();
      await repository.mutate(state => { migrateLegacy(state, raw); syncDependencies(state, raw); });
      const extensionPage = String(sender.url || "").startsWith(chrome.runtime.getURL(""));
      if (!["snapshot", "answer", "undo-answer", "candidates", "demote"].includes(action) && !extensionPage) throw new Error("Open the dashboard to manage knowledge.");
      if (action === "snapshot") { const state = await repository.read(); return extensionPage ? state : { version: state.version, revision: state.revision, answers: state.answers,
        facts: Object.fromEntries(Object.entries(state.facts).filter(([, r]) => r.status === "confirmed")), dependencies: state.dependencies }; }
      if (action === "candidates") return candidates(await repository.read(), questionContext(payload.field, sender.url));
      if (action === "answer") {
        if (!sender.tab || !/^https?:/.test(sender.url || "") || typeof payload.value !== "string" || !payload.value.trim() || payload.value.length > 50000) throw new Error("Invalid reviewed answer.");
        const context = questionContext(payload.field || {}, sender.url);
        if (!context.question || payload.field?.extraction?.conflicting) throw new Error("Correct the question before remembering an answer.");
        if (payload.scope === "similar" && !reusableQuestion(context.question)) throw new Error("This question needs application-specific review. Use it for this application.");
        const answer = await repository.mutate(state => {
          const id = scopedAnswerIdentity(context, payload.scope);
          const previous = state.answers[id] ? structuredClone(state.answers[id]) : null;
          const result = putRecord(state, "answers", { id, question: context.question, value: payload.value.trim(), context,
            status: "approved", scope: payload.scope === "similar" ? { type: "personal-question" } : { type: "application", application: context.application }, dependencies: { ...state.dependencies },
            provenance: { source: "user-correction", kind: correctionKind(state.answers[id], payload.value, payload.mappingRepair === true), confirmedAt: Date.now(), url: context.application }, expiresAt: Date.now() + 90 * 86400000 }, payload.expectedRevision);
          const token = crypto.randomUUID(); state.undo[token] = { kind: "answer-write", id, previous, revision: result.revision, application: context.application, tabId: sender.tab.id, frameId: sender.frameId };
          return { ...result, undoToken: token };
        });
        await storage.set({ knowledgeRevision: Date.now() }); return answer;
      }
      if (action === "undo-answer") {
        const result = await repository.mutate(state => {
          const saved = state.undo[payload.token];
          if (!saved || saved.kind !== "answer-write" || saved.tabId !== sender.tab?.id || saved.frameId !== sender.frameId || saved.application !== questionContext({}, sender.url).application || state.answers[saved.id]?.revision !== saved.revision) throw new Error("This saved answer changed; its newer value was kept.");
          if (saved.previous) putRecord(state, "answers", saved.previous, saved.revision); else delete state.answers[saved.id];
          delete state.undo[payload.token]; return true;
        }); await storage.set({ knowledgeRevision: Date.now() }); return result;
      }
      if (action === "demote") {
        const corrections = raw.corrections || {};
        for (const [key, ids] of Object.entries(payload.changes || {})) corrections[key] = [...new Set([...(corrections[key] || []), ...ids])];
        await storage.set({ corrections }); return true;
      }
      if (action === "legacy-edit") {
        const kind = payload.kind;
        if (!["learned", "customFields"].includes(kind)) throw new Error("Invalid answer collection.");
        const values = structuredClone(kind === "learned" ? raw.learned || {} : raw.profile?.customFields || {}), trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} };
        trust[kind] ||= {};
        for (const row of payload.changes || []) {
          if (values[row.key] !== row.before) throw new Error("This answer changed in another tab. Refresh before saving.");
          if (["__proto__", "prototype", "constructor"].includes(row.key)) throw new Error("Invalid answer key.");
          if (row.value === undefined) { delete values[row.key]; delete trust[kind][row.key]; }
          else { values[row.key] = row.value; trust[kind][row.key] = { value: row.value, source: "user-confirmed", confirmedAt: Date.now() }; }
        }
        await storage.set({ ...(kind === "learned" ? { learned: values } : { profile: { ...raw.profile, customFields: values } }), answerTrust: trust }); return values;
      }
      if (action === "profile") {
        const profile = structuredClone(raw.profile || {}), changes = payload.changes || [];
        for (const row of changes) {
          const actual = getPath(profile, row.path), missingDefault = actual === undefined && (row.before === "" || Array.isArray(row.before) && !row.before.length);
          if (!missingDefault && fingerprint(actual) !== fingerprint(row.before)) throw new Error("A profile field changed in another tab. Reload before saving.");
          setPath(profile, row.path, row.value);
        }
        await repository.mutate(state => { recordProfile(state, profile, flattenProfile(profile).filter(r => changes.some(c => r.path === c.path || r.path.startsWith(c.path + "."))).map(r => r.path)); pendingProfile(state, raw.profile, profile); });
        const trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} }; trust.customFields ||= {};
        for (const row of changes.filter(r => r.path.startsWith("customFields."))) trust.customFields[row.path.slice(13)] = { value: row.value, source: "user-confirmed", confirmedAt: Date.now() };
        await projectProfile(profile, { answerTrust: trust }); return profile;
      }
      if (action === "setup") {
        const allowed = new Set(SETUP_FIELDS.map(r => r[0])), entries = Object.entries(payload.values || {}).filter(([path, value]) => allowed.has(path) && String(value).trim());
        const values = Object.fromEntries(entries), country = canonicalQuestion(values["authorization.country"]);
        if (["authorization.authorized", "authorization.sponsorship"].some(p => values[p]) && !country) throw new Error("Choose the authorization country first.");
        if (["compensation.amount", "compensation.currency", "compensation.period"].some(p => values[p]) && !["compensation.amount", "compensation.currency", "compensation.period"].every(p => values[p])) throw new Error("Compensation needs an amount, currency and period.");
        if (values["compensation.amount"] && (!Number.isFinite(Number(values["compensation.amount"])) || Number(values["compensation.amount"]) < 0)) throw new Error("Enter a valid compensation amount.");
        if (values["compensation.currency"] && !/^[A-Z]{3}$/.test(values["compensation.currency"])) throw new Error("Use a three-letter currency code, such as INR or USD.");
        if (values["compensation.period"] && !["year", "month", "hour"].includes(values["compensation.period"])) throw new Error("Use year, month or hour for compensation period.");
        if (values["availability.noticeDays"] && !/^\d+$/.test(values["availability.noticeDays"])) throw new Error("Notice days must be a whole number.");
        if (values["availability.startDate"] && (!/^\d{4}-\d{2}-\d{2}$/.test(values["availability.startDate"]) || !Number.isFinite(Date.parse(values["availability.startDate"])))) throw new Error("Use YYYY-MM-DD for availability.");
        if (values["disclosure.preference"] && !["ask", "skip", "use confirmed"].includes(values["disclosure.preference"])) throw new Error("Choose ask, skip or use confirmed for disclosure.");
        for (const path of ["authorization.authorized", "authorization.sponsorship"]) if (values[path] && !/^(yes|no)$/i.test(values[path])) throw new Error("Use Yes or No for authorization and sponsorship.");
        const profile = structuredClone(raw.profile || {});
        const facts = await repository.mutate(state => {
          const records = entries.map(([path, value]) => {
          if (path.startsWith("personal.")) setPath(profile, path, value);
          return putRecord(state, "facts", { id: `setup:${path}:${path.startsWith("authorization.") ? country : ""}`, intent: path, value,
            entityId: "personal", status: "confirmed", scope: country && path.startsWith("authorization.") ? { type: "country", country } : { type: "profile" },
            provenance: { source: "user-setup", confirmedAt: Date.now() }, asOf: new Date().toISOString().slice(0, 10), refreshAfter: Date.now() + 90 * 86400000 });
          }); pendingProfile(state, raw.profile, profile); return records;
        });
        await projectProfile(profile); return facts;
      }
      if (action === "propose") {
        const text = String(raw.resumeMeta?.text || "");
        if (!text || payload.resumeText !== text || (raw.resumeMeta.textFileName && raw.resumeMeta.textFileName !== raw.resumeMeta.fileName)) throw new Error("The resume changed or its text is stale. Read the current resume again.");
        return repository.mutate(state => proposeResume(state, payload.profile || {}, text, state.dependencies.resume, raw.profile || {}));
      }
      if (action === "confirm-proposals") {
        const profile = structuredClone(raw.profile || {});
        const confirmed = await repository.mutate(state => {
          const rows = (payload.records || []).map(({ id, revision }) => {
            const record = state.facts[id];
            if (!record || record.revision !== revision || record.status !== "proposed" || record.dependencies.resume !== state.dependencies.resume || record.dependencies.profile !== state.dependencies.profile) throw new Error("This resume proposal changed. Extract and review it again.");
            if (!record.intent.startsWith("personal.") && !/^(education|experience)\.\d+\.[a-zA-Z]+$/.test(record.intent) && !["skills", "summary"].includes(record.intent)) throw new Error("Unsupported resume fact.");
            setPath(profile, record.intent, record.value);
            return record;
          });
          recordProfile(state, profile, rows.map(r => r.intent), "user-confirmed-resume");
          for (const row of rows) {
            const active = state.facts[`profile:${row.intent}`];
            putRecord(state, "facts", { ...active, evidenceIds: row.evidenceIds, dependencies: { resume: row.dependencies.resume },
              provenance: { ...active.provenance, span: row.provenance.span } }, active.revision);
            putRecord(state, "facts", { ...row, status: "accepted", provenance: { ...row.provenance, confirmedAt: Date.now() } }, row.revision);
            const evidence = state.evidence[row.evidenceIds[0]]; if (evidence) evidence.status = "confirmed";
          }
          pendingProfile(state, raw.profile, profile); return rows.length;
        });
        await projectProfile(profile); return { confirmed, profile };
      }
      if (action === "delete") { const token = await repository.mutate(s => deleteRecord(s, payload.collection, payload.id, payload.revision)); await storage.set({ knowledgeRevision: Date.now() }); return token; }
      if (action === "edit-answer") {
        const result = await repository.mutate(state => {
          const record = state.answers[payload.id];
          if (!record || record.revision !== payload.revision || record.status !== "approved" || typeof payload.value !== "string" || !payload.value.trim() || payload.value.length > 50000) throw new Error("Refresh and review this answer before editing.");
          const previous = structuredClone(record), edited = putRecord(state, "answers", { ...record, value: payload.value.trim(), dependencies: { ...state.dependencies }, provenance: { source: "user-reviewed-answer", confirmedAt: Date.now() } }, record.revision);
          const undoToken = crypto.randomUUID(); state.undo[undoToken] = { kind: "answer-edit", record: previous, revision: edited.revision };
          return { ...edited, undoToken };
        }); await storage.set({ knowledgeRevision: Date.now() }); return result;
      }
      if (action === "approve-answer") {
        const result = await repository.mutate(state => {
          const record = state.answers[payload.id];
          if (!record || record.revision !== payload.revision || !record.question || typeof record.value !== "string" || !record.value || record.value.length > 50000 ||
              record.scope?.type !== "application" || !/^https?:\/\//.test(record.scope.application) || record.context?.application !== record.scope.application ||
              record.context.question !== record.question || !record.context.section || !record.context.entityId || !Array.isArray(record.context.options)) throw new Error("This answer cannot be approved. Review the question on its application page instead.");
          if (Object.values(state.answers).some(other => other.id !== record.id && other.status === "approved" && answerIdentity(other.context) === answerIdentity(record.context)))
            throw new Error("A matching approved answer already exists. Delete the conflicting record before approving this one.");
          return putRecord(state, "answers", { ...record, status: "approved", dependencies: { ...state.dependencies }, expiresAt: Date.now() + 90 * 86400000,
            provenance: { source: "user-reviewed-answer", confirmedAt: Date.now(), previous: record.provenance } }, record.revision);
        }); await storage.set({ knowledgeRevision: Date.now() }); return result;
      }
      if (action === "undo") { const result = await repository.mutate(s => undoDelete(s, payload.token)); await storage.set({ knowledgeRevision: Date.now() }); return result; }
      if (action === "export") return repository.read();
      if (action === "import") {
        const data = payload.data;
        if (data?.version !== 1 || !data.facts || !data.answers || !data.evidence) throw new Error("Invalid knowledge backup.");
        // Imported approvals need a new local review. Dependencies and scopes cannot be trusted across profiles.
        await repository.mutate(state => {
          for (const collection of ["facts", "evidence", "answers"]) for (const record of Object.values(data[collection])) {
            if (!record?.id || typeof record.id !== "string" || ["__proto__", "constructor", "prototype"].includes(record.id)) throw new Error("Invalid backup record.");
            putRecord(state, collection, { ...record, id: `import:${crypto.randomUUID()}`, status: "unverified", provenance: { source: "backup-import", original: record.provenance } });
          }
        }); return true;
      }
      if (action === "clear") { await repository.clear(); await storage.set({ knowledgeRevision: Date.now() }); return true; }
      throw new Error("Unknown knowledge operation.");
    });
    queue = task; return task;
  }
  return { execute };
}
