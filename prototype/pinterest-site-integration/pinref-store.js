(() => {
  "use strict";

  const STORAGE_KEY = "pinrefPrototypeLibrary";
  const SCHEMA_VERSION = 4;

  function normalizeTags(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(",");
    return [...new Set(source.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
  }

  function normalizeRecord(record = {}) {
    const pinId = String(record.pinId || "");
    return {
      pinId,
      url: record.url || (pinId ? `https://www.pinterest.com/pin/${pinId}/` : ""),
      observedUrl: record.observedUrl || record.url || "",
      previewUrl: record.previewUrl || null,
      note: String(record.note || ""),
      tags: normalizeTags(record.tags),
      savedAt: record.savedAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.savedAt || new Date().toISOString()
    };
  }

  function normalizeAttempt(attempt = {}) {
    return {
      ...attempt,
      attemptId: String(attempt.attemptId || ""),
      operationId: String(attempt.operationId || attempt.attemptId || ""),
      originTabId: Number.isInteger(attempt.originTabId) ? attempt.originTabId : null,
      pinId: String(attempt.pinId || ""),
      trace: Array.isArray(attempt.trace) ? attempt.trace.map((entry) => ({ ...entry })) : []
    };
  }

  function normalizeImportSession(session = {}) {
    return {
      ...session,
      sessionId: String(session.sessionId || ""),
      originTabId: Number.isInteger(session.originTabId) ? session.originTabId : null,
      candidates: Object.fromEntries(Object.entries(session.candidates || {}).map(([pinId, candidate]) => [String(pinId), { ...candidate, pinId: String(pinId) }])),
      results: { imported: 0, duplicate: 0, inTrash: 0, failed: 0, ...(session.results || {}) },
      trace: Array.isArray(session.trace) ? session.trace.map((entry) => ({ ...entry })) : []
    };
  }

  async function readLibrary() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY] || {};
    const records = Object.fromEntries(Object.entries(raw.records || {})
      .map(([pinId, record]) => [pinId, normalizeRecord({ ...record, pinId })]));
    const library = {
      version: SCHEMA_VERSION,
      records,
      attempts: Object.fromEntries(Object.entries(raw.attempts || {})
        .map(([attemptId, attempt]) => [attemptId, normalizeAttempt({ ...attempt, attemptId })])),
      importSessions: Object.fromEntries(Object.entries(raw.importSessions || {})
        .map(([sessionId, session]) => [sessionId, normalizeImportSession({ ...session, sessionId })])),
      tagColors: { ...(raw.tagColors || {}) },
      tagOrder: Array.isArray(raw.tagOrder) ? [...raw.tagOrder] : []
    };
    const hasLegacyBoardMapping = Object.values(raw.records || {})
      .some((record) => Object.prototype.hasOwnProperty.call(record || {}, "boardContext"));
    if (raw.version !== SCHEMA_VERSION || hasLegacyBoardMapping) {
      await chrome.storage.local.set({ [STORAGE_KEY]: library });
    }
    return library;
  }

  async function writeLibrary(library) {
    const records = Object.fromEntries(Object.entries(library.records || {})
      .map(([pinId, record]) => [pinId, normalizeRecord({ ...record, pinId })]));
    const next = {
      version: SCHEMA_VERSION,
      records,
      attempts: Object.fromEntries(Object.entries(library.attempts || {})
        .map(([attemptId, attempt]) => [attemptId, normalizeAttempt({ ...attempt, attemptId })])),
      importSessions: Object.fromEntries(Object.entries(library.importSessions || {})
        .map(([sessionId, session]) => [sessionId, normalizeImportSession({ ...session, sessionId })])),
      tagColors: { ...(library.tagColors || {}) },
      tagOrder: Array.isArray(library.tagOrder) ? [...library.tagOrder] : []
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function mergeFromContent(incomingRecords = {}) {
    const library = await readLibrary();
    for (const [pinId, incoming] of Object.entries(incomingRecords)) {
      const existing = library.records[pinId];
      library.records[pinId] = existing
        ? normalizeRecord({
            ...incoming,
            ...existing,
            pinId,
            observedUrl: incoming.observedUrl || existing.observedUrl,
            previewUrl: incoming.previewUrl || existing.previewUrl
          })
        : normalizeRecord({ ...incoming, pinId });
    }
    return (await writeLibrary(library)).records;
  }

  async function saveRecord(record) {
    const library = await readLibrary();
    const next = normalizeRecord(record);
    library.records[next.pinId] = next;
    return (await writeLibrary(library)).records;
  }

  async function saveAttempt(attempt) {
    const library = await readLibrary();
    const next = normalizeAttempt(attempt);
    library.attempts[next.attemptId] = next;
    return (await writeLibrary(library)).attempts[next.attemptId];
  }

  async function removeAttempt(attemptId) {
    const library = await readLibrary();
    delete library.attempts[attemptId];
    return writeLibrary(library);
  }

  async function saveImportSession(session) {
    const library = await readLibrary();
    const next = normalizeImportSession(session);
    library.importSessions[next.sessionId] = next;
    return (await writeLibrary(library)).importSessions[next.sessionId];
  }

  async function removeImportSession(sessionId) {
    const library = await readLibrary();
    delete library.importSessions[sessionId];
    return writeLibrary(library);
  }

  async function commitAttempt(attemptId, record, { simulateFailure = false } = {}) {
    const library = await readLibrary();
    const attempt = library.attempts[attemptId];
    if (!attempt) return { ok: false, reason: "attempt-not-found" };
    if (simulateFailure) return { ok: false, reason: "simulated-local-write-failure", attempt };
    const duplicate = Boolean(library.records[attempt.pinId]);
    if (!duplicate) library.records[attempt.pinId] = normalizeRecord({ ...record, pinId: attempt.pinId });
    delete library.attempts[attemptId];
    await writeLibrary(library);
    return { ok: true, duplicate, record: library.records[attempt.pinId] };
  }

  async function updateRecord(pinId, patch) {
    const library = await readLibrary();
    if (!library.records[pinId]) return library.records;
    library.records[pinId] = normalizeRecord({
      ...library.records[pinId],
      ...patch,
      pinId,
      updatedAt: new Date().toISOString()
    });
    return (await writeLibrary(library)).records;
  }

  async function removeRecords(pinIds) {
    const library = await readLibrary();
    for (const pinId of pinIds) delete library.records[pinId];
    return (await writeLibrary(library)).records;
  }

  async function updateSettings(patch) {
    const library = await readLibrary();
    return writeLibrary({ ...library, ...patch });
  }

  globalThis.PinRefStore = Object.freeze({
    STORAGE_KEY,
    normalizeTags,
    normalizeRecord,
    normalizeAttempt,
    normalizeImportSession,
    readLibrary,
    writeLibrary,
    mergeFromContent,
    saveRecord,
    saveAttempt,
    removeAttempt,
    saveImportSession,
    removeImportSession,
    commitAttempt,
    updateRecord,
    removeRecords,
    updateSettings
  });
})();
