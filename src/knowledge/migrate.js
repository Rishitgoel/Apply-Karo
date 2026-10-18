import { putRecord } from "./repository.js";
import { flattenProfile } from "./facts.js";
export function migrateLegacy(state, raw) {
  if (state.migrations.legacyV1) return false;
  // Original data is preserved unchanged, including provenance-free entries; no credentials or binary.
  state.legacy.backup = structuredClone({ profile: raw.profile || {}, learned: raw.learned || {}, answerTrust: raw.answerTrust || {}, corrections: raw.corrections || {} });
  for (const row of flattenProfile(raw.profile || {})) putRecord(state, "facts", { id: `legacy:${row.path}`, intent: row.path, value: row.value,
    entityId: "unknown", status: "unverified", scope: { type: "legacy" }, provenance: { source: "legacy-unknown" } });
  for (const [key, value] of Object.entries(raw.learned || {})) state.legacy[key] = { question: key, value, status: "unverified", provenance: { source: "legacy-unknown" }, scope: { type: "legacy" } };
  state.migrations.legacyV1 = { at: Date.now(), version: 1 }; return true;
}
