import { putRecord } from "./repository.js";
export function fingerprint(value) { return JSON.stringify(value ?? null); }
export function flattenProfile(profile) {
  const rows = [];
  const walk = (value, path = []) => {
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
    else if (path.length && value !== undefined) rows.push({ path: path.join("."), value });
  };
  walk(profile); return rows;
}
export function entityFor(state, path, profile) {
  const [kind, index] = path.split(".");
  if (!["education", "experience"].includes(kind)) return "personal";
  const item = profile[kind]?.[index] || {};
  const identity = fingerprint([kind, item.school || item.company || "", item.degree || item.title || "", item.startDate || "", item.endDate || "", item.id || "", index]);
  return state.entities[identity] ||= `${kind}:${crypto.randomUUID()}`;
}
export function syncDependencies(state, raw) {
  // Exact representations avoid hash collisions. Resume binary is included by its SHA-256, computed before transactions.
  state.dependencies = { profile: raw.profileDigest || fingerprint(raw.profile || {}), resume: (raw.resumeMetaDigest || fingerprint(raw.resumeMeta || {})) + (raw.resumeDigest || ""), job: raw.jobDigest || fingerprint(raw.job || {}) };
  for (const record of Object.values(state.facts)) {
    if (record.id.startsWith("profile:") && fingerprint(record.value) !== fingerprint(getPath(raw.profile || {}, record.intent))) record.status = "stale";
  }
}
export function recordProfile(state, profile, paths, source = "user-profile") {
  const rows = flattenProfile(profile).filter((row) => paths.includes(row.path));
  return rows.map((row) => putRecord(state, "facts", { id: `profile:${row.path}`, intent: row.path, value: row.value,
    entityId: entityFor(state, row.path, profile), status: "confirmed", scope: { type: "profile" },
    provenance: { source, confirmedAt: Date.now(), path: row.path }, asOf: new Date().toISOString().slice(0, 10),
    refreshAfter: /salary|notice|availability|authorized|sponsor|visa/i.test(row.path) ? Date.now() + 90 * 86400000 : null }));
}
export function proposeResume(state, profile, text, resumeDependency, currentProfile = {}) {
  const proposalId = crypto.randomUUID(), evidenceId = `resume:${proposalId}`;
  const evidence = putRecord(state, "evidence", { id: evidenceId, kind: "resume", text, status: "proposed",
    dependencies: { resume: resumeDependency }, provenance: { source: "resume-extraction", span: { start: 0, end: text.length } } });
  const stories = [];
  for (const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
    if (match[0].length < 40) continue;
    stories.push(putRecord(state, "evidence", { id: `${evidenceId}:span:${match.index}`, kind: /project/i.test(match[0]) ? "project" : "story",
      text: match[0], status: "proposed", dependencies: { resume: resumeDependency }, provenance: { source: "resume-span", span: { start: match.index, end: match.index + match[0].length } } }));
  }
  const facts = flattenProfile(profile).filter((r) => r.value !== "" && !r.path.startsWith("customFields.")).map((row) => {
    const start = text.toLocaleLowerCase().indexOf(String(row.value).toLocaleLowerCase());
    const previousValue = getPath(currentProfile, row.path);
    return putRecord(state, "facts", { id: `proposal:${proposalId}:${row.path}`, intent: row.path, value: row.value, entityId: entityFor(state, row.path, profile),
      status: "proposed", scope: { type: "profile" }, dependencies: { resume: resumeDependency, profile: state.dependencies.profile }, evidenceIds: [evidenceId],
      provenance: { source: "resume-extraction", span: start >= 0 ? { start, end: start + String(row.value).length } : null },
      conflict: previousValue !== undefined && previousValue !== "" && fingerprint(previousValue) !== fingerprint(row.value) ? previousValue : null });
  });
  return { proposalId, evidence, stories, facts };
}
export function setPath(target, path, value) {
  const parts = path.split(".");
  if (parts.some((p) => ["__proto__", "prototype", "constructor"].includes(p))) throw new Error("Invalid profile path.");
  let obj = target;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] ||= /^\d+$/.test(parts[i + 1]) ? [] : {};
  obj[parts.at(-1)] = value;
}
export function getPath(target, path) { return path.split(".").reduce((obj, part) => obj?.[part], target); }
export const SETUP_FIELDS = [
  ["personal.address", "Street address"], ["personal.city", "City"], ["personal.state", "State / province"], ["personal.postalCode", "Postal code"], ["personal.country", "Home country"],
  ["preferences.locations", "Preferred work locations"], ["availability.noticeDays", "Notice period (days)"], ["availability.startDate", "Available start date (YYYY-MM-DD)"],
  ["compensation.amount", "Expected compensation amount"], ["compensation.currency", "Currency (e.g. INR, USD)"], ["compensation.period", "Period (year, month, hour)"],
  ["authorization.country", "Authorization country"], ["authorization.authorized", "Authorized in that country (Yes / No)"], ["authorization.sponsorship", "Sponsorship needed there (Yes / No)"],
  ["disclosure.preference", "Disclosure preference (ask, skip, use confirmed)"]
];
