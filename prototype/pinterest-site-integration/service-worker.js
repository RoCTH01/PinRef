importScripts("pinref-core.js", "pinref-store.js");

const tabStates = new Map();
const contentScriptBootstraps = new Map();
let lastPinterestTabId = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function configureSidePanelForTab(tabId, url) {
  if (!Number.isInteger(tabId)) return false;
  const options = PinRefCore.panelOptionsForTab(tabId, url);
  await chrome.sidePanel.setOptions(options);
  if (!options.enabled) {
    tabStates.delete(tabId);
    if (lastPinterestTabId === tabId) lastPinterestTabId = null;
  }
  return options.enabled;
}

async function ensureContentScript(tabId) {
  if (!Number.isInteger(tabId)) return false;
  if (contentScriptBootstraps.has(tabId)) return contentScriptBootstraps.get(tabId);
  const bootstrap = (async () => {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "pinref:ping" });
      if (response?.ok && response.version === chrome.runtime.getManifest().version) return true;
    } catch {}
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.removeAttribute("data-pinref-native-sidepanel-prototype")
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["pinref-core.js", "content.js"]
      });
      return true;
    } catch {
      return false;
    }
  })();
  contentScriptBootstraps.set(tabId, bootstrap);
  try {
    return await bootstrap;
  } finally {
    contentScriptBootstraps.delete(tabId);
  }
}

async function configureAndEnsurePinterestTab(tab) {
  const enabled = await configureSidePanelForTab(tab?.id, tab?.url);
  if (!enabled) return false;
  if (tab.active) lastPinterestTabId = tab.id;
  await ensureContentScript(tab.id);
  return true;
}

async function configureExistingTabs() {
  const tabs = await chrome.tabs.query({});
  const activePinterestTab = tabs.find((tab) => tab.active && PinRefCore.isPinterestUrl(tab.url));
  if (activePinterestTab) lastPinterestTabId = activePinterestTab.id;
  await Promise.all(tabs.map((tab) => configureAndEnsurePinterestTab(tab).catch(() => false)));
}

async function reconcileInterruptedAttempts() {
  const library = await PinRefStore.readLibrary();
  for (const attempt of Object.values(library.attempts)) {
    if (![PinRefCore.CAPTURE_STATES.SAVING_PINTEREST, PinRefCore.CAPTURE_STATES.SAVING_LOCAL].includes(attempt.captureState)) continue;
    const next = PinRefCore.transitionCaptureAttempt(attempt, {
      type: attempt.captureState === PinRefCore.CAPTURE_STATES.SAVING_LOCAL ? "LOCAL_COMMIT_FAILED" : "EVIDENCE_LOST",
      pinId: attempt.pinId,
      tabId: attempt.originTabId,
      evidence: { kind: "service-worker-restart", confidence: "reliable" }
    });
    await PinRefStore.saveAttempt(next);
  }
  for (const session of Object.values(library.importSessions || {})) {
    if (session.status !== PinRefCore.IMPORT_STATES.SCANNING) continue;
    const next = PinRefCore.transitionImportSession(session, {
      type: "INTERRUPT",
      tabId: session.originTabId,
      reason: "service-worker-restart"
    });
    await PinRefStore.saveImportSession(next);
  }
}

reconcileInterruptedAttempts().then(configureExistingTabs).catch(() => {});

function isDashboardUrl(url) {
  return String(url || "").startsWith(chrome.runtime.getURL("dashboard.html"));
}

async function closeSidePanelForWindow(windowId) {
  if (!Number.isInteger(windowId) || typeof chrome.sidePanel.close !== "function") return false;
  try {
    await chrome.sidePanel.close({ windowId });
    return true;
  } catch {
    return false;
  }
}

async function closeSidePanelForTab(tabId) {
  if (!Number.isInteger(tabId)) return false;
  if (typeof chrome.sidePanel.close === "function") {
    try {
      await chrome.sidePanel.close({ tabId });
      return true;
    } catch {}
  }
  try {
    const current = await chrome.sidePanel.getOptions({ tabId });
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    setTimeout(() => {
      chrome.sidePanel.setOptions({
        tabId,
        path: current.path || "sidepanel.html",
        enabled: true
      }).catch(() => {});
    }, 250);
    return true;
  } catch {
    return false;
  }
}

function emptyState(records = {}) {
  return {
    activePinId: null,
    records,
    attempts: {},
    observations: {},
    debug: { lastEvent: "service worker restored persistent library" }
  };
}

async function publishToPanel(tabId) {
  if (!Number.isInteger(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !PinRefCore.isPinterestUrl(tab.url)) return;
  lastPinterestTabId = tabId;
  chrome.runtime.sendMessage({ type: "pinref:panelState", tabId, state: tabStates.get(tabId) || emptyState() }).catch(() => {});
}

async function syncStoredRecords() {
  const { records, attempts } = await PinRefStore.readLibrary();
  for (const [tabId, current] of tabStates) {
    const next = { ...current, records, attempts };
    tabStates.set(tabId, next);
    chrome.tabs.sendMessage(tabId, { type: "pinref:applyState", state: next }).catch(() => {});
    publishToPanel(tabId);
  }
  return records;
}

async function refreshAllSurfaces() {
  const library = await PinRefStore.readLibrary();
  for (const [tabId, current] of tabStates) {
    const next = { ...current, records: library.records, attempts: library.attempts };
    tabStates.set(tabId, next);
    chrome.tabs.sendMessage(tabId, { type: "pinref:applyState", state: next }).catch(() => {});
    publishToPanel(tabId).catch(() => {});
  }
  return library;
}

function importSurfaceForUrl(rawUrl) {
  return PinRefCore.importSurfaceForUrl(rawUrl);
}

async function permissionState() {
  const hostGranted = await chrome.permissions.contains({ origins: ["https://*.pinterest.com/*"] });
  return { hostGranted, mode: hostGranted ? "optional-host" : "activeTab-only" };
}

async function listImportTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://*.pinterest.com/*"] });
  const permission = await permissionState();
  return {
    permission,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || "Pinterest",
      url: tab.url,
      active: Boolean(tab.active),
      windowId: tab.windowId,
      surface: importSurfaceForUrl(tab.url)
    }))
  };
}

async function activeImportSession() {
  const library = await PinRefStore.readLibrary();
  return Object.values(library.importSessions || {}).find((session) => session.status === PinRefCore.IMPORT_STATES.SCANNING) || null;
}

async function interruptImportSession(session, reason, detail = null) {
  if (!session || session.status !== PinRefCore.IMPORT_STATES.SCANNING) return session;
  chrome.tabs.sendMessage(session.originTabId, { type: "pinref:stopImportScan", sessionId: session.sessionId, reason }).catch(() => {});
  const next = PinRefCore.transitionImportSession(session, { type: "INTERRUPT", tabId: session.originTabId, reason, detail });
  await PinRefStore.saveImportSession(next);
  return next;
}

async function startImportScan({ tabId, sessionId = null, resume = false } = {}) {
  if (!Number.isInteger(tabId)) return { ok: false, reason: "invalid-tab" };
  const running = await activeImportSession();
  if (running && running.sessionId !== sessionId) return { ok: false, reason: "another-scan-active", session: running };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const surface = importSurfaceForUrl(tab?.url);
  if (!tab || !surface) return { ok: false, reason: "unsupported-surface" };
  await chrome.tabs.update(tabId, { active: true });
  const connected = await ensureContentScript(tabId);
  if (!connected) return { ok: false, reason: "permission-required", permission: await permissionState() };
  const library = await PinRefStore.readLibrary();
  let session = sessionId ? library.importSessions?.[sessionId] : null;
  if (session && (session.originTabId !== tabId || session.surfaceKey !== surface.surfaceKey)) {
    return { ok: false, reason: "binding-mismatch", session };
  }
  if (!session) {
    session = PinRefCore.createImportSession({
      sessionId: crypto.randomUUID(),
      tabId,
      ...surface
    });
  }
  session = PinRefCore.transitionImportSession(session, {
    type: resume ? "RESUME_FROM_TOP" : "START_SCAN",
    tabId,
    surfaceKey: surface.surfaceKey
  });
  await PinRefStore.saveImportSession(session);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "pinref:startImportScan",
    sessionId: session.sessionId,
    surface
  }).catch(() => null);
  if (!response?.ok) {
    session = await interruptImportSession(session, response?.reason || "content-script-unavailable");
    return { ok: false, reason: response?.reason || "content-script-unavailable", session };
  }
  return { ok: true, session, permission: await permissionState() };
}

async function applyImportEvent(message, senderTabId) {
  const library = await PinRefStore.readLibrary();
  const current = library.importSessions?.[message.sessionId];
  if (!current) return { ok: false, reason: "session-not-found" };
  const action = {
    type: message.eventType,
    tabId: senderTabId,
    surfaceKey: message.surfaceKey,
    observations: message.observations,
    skippedIdentity: message.skippedIdentity,
    skippedMembership: message.skippedMembership,
    evidence: message.evidence,
    reason: message.reason
  };
  const next = PinRefCore.transitionImportSession(current, action);
  await PinRefStore.saveImportSession(next);
  return { ok: true, session: next };
}

function recordForAttempt(attempt) {
  return {
    pinId: attempt.pinId,
    url: `https://www.pinterest.com/pin/${attempt.pinId}/`,
    observedUrl: attempt.observedUrl,
    previewUrl: attempt.previewUrl,
    note: "",
    tags: [],
    savedAt: new Date().toISOString()
  };
}

async function applyCaptureEvent(attemptId, eventType, { pinId, tabId, evidence, simulateLocalFailure = false } = {}) {
  const library = await PinRefStore.readLibrary();
  const current = library.attempts[attemptId];
  if (!current) return { ok: false, reason: "attempt-not-found" };
  let next = PinRefCore.transitionCaptureAttempt(current, { type: eventType, pinId, tabId, evidence });
  await PinRefStore.saveAttempt(next);
  if (eventType === "PINTEREST_CONFIRMED") {
    const result = await PinRefStore.commitAttempt(attemptId, recordForAttempt(next), { simulateFailure: simulateLocalFailure });
    next = PinRefCore.transitionCaptureAttempt(next, {
      type: result.ok ? "LOCAL_COMMIT_SUCCEEDED" : "LOCAL_COMMIT_FAILED",
      pinId: next.pinId,
      tabId: next.originTabId,
      duplicate: result.duplicate,
      evidence: result.ok
        ? { kind: result.duplicate ? "existing-reference" : "chrome-storage-commit", confidence: "reliable" }
        : { kind: result.reason, confidence: "reliable" }
    });
    if (!result.ok) await PinRefStore.saveAttempt(next);
  }
  await refreshAllSurfaces();
  return { ok: true, attempt: next };
}

async function reloadMetadata(pinIds, preferredTabId = null) {
  const pinterestTabs = await chrome.tabs.query({ url: ["https://*.pinterest.com/*"] });
  const orderedTabs = [...pinterestTabs].sort((a, b) => {
    if (a.id === preferredTabId) return -1;
    if (b.id === preferredTabId) return 1;
    if (tabStates.get(a.id)?.activePinId && pinIds.includes(tabStates.get(a.id).activePinId)) return -1;
    if (tabStates.get(b.id)?.activePinId && pinIds.includes(tabStates.get(b.id).activePinId)) return 1;
    return Number(b.active) - Number(a.active);
  });
  const results = [];
  for (const pinId of pinIds) {
    let match = null;
    let failureReason = "content-script-unavailable";
    for (const tab of orderedTabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "pinref:refreshMetadata", pinId });
        if (response?.reason) failureReason = response.reason;
        if (response?.ok) { match = { ...response, tabId: tab.id }; break; }
      } catch {}
    }
    if (match?.observation) {
      const patch = {};
      if (match.observation.previewUrl) patch.previewUrl = match.observation.previewUrl;
      if (match.observation.observedUrl) patch.observedUrl = match.observation.observedUrl;
      if (Object.keys(patch).length) await PinRefStore.updateRecord(pinId, patch);
    }
    results.push({ pinId, ok: Boolean(match), reason: match ? null : failureReason, refreshed: match?.refreshed || { preview: false } });
  }
  await syncStoredRecords();
  const updated = results.filter((result) => result.ok);
  return {
    ok: updated.length > 0,
    results,
    message: updated.length
      ? `Reloaded ${updated.length} of ${results.length} Pin${results.length === 1 ? "" : "s"}.`
      : results.some((result) => result.reason === "metadata-not-found")
          ? "Pin detected, but its preview was not recognized."
        : results.some((result) => result.reason === "pin-not-visible")
          ? "Open this exact Pin on Pinterest, then try Reload again."
          : "Reload the Pinterest page so the current PinRef content script can connect."
  };
}

async function handleMessage(message, sender) {
  const senderTabId = sender.tab?.id;

  if (message?.type === "pinref:hello" && senderTabId) {
    if (sender.tab?.active) lastPinterestTabId = senderTabId;
    await configureSidePanelForTab(senderTabId, sender.tab?.url);
    const { records, attempts } = await PinRefStore.readLibrary();
    const current = tabStates.get(senderTabId) || emptyState(records);
    const next = { ...current, records, attempts };
    tabStates.set(senderTabId, next);
    return { state: next };
  }

  if (message?.type === "pinref:contentState" && senderTabId) {
    if (sender.tab?.active) lastPinterestTabId = senderTabId;
    const { records, attempts } = await PinRefStore.readLibrary();
    const next = { ...message.state, records, attempts };
    tabStates.set(senderTabId, next);
    chrome.tabs.sendMessage(senderTabId, { type: "pinref:applyState", state: next }).catch(() => {});
    publishToPanel(senderTabId);
    if (message.openPanel) await chrome.sidePanel.open({ tabId: senderTabId }).catch(() => {});
    return { ok: true, state: next };
  }

  if (message?.type === "pinref:captureStarted" && senderTabId) {
    const attempt = PinRefCore.createCaptureAttempt({ ...message, tabId: senderTabId });
    if (!attempt) return { ok: false, reason: "invalid-attempt" };
    await PinRefStore.saveAttempt(attempt);
    await refreshAllSurfaces();
    return { ok: true, attempt };
  }

  if (message?.type === "pinref:captureEvidence" && senderTabId) {
    return applyCaptureEvent(message.attemptId, message.eventType, {
      pinId: message.pinId,
      tabId: senderTabId,
      evidence: message.evidence
    });
  }

  if (message?.type === "pinref:simulateCapture") {
    const attemptId = message.attemptId;
    return applyCaptureEvent(attemptId, message.eventType, {
      pinId: message.pinId,
      tabId: message.originTabId,
      evidence: { kind: `prototype-control:${message.eventType}`, confidence: "reliable" },
      simulateLocalFailure: Boolean(message.simulateLocalFailure)
    });
  }

  if (message?.type === "pinref:retryLocalCapture") {
    const library = await PinRefStore.readLibrary();
    const current = library.attempts[message.attemptId];
    if (!current) return { ok: false, reason: "attempt-not-found" };
    const retrying = PinRefCore.transitionCaptureAttempt(current, { type: "RETRY_LOCAL", pinId: current.pinId, tabId: current.originTabId });
    await PinRefStore.saveAttempt(retrying);
    const result = await PinRefStore.commitAttempt(current.attemptId, recordForAttempt(current));
    if (!result.ok) return applyCaptureEvent(current.attemptId, "LOCAL_COMMIT_FAILED", { pinId: current.pinId, tabId: current.originTabId });
    await refreshAllSurfaces();
    return { ok: true, duplicate: result.duplicate };
  }

  if (message?.type === "pinref:checkCapture") {
    const library = await PinRefStore.readLibrary();
    const current = library.attempts[message.attemptId];
    if (!current) return { ok: false, reason: "attempt-not-found" };
    const tab = await chrome.tabs.get(current.originTabId).catch(() => null);
    if (!tab) return { ok: false, reason: "origin-tab-closed" };
    const probe = await chrome.tabs.sendMessage(current.originTabId, { type: "pinref:probeCapture", pinId: current.pinId }).catch(() => null);
    if (!probe?.ok) return { ok: false, reason: "no-reliable-confirmation" };
    return applyCaptureEvent(current.attemptId, "PINTEREST_CONFIRMED", {
      pinId: current.pinId,
      tabId: current.originTabId,
      evidence: probe.evidence
    });
  }

  if (message?.type === "pinref:getPanelState") {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = activeTab && PinRefCore.isPinterestUrl(activeTab.url) ? activeTab.id : null;
    if (tabId) {
      lastPinterestTabId = tabId;
      await configureAndEnsurePinterestTab(activeTab);
    }
    const library = await refreshAllSurfaces();
    return { tabId, state: tabId ? tabStates.get(tabId) || { ...emptyState(library.records), attempts: library.attempts } : { ...emptyState(library.records), attempts: library.attempts } };
  }

  if (message?.type === "pinref:updateRecord") {
    const tabId = message.tabId || lastPinterestTabId;
    const current = tabId ? tabStates.get(tabId) : null;
    const pinId = message.pinId || current?.activePinId;
    if (!pinId) return { ok: false };
    await PinRefStore.updateRecord(pinId, { [message.field]: message.value });
    await syncStoredRecords();
    return { ok: true };
  }

  if (message?.type === "pinref:closePanel") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    let windowId = Number.isInteger(message.windowId) ? message.windowId : sender.tab?.windowId;
    if (!Number.isInteger(windowId)) windowId = (await chrome.windows.getLastFocused()).id;
    const panelClosed = await closeSidePanelForTab(tabId) || await closeSidePanelForWindow(windowId);
    return { ok: panelClosed };
  }

  if (message?.type === "pinref:openDashboard") {
    const dashboardTab = await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    const panelClosed = await closeSidePanelForWindow(dashboardTab.windowId);
    return { ok: true, panelClosed };
  }

  if (message?.type === "pinref:dashboardReady") {
    const panelClosed = await closeSidePanelForWindow(sender.tab?.windowId);
    return { ok: true, panelClosed };
  }

  if (message?.type === "pinref:listImportTabs") return listImportTabs();

  if (message?.type === "pinref:startImport") return startImportScan({ tabId: Number(message.tabId) });

  if (message?.type === "pinref:resumeImport") {
    const library = await PinRefStore.readLibrary();
    const session = library.importSessions?.[message.sessionId];
    if (!session) return { ok: false, reason: "session-not-found" };
    return startImportScan({ tabId: session.originTabId, sessionId: session.sessionId, resume: true });
  }

  if (message?.type === "pinref:cancelImport") {
    const library = await PinRefStore.readLibrary();
    const session = library.importSessions?.[message.sessionId];
    if (!session) return { ok: false, reason: "session-not-found" };
    return { ok: true, session: await interruptImportSession(session, "cancelled-by-user") };
  }

  if (message?.type === "pinref:importEvent" && senderTabId) return applyImportEvent(message, senderTabId);

  if (message?.type === "pinref:getImportSessions") {
    const library = await PinRefStore.readLibrary();
    return { ok: true, sessions: library.importSessions || {}, permission: await permissionState() };
  }

  if (message?.type === "pinref:simulateImportAction") {
    const library = await PinRefStore.readLibrary();
    const session = library.importSessions?.[message.sessionId];
    if (!session) return { ok: false, reason: "session-not-found" };
    const next = PinRefCore.transitionImportSession(session, {
      type: message.actionType,
      pinId: message.pinId,
      result: message.result,
      evidence: "prototype-control"
    });
    await PinRefStore.saveImportSession(next);
    return { ok: true, session: next, evidenceClass: "simulated-only" };
  }

  if (message?.type === "pinref:reloadMetadata") {
    const requested = Array.isArray(message.pinIds) ? message.pinIds : [message.pinId];
    const pinIds = [...new Set(requested.map((pinId) => String(pinId || "")).filter(Boolean))];
    if (!pinIds.length) return { ok: false, results: [], message: "Select a Pin before reloading metadata." };
    return reloadMetadata(pinIds, message.tabId || lastPinterestTabId);
  }

  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[PinRefStore.STORAGE_KEY]) syncStoredRecords().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  if (lastPinterestTabId === tabId) lastPinterestTabId = null;
  PinRefStore.readLibrary().then(async (library) => {
    for (const attempt of Object.values(library.attempts)) {
      if (attempt.originTabId !== tabId || attempt.captureState !== PinRefCore.CAPTURE_STATES.SAVING_PINTEREST) continue;
      const next = PinRefCore.transitionCaptureAttempt(attempt, {
        type: "EVIDENCE_LOST",
        pinId: attempt.pinId,
        tabId,
        evidence: { kind: "origin-tab-closed", confidence: "reliable" }
      });
      await PinRefStore.saveAttempt(next);
    }
    for (const session of Object.values(library.importSessions || {})) {
      if (session.originTabId === tabId) await interruptImportSession(session, "tab-closed");
    }
    await refreshAllSurfaces();
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  configureAndEnsurePinterestTab({ ...tab, id: tabId, url: changeInfo.url || tab.url }).catch(() => {});
  if (isDashboardUrl(changeInfo.url || tab.url)) closeSidePanelForWindow(tab.windowId).catch(() => {});
  if (changeInfo.url) {
    PinRefStore.readLibrary().then(async (library) => {
      for (const session of Object.values(library.importSessions || {})) {
        if (session.originTabId !== tabId || session.status !== PinRefCore.IMPORT_STATES.SCANNING) continue;
        const nextSurface = importSurfaceForUrl(changeInfo.url);
        if (!nextSurface || nextSurface.surfaceKey !== session.surfaceKey) await interruptImportSession(session, "navigation");
      }
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId)
    .then(async (tab) => {
      await configureAndEnsurePinterestTab(tab);
      if (PinRefCore.isPinterestUrl(tab.url)) {
        lastPinterestTabId = tabId;
        publishToPanel(tabId).catch(() => {});
      }
      if (isDashboardUrl(tab.url)) await closeSidePanelForWindow(tab.windowId);
    })
    .catch(() => {});
  activeImportSession().then((session) => {
    if (session && session.originTabId !== tabId) return interruptImportSession(session, "tab-switch");
  }).catch(() => {});
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (!(permissions.origins || []).some((origin) => origin.includes("pinterest.com"))) return;
  activeImportSession().then((session) => interruptImportSession(session, "permission-revoked")).catch(() => {});
});
