(() => {
  "use strict";

  function parsePinId(rawUrl, baseUrl = "https://www.pinterest.com/") {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl, baseUrl);
      if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/i.test(url.hostname)) return null;
      return url.pathname.match(/\/pin\/(?:[^/?#]*--)?(\d{6,})(?:\/|$)/i)?.[1] || null;
    } catch {
      return null;
    }
  }

  function isPinterestUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl);
      return url.protocol === "https:" && /(^|\.)pinterest\.com$/i.test(url.hostname);
    } catch {
      return false;
    }
  }

  function importSurfaceForUrl(rawUrl) {
    if (!isPinterestUrl(rawUrl)) return null;
    try {
      const url = new URL(rawUrl);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) return null;
      const [account, surface] = segments;
      if (!account || !surface) return null;
      if (["pin", "search", "ideas", "today", "settings", "explore"].includes(account.toLowerCase())) return null;
      const normalized = surface.toLowerCase();
      const surfaceKind = normalized === "_pins" ? "saved-root"
        : surface.startsWith("_") ? null
        : "board";
      if (!surfaceKind) return null;
      const pathname = `/${segments.join("/")}/`;
      return { surfaceKind, surfaceKey: `${url.origin}${pathname}`, surfaceUrl: `${url.origin}${pathname}` };
    } catch {
      return null;
    }
  }

  function panelOptionsForTab(tabId, rawUrl) {
    if (isPinterestUrl(rawUrl)) {
      return { tabId, path: "sidepanel.html", enabled: true };
    }
    return { tabId, enabled: false };
  }

  function chooseSafePreviewUrl(rawUrls = [], baseUrl = "https://www.pinterest.com/") {
    for (const rawUrl of rawUrls) {
      if (!rawUrl) continue;
      try {
        const url = new URL(rawUrl, baseUrl);
        if (url.protocol === "https:" && /(^|\.)pinimg\.com$/i.test(url.hostname)) return url.href;
      } catch {}
    }
    return null;
  }

  function chooseLargestVisiblePreview(candidates = [], baseUrl = "https://www.pinterest.com/") {
    const ranked = candidates
      .filter((candidate) => candidate?.visible !== false && Number(candidate.width) > 0 && Number(candidate.height) > 0)
      .sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)));
    return chooseSafePreviewUrl(ranked.map((candidate) => candidate.url), baseUrl);
  }

  function isPinterestBoardSelectorLabel(values = []) {
    const labels = (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return labels.some((label) => /(?:select|choose).*(?:board).*(?:save).*(?:pin)|(?:save).*(?:pin).*(?:board)|(?:選擇|选择).*(?:儲存|保存).*(?:Pin).*(?:圖版|圖板|图板)/i.test(label));
  }

  function isPinterestUnsavedSaveLabel(values = []) {
    const labels = (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (labels.some((label) => /(?:選擇|选择).*(?:圖版|圖板|图板)|select.*board|choose.*board/i.test(label))) return false;
    return labels.some((label) => /^(?:儲存|保存|save)$/i.test(label));
  }

  function isPinterestSavedLabel(values = []) {
    const labels = (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return labels.some((label) => /^(?:saved|已儲存|已保存)$/i.test(label));
  }

  function findPinterestSaveControlIndex(pathCandidates = []) {
    return pathCandidates.findIndex((candidate) => candidate?.isControl === true
      && candidate?.disabled !== true
      && isPinterestUnsavedSaveLabel(candidate?.labels || []));
  }

  function resolvePinterestSaveCommit({ directContext = null, pendingContext = null } = {}) {
    const source = directContext || pendingContext;
    if (!source?.pinId) return null;
    return { ...source };
  }

  const CAPTURE_STATES = Object.freeze({
    SAVING_PINTEREST: "saving-on-pinterest",
    SAVING_LOCAL: "saving-to-pinref",
    UNCONFIRMED: "save-not-confirmed",
    PINTEREST_FAILED: "pinterest-save-failed",
    CANCELLED: "pinterest-save-cancelled",
    LOCAL_FAILED: "local-write-failed",
    COMMITTED: "committed",
    DUPLICATE: "duplicate"
  });

  const IMPORT_STATES = Object.freeze({
    READY: "ready",
    SCANNING: "scanning",
    PAUSED: "paused",
    READY_TO_IMPORT: "ready-to-import",
    IMPORTING: "importing",
    INCOMPLETE: "import-incomplete",
    COMPLETE: "import-complete",
    DISMISSED: "dismissed"
  });

  function importTrace(session, event, detail = null, at = null) {
    return {
      at: at || new Date().toISOString(),
      event,
      state: session.status,
      detail
    };
  }

  function createImportSession({ sessionId, tabId, surfaceKey, surfaceKind, surfaceUrl, at } = {}) {
    if (!sessionId || !Number.isInteger(tabId) || !surfaceKey || !["saved-root", "board"].includes(surfaceKind)) return null;
    const session = {
      sessionId,
      originTabId: tabId,
      surfaceKey,
      surfaceKind,
      surfaceUrl: surfaceUrl || null,
      status: IMPORT_STATES.READY,
      stopReason: null,
      completionEvidence: null,
      candidates: {},
      skippedIdentity: 0,
      skippedMembership: 0,
      results: { imported: 0, duplicate: 0, inTrash: 0, failed: 0 },
      createdAt: at || new Date().toISOString(),
      updatedAt: at || new Date().toISOString(),
      trace: []
    };
    session.trace.push(importTrace(session, "SESSION_CREATED", surfaceKey, at));
    return session;
  }

  function mergeImportCandidates(existing = {}, observations = []) {
    const merged = { ...existing };
    for (const observation of observations) {
      const pinId = String(observation?.pinId || "");
      if (!/^\d{6,}$/.test(pinId)) continue;
      const previous = merged[pinId] || {};
      const scopeHistory = [...(previous.scopeHistory || [])];
      if (observation.scopeKey) {
        const scope = {
          scopeKey: observation.scopeKey,
          scopeHeading: observation.scopeHeading || null,
          scopeBoundaryKind: observation.scopeBoundaryKind || "unknown"
        };
        if (!scopeHistory.some((entry) => entry.scopeKey === scope.scopeKey && entry.scopeHeading === scope.scopeHeading)) scopeHistory.push(scope);
      }
      merged[pinId] = {
        ...previous,
        ...observation,
        pinId,
        scopeHistory,
        observationCount: Number(previous.observationCount || 0) + 1,
        firstObservedAt: previous.firstObservedAt || observation.observedAt || new Date().toISOString(),
        lastObservedAt: observation.observedAt || new Date().toISOString()
      };
    }
    return merged;
  }

  function transitionImportSession(current, action = {}) {
    if (!current) return null;
    const session = {
      ...current,
      skippedMembership: Math.max(0, Number(current.skippedMembership || 0)),
      candidates: { ...(current.candidates || {}) },
      results: { imported: 0, duplicate: 0, inTrash: 0, failed: 0, ...(current.results || {}) },
      trace: [...(current.trace || [])]
    };
    const at = action.at || new Date().toISOString();
    const terminal = [IMPORT_STATES.COMPLETE, IMPORT_STATES.DISMISSED].includes(session.status);
    if (terminal) return session;
    if (Number.isInteger(action.tabId) && action.tabId !== session.originTabId) {
      session.trace.push(importTrace(session, `IGNORED_TAB_MISMATCH:${action.type || "UNKNOWN"}`, action.tabId, at));
      return session;
    }
    if (action.surfaceKey && action.surfaceKey !== session.surfaceKey) {
      session.trace.push(importTrace(session, `INTERRUPTED_SURFACE_MISMATCH:${action.type || "UNKNOWN"}`, action.surfaceKey, at));
      session.status = IMPORT_STATES.PAUSED;
      session.stopReason = "navigation";
      session.updatedAt = at;
      return session;
    }
    switch (action.type) {
      case "START_SCAN":
      case "RESUME_FROM_TOP":
        if (![IMPORT_STATES.READY, IMPORT_STATES.PAUSED, IMPORT_STATES.READY_TO_IMPORT].includes(session.status)) return session;
        session.status = IMPORT_STATES.SCANNING;
        session.stopReason = null;
        session.completionEvidence = null;
        break;
      case "OBSERVE_BATCH":
        if (session.status !== IMPORT_STATES.SCANNING) return session;
        session.candidates = mergeImportCandidates(session.candidates, action.observations || []);
        session.skippedIdentity += Math.max(0, Number(action.skippedIdentity || 0));
        session.skippedMembership += Math.max(0, Number(action.skippedMembership || 0));
        break;
      case "END_RELIABLE":
        if (session.status !== IMPORT_STATES.SCANNING) return session;
        session.status = IMPORT_STATES.READY_TO_IMPORT;
        session.completionEvidence = { kind: action.evidence || "explicit-end-marker", confidence: "reliable" };
        break;
      case "END_UNCONFIRMED":
        if (session.status !== IMPORT_STATES.SCANNING) return session;
        session.status = IMPORT_STATES.PAUSED;
        session.stopReason = "unable-to-confirm-completion";
        session.completionEvidence = { kind: action.evidence || "heuristic-plateau", confidence: "heuristic-only" };
        break;
      case "INTERRUPT":
      case "SCAN_FAILED":
        if (session.status !== IMPORT_STATES.SCANNING) return session;
        session.status = IMPORT_STATES.PAUSED;
        session.stopReason = action.reason || (action.type === "SCAN_FAILED" ? "scan-failed" : "interrupted");
        break;
      case "BEGIN_IMPORT":
        if (![IMPORT_STATES.READY_TO_IMPORT, IMPORT_STATES.PAUSED].includes(session.status)) return session;
        session.status = IMPORT_STATES.IMPORTING;
        break;
      case "COMMIT_RESULT": {
        if (session.status !== IMPORT_STATES.IMPORTING || !session.candidates[action.pinId]) return session;
        const result = action.result;
        if (!["imported", "duplicate", "in-trash", "failed"].includes(result)) return session;
        session.candidates[action.pinId] = { ...session.candidates[action.pinId], result };
        const resultKey = result === "in-trash" ? "inTrash" : result;
        session.results[resultKey] += 1;
        session.status = Object.values(session.candidates).some((candidate) => candidate.result === "failed")
          ? IMPORT_STATES.INCOMPLETE
          : IMPORT_STATES.IMPORTING;
        break;
      }
      case "RETRY_LOCAL":
        if (session.status !== IMPORT_STATES.INCOMPLETE || session.candidates[action.pinId]?.result !== "failed") return session;
        session.candidates[action.pinId] = { ...session.candidates[action.pinId], result: null };
        session.results.failed = Math.max(0, session.results.failed - 1);
        session.status = IMPORT_STATES.IMPORTING;
        break;
      case "DONE":
        if (![IMPORT_STATES.IMPORTING, IMPORT_STATES.INCOMPLETE].includes(session.status) || session.results.failed > 0) return session;
        session.status = IMPORT_STATES.COMPLETE;
        break;
      case "DISMISS":
        session.status = IMPORT_STATES.DISMISSED;
        break;
      default:
        return session;
    }
    session.updatedAt = at;
    session.trace.push(importTrace(session, action.type, action.reason || action.evidence || action.pinId || null, at));
    return session;
  }

  function captureEvent(attempt, event, at) {
    return {
      at: at || new Date().toISOString(),
      event,
      state: attempt.captureState,
      evidence: attempt.evidence?.kind || null,
      confidence: attempt.evidence?.confidence || null
    };
  }

  function createCaptureAttempt({ attemptId, operationId, tabId, pinId, surface, observedUrl, previewUrl, at } = {}) {
    if (!attemptId || !operationId || !Number.isInteger(tabId) || !pinId) return null;
    const attempt = {
      attemptId,
      operationId,
      originTabId: tabId,
      pinId: String(pinId),
      surface: surface || "unknown",
      observedUrl: observedUrl || null,
      previewUrl: previewUrl || null,
      captureState: CAPTURE_STATES.SAVING_PINTEREST,
      diagnosticOutcome: "pending",
      evidence: { kind: "native-save-click", confidence: "conditionally-reliable" },
      createdAt: at || new Date().toISOString(),
      updatedAt: at || new Date().toISOString(),
      trace: []
    };
    attempt.trace.push(captureEvent(attempt, "CAPTURE_STARTED", at));
    return attempt;
  }

  function transitionCaptureAttempt(current, action = {}) {
    if (!current) return null;
    const attempt = {
      ...current,
      evidence: current.evidence ? { ...current.evidence } : null,
      trace: [...(current.trace || [])]
    };
    const at = action.at || new Date().toISOString();
    const terminal = [CAPTURE_STATES.COMMITTED, CAPTURE_STATES.DUPLICATE].includes(attempt.captureState);
    if (terminal && action.type !== "RECONCILE") return attempt;
    if (action.pinId && String(action.pinId) !== attempt.pinId) {
      attempt.trace.push(captureEvent(attempt, `IGNORED_PIN_MISMATCH:${action.type || "UNKNOWN"}`, at));
      return attempt;
    }
    if (Number.isInteger(action.tabId) && action.tabId !== attempt.originTabId) {
      attempt.trace.push(captureEvent(attempt, `IGNORED_TAB_MISMATCH:${action.type || "UNKNOWN"}`, at));
      return attempt;
    }
    const evidence = action.evidence ? { ...action.evidence } : attempt.evidence;
    switch (action.type) {
      case "PINTEREST_CONFIRMED":
        attempt.captureState = CAPTURE_STATES.SAVING_LOCAL;
        attempt.diagnosticOutcome = "success";
        attempt.evidence = evidence;
        break;
      case "PINTEREST_FAILED":
        attempt.captureState = CAPTURE_STATES.PINTEREST_FAILED;
        attempt.diagnosticOutcome = "failure";
        attempt.evidence = evidence;
        break;
      case "PINTEREST_CANCELLED":
        attempt.captureState = CAPTURE_STATES.CANCELLED;
        attempt.diagnosticOutcome = "cancelled";
        attempt.evidence = evidence;
        break;
      case "EVIDENCE_LOST":
      case "TIMEOUT":
        attempt.captureState = CAPTURE_STATES.UNCONFIRMED;
        attempt.diagnosticOutcome = "unconfirmed";
        attempt.evidence = evidence;
        break;
      case "LOCAL_COMMIT_FAILED":
        if (attempt.diagnosticOutcome !== "success") return attempt;
        attempt.captureState = CAPTURE_STATES.LOCAL_FAILED;
        attempt.evidence = evidence;
        break;
      case "LOCAL_COMMIT_SUCCEEDED":
        if (attempt.diagnosticOutcome !== "success") return attempt;
        attempt.captureState = action.duplicate ? CAPTURE_STATES.DUPLICATE : CAPTURE_STATES.COMMITTED;
        attempt.evidence = evidence;
        break;
      case "RETRY_LOCAL":
        if (attempt.captureState !== CAPTURE_STATES.LOCAL_FAILED) return attempt;
        attempt.captureState = CAPTURE_STATES.SAVING_LOCAL;
        break;
      case "CHECK_AGAIN":
        if (![CAPTURE_STATES.UNCONFIRMED, CAPTURE_STATES.PINTEREST_FAILED, CAPTURE_STATES.CANCELLED].includes(attempt.captureState)) return attempt;
        attempt.captureState = CAPTURE_STATES.SAVING_PINTEREST;
        attempt.diagnosticOutcome = "pending";
        break;
      default:
        return attempt;
    }
    attempt.updatedAt = at;
    attempt.trace.push(captureEvent(attempt, action.type, at));
    return attempt;
  }

  function chooseDetailPreview({ pinId, detailPreviews = [], linkedPreviews = [], metadataPinId = null, metadataPreview = null }) {
    if (!pinId) return null;
    const detailPreview = detailPreviews.find(Boolean);
    if (detailPreview) return detailPreview;
    const linkedPreview = linkedPreviews.find(Boolean);
    if (linkedPreview) return linkedPreview;
    return metadataPinId === pinId ? metadataPreview || null : null;
  }

  function chooseDetailPinId({ routePinId = null, canonicalPinId = null, openGraphPinId = null }) {
    if (routePinId) return routePinId;
    if (canonicalPinId && canonicalPinId === openGraphPinId) return canonicalPinId;
    return canonicalPinId || openGraphPinId || null;
  }

  globalThis.PinRefCore = Object.freeze({
    parsePinId,
    isPinterestUrl,
    importSurfaceForUrl,
    panelOptionsForTab,
    chooseSafePreviewUrl,
    chooseLargestVisiblePreview,
    isPinterestBoardSelectorLabel,
    isPinterestUnsavedSaveLabel,
    isPinterestSavedLabel,
    findPinterestSaveControlIndex,
    resolvePinterestSaveCommit,
    CAPTURE_STATES,
    IMPORT_STATES,
    createCaptureAttempt,
    transitionCaptureAttempt,
    createImportSession,
    mergeImportCandidates,
    transitionImportSession,
    chooseDetailPinId,
    chooseDetailPreview
  });
})();
