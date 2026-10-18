export const RELEASE_VERSION = "verified-autofill-v1";
export const DEFAULT_RELEASE = { version: RELEASE_VERSION, stage: "stable", percentage: 100, cohort: 0, descriptor: true, resolver: true, adapter: true };
export function releasePolicy(settings = {}) {
  const raw = settings.release || {}, policy = { ...DEFAULT_RELEASE, ...raw };
  const valid = policy.version === RELEASE_VERSION && ["stable", "pilot", "paused"].includes(policy.stage) &&
    Number.isInteger(policy.percentage) && policy.percentage >= 0 && policy.percentage <= 100 && Number.isInteger(policy.cohort) && policy.cohort >= 0 && policy.cohort < 100 &&
    ["descriptor", "resolver", "adapter"].every(key => typeof policy[key] === "boolean");
  const enabled = valid && policy.stage !== "paused" && ["descriptor", "resolver", "adapter"].every(key => policy[key]) && (policy.stage !== "pilot" || policy.cohort < policy.percentage);
  return { ...policy, enabled, reason: enabled ? "enabled" : "Automatic filling is paused by the release controls. Review, copy answers or update knowledge manually; no legacy autofill fallback is used." };
}
