(function exposeImportDomain(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PinRefImportDomain = api;
})(typeof globalThis === "object" ? globalThis : this, function createImportDomain() {
  "use strict";

  const ACTIVE_STATUS = "scanning";

  function importSurfaceForUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    const [owner, collection] = segments;
    if (!owner || !collection) return null;
    if (["pin", "search", "ideas", "today", "settings", "explore"].includes(owner.toLowerCase())) return null;
    if (collection.startsWith("_") && collection !== "_pins") return null;
    url.hash = "";
    url.search = "";
    url.pathname = `/${owner}/${collection}/`;
    const surfaceUrl = url.toString();
    return {
      surfaceKind: collection === "_pins" ? "saved-root" : "board",
      surfaceKey: surfaceUrl,
      surfaceUrl
    };
  }

  function trace(session, event, detail, at) {
    return { at, event, state: session.status, detail: detail ?? null };
  }

  function pageContextForUrl(value) {
    const surface = importSurfaceForUrl(value);
    if (surface) return { kind: surface.surfaceKind, surface };
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/i.test(url.hostname)) return { kind: "outside-pinterest", surface: null };
      const pin = url.pathname.match(/^\/pin\/(?:[^/]*--)?(\d{6,})\/?$/);
      return pin ? { kind: "pin", pinId: pin[1], surface: null } : { kind: "unsupported", surface: null };
    } catch { return { kind: "outside-pinterest", surface: null }; }
  }

  function updateResults(session) {
    session.results = { imported: 0, duplicate: 0, inTrash: 0, failed: 0 };
    for (const candidate of Object.values(session.candidates)) {
      const outcome = candidate.result || candidate.eligibility;
      const key = outcome === "in-trash" ? "inTrash" : outcome;
      if (Object.hasOwn(session.results, key)) session.results[key] += 1;
    }
  }

  function createImportSession({ sessionId, tabId, surface, at }) {
    const session = {
      sessionId,
      originTabId: tabId,
      surfaceKind: surface.surfaceKind,
      surfaceKey: surface.surfaceKey,
      surfaceUrl: surface.surfaceUrl,
      status: "ready",
      stopReason: null,
      completionEvidence: null,
      scanComplete: false,
      candidates: {},
      selectedPinIds: [],
      results: { imported: 0, duplicate: 0, inTrash: 0, failed: 0 },
      skippedIdentity: 0,
      skippedMembership: 0,
      createdAt: at,
      updatedAt: at,
      trace: []
    };
    session.trace.push(trace(session, "SESSION_CREATED", surface.surfaceKey, at));
    return session;
  }

  function transitionImportSession(current, action, at) {
    const session = structuredClone(current);
    if (Number.isInteger(action.tabId) && action.tabId !== session.originTabId) {
      session.trace.push(trace(session, `IGNORED_TAB_MISMATCH:${action.type}`, action.tabId, at));
      return session;
    }
    if (action.surfaceKey && action.surfaceKey !== session.surfaceKey) {
      session.status = "paused";
      session.stopReason = "navigation";
      session.updatedAt = at;
      session.trace.push(trace(session, `INTERRUPTED_SURFACE_MISMATCH:${action.type}`, action.surfaceKey, at));
      return session;
    }
    if ((action.type === "START_SCAN" && session.status === "ready") ||
        (action.type === "RESUME_FROM_TOP" && !session.importStartedAt && ["paused", "ready-to-import", "reviewing"].includes(session.status))) {
      session.status = ACTIVE_STATUS;
      session.stopReason = null;
      session.completionEvidence = null;
      session.scanComplete = false;
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
      return session;
    }
    if (action.type === "OBSERVE_BATCH" && session.status === ACTIVE_STATUS) {
      for (const observation of action.observations || []) {
        const pinId = String(observation.pinId || "");
        if (!/^\d{6,}$/.test(pinId)) continue;
        const previous = session.candidates[pinId];
        const scopeHistory = [...(previous?.scopeHistory || [])];
        if (observation.scopeKey && !scopeHistory.some((scope) => scope.scopeKey === observation.scopeKey && scope.scopeHeading === (observation.scopeHeading || null))) {
          scopeHistory.push({
            scopeKey: observation.scopeKey,
            scopeHeading: observation.scopeHeading || null,
            scopeBoundaryKind: observation.scopeBoundaryKind || "unknown"
          });
        }
        session.candidates[pinId] = {
          ...(previous || {}),
          ...observation,
          pinId,
          scopeHistory,
          observationCount: Number(previous?.observationCount || 0) + 1,
          firstObservedAt: previous?.firstObservedAt || at,
          lastObservedAt: at,
          result: previous?.result || null
        };
      }
      session.skippedIdentity += Math.max(0, Number(action.skippedIdentity || 0));
      session.skippedMembership += Math.max(0, Number(action.skippedMembership || 0));
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
      return session;
    }
    if (action.type === "END_UNCONFIRMED" && session.status === ACTIVE_STATUS) {
      session.status = "paused";
      session.stopReason = "unable-to-confirm-completion";
      session.completionEvidence = { kind: action.evidence || "heuristic-plateau", confidence: "heuristic-only" };
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, action.evidence, at));
      return session;
    }
    if (action.type === "END_RELIABLE" && session.status === ACTIVE_STATUS) {
      session.scanComplete = Object.keys(session.candidates).length > 0;
      session.status = session.scanComplete ? "ready-to-import" : "paused";
      if (!session.scanComplete) session.stopReason = "no-candidates";
      session.completionEvidence = { kind: action.evidence || "explicit-end-marker", confidence: "reliable" };
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, action.evidence, at));
      return session;
    }
    if (["INTERRUPT", "SCAN_FAILED"].includes(action.type) && session.status === ACTIVE_STATUS) {
      session.status = "paused";
      session.stopReason = action.reason || (action.type === "SCAN_FAILED" ? "scan-failed" : "interrupted");
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, session.stopReason, at));
      return session;
    }
    if (action.type === "BEGIN_REVIEW" && ["paused", "ready-to-import", "results"].includes(session.status)) {
      session.status = "reviewing";
      if (!session.hasReviewed) session.selectedPinIds = [];
      session.hasReviewed = true;
      for (const [pinId, candidate] of Object.entries(session.candidates)) {
        const state = action.referenceStates?.[pinId];
        session.candidates[pinId] = {
          ...candidate,
          eligibility: state === "active" ? "duplicate" : state === "trash" ? "in-trash" : "new"
        };
      }
      updateResults(session);
      session.selectedPinIds = session.selectedPinIds.filter((pinId) => session.candidates[pinId]?.eligibility === "new" && !session.candidates[pinId]?.result);
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
      return session;
    }
    if (action.type === "SELECT_ALL_NEW" && session.status === "reviewing") {
      session.selectedPinIds = Object.values(session.candidates)
        .filter((candidate) => candidate.eligibility === "new" && !candidate.result)
        .map((candidate) => candidate.pinId);
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, session.selectedPinIds.length, at));
      return session;
    }
    if (action.type === "SET_SELECTED" && session.status === "reviewing") {
      const candidate = session.candidates[action.pinId];
      if (!candidate || candidate.eligibility !== "new" || candidate.result) return session;
      const selected = new Set(session.selectedPinIds);
      action.selected ? selected.add(action.pinId) : selected.delete(action.pinId);
      session.selectedPinIds = [...selected];
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, action.pinId, at));
      return session;
    }
    if (action.type === "CLEAR_SELECTION" && session.status === "reviewing") {
      session.selectedPinIds = [];
      session.updatedAt = at;
      return session;
    }
    if (action.type === "BEGIN_IMPORT" && session.status === "reviewing" && session.selectedPinIds.length) {
      session.status = "importing";
      session.importStartedAt ||= at;
      session.pendingPinIds = [...session.selectedPinIds];
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
      return session;
    }
    if (action.type === "COMMIT_RESULT" && ["importing", "import-incomplete"].includes(session.status)) {
      const candidate = session.candidates[action.pinId];
      if (!candidate || !["imported", "duplicate", "in-trash", "failed"].includes(action.result)) return session;
      session.candidates[action.pinId] = { ...candidate, result: action.result, failureReason: action.reason || null };
      session.pendingPinIds = (session.pendingPinIds || []).filter((id) => id !== action.pinId);
      session.selectedPinIds = session.selectedPinIds.filter((id) => id !== action.pinId);
      updateResults(session);
      session.status = session.pendingPinIds.length ? "importing" : session.results.failed ? "import-incomplete" : "results";
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, `${action.pinId}:${action.result}`, at));
      return session;
    }
    if (action.type === "RETRY_LOCAL" && session.status === "import-incomplete" && session.candidates[action.pinId]?.result === "failed") {
      session.results.failed = Math.max(0, session.results.failed - 1);
      session.candidates[action.pinId] = { ...session.candidates[action.pinId], result: null, failureReason: null };
      session.status = "importing";
      session.pendingPinIds = [action.pinId];
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, action.pinId, at));
      return session;
    }
    const allResolved = Object.values(session.candidates).length > 0 && Object.values(session.candidates).every((candidate) => candidate.result || ["duplicate", "in-trash"].includes(candidate.eligibility));
    if (action.type === "DONE" && !(session.pendingPinIds || []).length && session.results.failed === 0 &&
        (session.status === "results" || (session.status === "reviewing" && (session.importStartedAt || allResolved)))) {
      session.status = "import-complete";
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
      return session;
    }
    if (action.type === "DISMISS") {
      session.status = "dismissed";
      session.updatedAt = at;
      session.trace.push(trace(session, action.type, null, at));
    }
    return session;
  }

  return { ACTIVE_STATUS, importSurfaceForUrl, pageContextForUrl, createImportSession, transitionImportSession };
});
