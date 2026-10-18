export async function knowledge(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type: "knowledge", action, ...payload });
  if (!result?.ok) throw new Error(result?.error || "Knowledge storage is unavailable. Refresh and retry.");
  return result.result;
}
