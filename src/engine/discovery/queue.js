// Unprocessed fields remain explicit and are eligible on the next manual pass.
export async function processQueue(fields, process, { batchSize = 16, shouldStop = () => false, onProgress = () => {} } = {}) {
  const results = [];
  let cursor = 0;
  while (cursor < fields.length && !shouldStop()) {
    onProgress(fields.length - cursor);
    const batch = fields.slice(cursor, cursor + batchSize);
    const result = await process(batch);
    results.push(result); cursor += batch.length;
    if (result.quota) break;
  }
  return { results, remaining: fields.slice(cursor), processed: cursor };
}
