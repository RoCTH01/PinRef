(function exposeStore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PinRefImportStore = api;
})(typeof globalThis === "object" ? globalThis : this, function createStoreModule() {
  "use strict";

  const STORAGE_KEY = "pinrefState";
  const SCHEMA_VERSION = 3;

  function emptyState() {
    return normalizeState({});
  }

  function normalizeState(raw) {
    const state = raw && typeof raw === "object" ? raw : {};
    const sessions = structuredClone(state.importSessions || {});
    for (const session of Object.values(sessions)) {
      session.pendingPinIds ||= [];
      session.selectedPinIds ||= [];
      session.scanComplete ??= session.completionEvidence?.confidence === "reliable";
      session.hasReviewed ??= ["reviewing", "importing", "results", "import-incomplete"].includes(session.status);
      if (["importing", "results", "import-incomplete"].includes(session.status)) {
        session.importStartedAt ||= session.updatedAt;
      }
      // The previous Dashboard used "importing" for completed result screens.
      if (session.status === "importing" && !session.pendingPinIds.length) {
        session.status = Object.values(session.candidates || {}).some((c) => c.result === "failed") ? "import-incomplete" : "results";
      }
    }
    const tags = structuredClone(state.tags || {});
    const records = (source) => Object.fromEntries(Object.entries(source || {}).map(([id, record]) => {
      const assignments = (record.tags || []).map((value) => {
        if (tags[value]) return value;
        // Version 2 stored tag names on each Reference. Deterministic IDs make migration idempotent.
        const name = String(value).trim();
        const tagId = `legacy:${name.normalize("NFKC").toLowerCase()}`;
        tags[tagId] ||= { tagId, name, color:"#a9c6ff", revision:0 };
        return tagId;
      });
      return [id, { note:"", ...record, tags:[...new Set(assignments)], noteRevision:record.noteRevision || 0,
        generation:record.generation || `legacy:${id}:${record.addedToPinRefAt || ""}`,
        lifecycleRevision:record.lifecycleRevision || 0, assignmentRevisions:{...record.assignmentRevisions},
        linkStatus:record.linkStatus || "unknown" }];
    }));
    const references = records(state.references);
    const trash = records(state.trash);
    return {
      version: SCHEMA_VERSION,
      references, trash, tags,
      tagOrder: [...new Set([...(state.tagOrder || []), ...Object.keys(tags)])].filter(id=>tags[id]),
      attempts: structuredClone(state.attempts || {}),
      preferences: {theme:"dark", galleryMode:"waterfall", inspectorMode:"floating", ...state.preferences},
      libraryRevision: state.libraryRevision || 0,
      receipt: state.receipt || null,
      importSessions: sessions,
      operations: { ...(state.operations || {}) }
    };
  }

  function createChromeRepository(storage = chrome.storage.local) {
    async function read() {
      const result = await storage.get(STORAGE_KEY);
      return normalizeState(result[STORAGE_KEY]);
    }

    async function write(state) {
      const normalized = normalizeState(state);
      await storage.set({ [STORAGE_KEY]: normalized });
      return normalized;
    }

    return {
      async readState() { return read(); },
      // The worker serializes all Import and Library writes through one queue.
      async updateState(update) {
        const state = await read();
        const result = await update(state);
        if (result?.persist !== false) {
          state.libraryRevision += 1;
          await write(state);
        }
        return result;
      },
      async listSessions() { return Object.values((await read()).importSessions); },
      async getSession(sessionId) { return (await read()).importSessions[sessionId] || null; },
      async saveSession(session) {
        const state = await read();
        state.importSessions[session.sessionId] = structuredClone(session);
        await write(state);
        return session;
      },
      async deleteSession(sessionId) {
        const state = await read();
        delete state.importSessions[sessionId];
        await write(state);
      },
      async getReferenceStates(pinIds) {
        const state = await read();
        return Object.fromEntries(pinIds.map((pinId) => [
          pinId,
          state.references[pinId] ? "active" : state.trash[pinId] ? "trash" : null
        ]));
      },
      async commitReference({ operationId, candidate, importedAt }) {
        const state = await read();
        const priorPinId = state.operations[operationId];
        if (priorPinId && state.references[priorPinId]) {
          return { ok: true, status: "imported", record: state.references[priorPinId] };
        }
        if (state.references[candidate.pinId]) return { ok: true, status: "duplicate", record: state.references[candidate.pinId] };
        if (state.trash[candidate.pinId]) return { ok: true, status: "in-trash" };
        const record = {
          pinId: candidate.pinId,
          generation: crypto.randomUUID(),
          url: `https://www.pinterest.com/pin/${candidate.pinId}/`,
          previewUrl: candidate.previewUrl || null,
          tags: [],
          note: "",
          noteRevision: 0,
          lifecycleRevision: 0,
          assignmentRevisions: {},
          linkStatus: "unknown",
          addedToPinRefAt: importedAt
        };
        state.references[candidate.pinId] = record;
        state.libraryRevision += 1;
        state.operations[operationId] = candidate.pinId;
        await write(state);
        return { ok: true, status: "imported", record };
      }
    };
  }

  return { STORAGE_KEY, SCHEMA_VERSION, emptyState, normalizeState, createChromeRepository };
});
