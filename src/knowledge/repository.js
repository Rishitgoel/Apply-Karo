// Only the service worker opens this extension-origin database.
export const DB_NAME = "apply-karo-knowledge";
export const emptyKnowledge = () => ({ version: 1, revision: 0, facts: {}, evidence: {}, answers: {}, legacy: {}, undo: {}, entities: {}, recordRevisions: {}, dependencies: {}, migrations: {} });
export function createRepository(factory = globalThis.indexedDB) {
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("knowledge");
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error("Close older dashboard tabs to update knowledge storage.")); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
  });
  async function transact(change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("knowledge", change ? "readwrite" : "readonly"), store = tx.objectStore("knowledge");
      let value, failure;
      const request = store.get("state");
      request.onsuccess = () => {
        const state = request.result || emptyKnowledge();
        try {
          value = change ? change(state) : state;
          if (value?.then) throw new Error("Knowledge transactions must be synchronous.");
          if (change) { state.revision++; store.put(state, "state"); }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(structuredClone(value));
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("Knowledge transaction failed."));
    });
  }
  return { read: () => transact(), mutate: transact, clear: () => transact((state) => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, emptyKnowledge()); }) };
}

export function putRecord(state, collection, record, expectedRevision) {
  if (!["facts", "evidence", "answers"].includes(collection)) throw new Error("Invalid knowledge collection.");
  const previous = state[collection][record.id];
  if (expectedRevision !== undefined && expectedRevision !== (previous?.revision || 0)) throw new Error("This record changed in another tab. Refresh before saving.");
  const now = Date.now();
  state.recordRevisions ||= {};
  const revisionKey = `${collection}:${record.id}`;
  const next = { ...record, schemaVersion: 1, revision: Math.max(previous?.revision || 0, state.recordRevisions[revisionKey] || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now };
  state.recordRevisions[revisionKey] = next.revision;
  state[collection][record.id] = next;
  return next;
}
export function deleteRecord(state, collection, id, expectedRevision) {
  if (!["facts", "evidence", "answers"].includes(collection)) throw new Error("Invalid knowledge collection.");
  const record = state[collection]?.[id];
  if (!record || record.revision !== expectedRevision) throw new Error("This record changed. Refresh before deleting.");
  const token = crypto.randomUUID();
  state.undo[token] = { collection, record, deletedAt: Date.now() };
  delete state[collection][id];
  return token;
}
export function undoDelete(state, token) {
  const saved = state.undo[token];
  if (saved?.kind === "answer-edit") {
    if (state.answers[saved.record.id]?.revision !== saved.revision) throw new Error("A newer answer was kept. This edit cannot be undone.");
    const restored = putRecord(state, "answers", saved.record, saved.revision); delete state.undo[token]; return restored;
  }
  if (!saved || state[saved.collection][saved.record.id]) throw new Error("Deletion cannot be undone after a newer update.");
  const result = putRecord(state, saved.collection, saved.record, 0);
  delete state.undo[token]; return result;
}
