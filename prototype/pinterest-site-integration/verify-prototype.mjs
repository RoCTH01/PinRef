import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./pinref-core.js", import.meta.url), "utf8");
const context = vm.createContext({ URL, globalThis: {} });
vm.runInContext(source, context);

const {
  parsePinId,
  chooseDetailPinId,
  chooseDetailPreview,
  chooseSafePreviewUrl,
  chooseLargestVisiblePreview,
  isPinterestBoardSelectorLabel,
  isPinterestUnsavedSaveLabel,
  findPinterestSaveControlIndex,
  isPinterestSavedLabel,
  resolvePinterestSaveCommit,
  createCaptureAttempt,
  transitionCaptureAttempt,
  createImportSession,
  transitionImportSession,
  isPinterestUrl,
  importSurfaceForUrl,
  panelOptionsForTab
} = context.globalThis.PinRefCore;

const importSession = createImportSession({
  sessionId: "import-a",
  tabId: 81,
  surfaceKey: "https://www.pinterest.com/example/board/",
  surfaceKind: "board",
  surfaceUrl: "https://www.pinterest.com/example/board/",
  at: "2026-09-29T01:00:00.000Z"
});
const scanningImport = transitionImportSession(importSession, { type: "START_SCAN", tabId: 81, surfaceKey: importSession.surfaceKey });
const observedImport = transitionImportSession(scanningImport, {
  type: "OBSERVE_BATCH",
  tabId: 81,
  surfaceKey: importSession.surfaceKey,
  observations: [{ pinId: "111111111111", previewUrl: "https://i.pinimg.com/a.jpg" }, { pinId: "222222222222" }]
});
const rescannedImport = transitionImportSession(observedImport, {
  type: "OBSERVE_BATCH",
  tabId: 81,
  surfaceKey: importSession.surfaceKey,
  observations: [{ pinId: "111111111111", previewUrl: "https://i.pinimg.com/a-better.jpg" }]
});
assert.equal(Object.keys(rescannedImport.candidates).length, 2, "resume-from-top observations merge by Pin identity without duplicate candidates");
assert.equal(rescannedImport.candidates["111111111111"].observationCount, 2, "repeated observations remain visible in the traceable candidate state");
const crossTabImport = transitionImportSession(scanningImport, { type: "OBSERVE_BATCH", tabId: 82, observations: [{ pinId: "333333333333" }] });
assert.equal(Object.keys(crossTabImport.candidates).length, 0, "a different tab cannot add Import candidates");
assert.match(crossTabImport.trace.at(-1).event, /IGNORED_TAB_MISMATCH/, "cross-tab Import rejection stays in the transition trace");
const navigatedImport = transitionImportSession(scanningImport, { type: "OBSERVE_BATCH", tabId: 81, surfaceKey: "https://www.pinterest.com/example/other/" });
assert.equal(navigatedImport.status, "paused", "a surface mismatch safely pauses the bound Import Session");
assert.equal(navigatedImport.stopReason, "navigation", "surface mismatch records navigation as the stop reason");
const unconfirmedImport = transitionImportSession(rescannedImport, { type: "END_UNCONFIRMED", tabId: 81, evidence: "heuristic-plateau" });
assert.equal(unconfirmedImport.status, "paused", "a heuristic plateau never claims Complete");
assert.equal(unconfirmedImport.stopReason, "unable-to-confirm-completion", "unconfirmed completion remains explicitly resumable");
const reviewImport = transitionImportSession(unconfirmedImport, { type: "BEGIN_IMPORT" });
const failedImport = transitionImportSession(reviewImport, { type: "COMMIT_RESULT", pinId: "111111111111", result: "failed" });
assert.equal(failedImport.status, "import-incomplete", "a local write failure is distinct from scan failure and completion uncertainty");
const retryImport = transitionImportSession(failedImport, { type: "RETRY_LOCAL", pinId: "111111111111" });
assert.equal(retryImport.status, "importing", "local-write Retry resumes the same Import Session");

for (const reason of ["cancelled-by-user", "tab-switch", "tab-closed", "permission-revoked", "service-worker-restart", "scan-failed"]) {
  const interrupted = transitionImportSession(scanningImport, { type: "INTERRUPT", tabId: 81, reason });
  assert.equal(interrupted.status, "paused", `${reason} must safely pause the Import Session`);
  assert.equal(interrupted.stopReason, reason, `${reason} must remain explicit in the transition trace`);
  assert.equal(interrupted.trace.at(-1).event, "INTERRUPT", `${reason} must append an interrupt transition`);
}
const reliableEndImport = transitionImportSession(rescannedImport, { type: "END_RELIABLE", tabId: 81, evidence: "explicit-end-marker" });
assert.equal(reliableEndImport.status, "ready-to-import", "only reliable end evidence may reach ready-to-import");
const completeImport = transitionImportSession(
  transitionImportSession(
    transitionImportSession(reliableEndImport, { type: "BEGIN_IMPORT" }),
    { type: "COMMIT_RESULT", pinId: "111111111111", result: "imported" }
  ),
  { type: "DONE" }
);
assert.equal(completeImport.status, "import-complete", "Complete remains distinct from partial and failed outcomes");

assert.deepEqual(
  { ...importSurfaceForUrl("https://ca.pinterest.com/roahillust/_pins/") },
  {
    surfaceKind: "saved-root",
    surfaceKey: "https://ca.pinterest.com/roahillust/_pins/",
    surfaceUrl: "https://ca.pinterest.com/roahillust/_pins/"
  },
  "the real Saved Pin tab route must classify as Saved root"
);
assert.equal(importSurfaceForUrl("https://ca.pinterest.com/roahillust/_boards/"), null, "the profile Boards tab is not an import Board");
assert.equal(importSurfaceForUrl("https://ca.pinterest.com/roahillust/_profile/"), null, "the profile route is not an import Board");
assert.equal(importSurfaceForUrl("https://ca.pinterest.com/roahillust/fashion/").surfaceKind, "board", "a concrete user Board remains eligible");

assert.equal(
  chooseSafePreviewUrl([
    "data:image/png;base64,cutout-overlay",
    "https://i.pinimg.com/originals/current-pin.jpg"
  ]),
  "https://i.pinimg.com/originals/current-pin.jpg",
  "an invalid cutout overlay must not hide the valid Pinterest preview behind it"
);
assert.equal(isPinterestUnsavedSaveLabel(["儲存"]), true, "Traditional Chinese Pinterest Save should trigger PinRef");
assert.equal(isPinterestSavedLabel(["已儲存"]), true, "same-control Saved state should be observable without treating it as a new click");
assert.equal(isPinterestUnsavedSaveLabel(["Save"]), true, "English Pinterest Save should trigger PinRef");
assert.equal(isPinterestUnsavedSaveLabel(["已儲存"]), false, "an already-saved Pinterest control must not remove or re-add the PinRef record");
assert.equal(isPinterestUnsavedSaveLabel(["選擇要儲存這個 Pin 的圖版：fashion", "fashion"]), false, "the board selector is not the Pinterest Save action");
assert.equal(isPinterestUnsavedSaveLabel(["Save Pin 123456 to PinRef"]), false, "legacy PinRef overlay controls must not be treated as Pinterest Save");
assert.equal(
  findPinterestSaveControlIndex([
    { isControl: false, disabled: false, labels: [""] },
    { isControl: true, disabled: false, labels: ["儲存"] },
    { isControl: true, disabled: false, labels: ["Pin 圖卡"] }
  ]),
  1,
  "a click on nested Save contents must resolve the native Save control from the full composed path"
);
assert.equal(
  findPinterestSaveControlIndex([
    { isControl: true, disabled: false, labels: ["已儲存"] },
    { isControl: true, disabled: false, labels: ["Pin 圖卡"] }
  ]),
  -1,
  "the composed path must not treat an already-saved Pinterest control as a new save"
);
assert.equal(
  isPinterestBoardSelectorLabel(["選擇要儲存這個 Pin 的圖版：fashion"]),
  true,
  "the board selector should retain the source Pin without retaining its board name"
);
assert.deepEqual(
  { ...resolvePinterestSaveCommit({
    directContext: null,
    pendingContext: { pinId: "543176405081086512" }
  }) },
  { pinId: "543176405081086512" },
  "a portal Save must commit the pending source Pin without retaining Pinterest board mapping"
);

const started = createCaptureAttempt({
  attemptId: "attempt-a",
  operationId: "capture:attempt-a",
  tabId: 41,
  pinId: "888888888888888888",
  surface: "feed",
  at: "2026-09-29T00:00:00.000Z"
});
assert.equal(started.captureState, "saving-on-pinterest", "a Save click creates only a Capture Attempt");
const ignoredBackground = transitionCaptureAttempt(started, {
  type: "PINTEREST_CONFIRMED",
  tabId: 57,
  pinId: started.pinId,
  at: "2026-09-29T00:00:01.000Z"
});
assert.equal(ignoredBackground.captureState, "saving-on-pinterest", "a different tab cannot complete the attempt");
assert.match(ignoredBackground.trace.at(-1).event, /IGNORED_TAB_MISMATCH/, "the rejected cross-tab signal stays visible in the trace");
const ignoredPin = transitionCaptureAttempt(started, {
  type: "PINTEREST_CONFIRMED",
  tabId: 41,
  pinId: "999999999999999999",
  at: "2026-09-29T00:00:01.000Z"
});
assert.equal(ignoredPin.captureState, "saving-on-pinterest", "a different Pin cannot complete the attempt");
const confirmed = transitionCaptureAttempt(started, {
  type: "PINTEREST_CONFIRMED",
  tabId: 41,
  pinId: started.pinId,
  evidence: { kind: "same-control-saved-state", confidence: "conditionally-reliable" },
  at: "2026-09-29T00:00:02.000Z"
});
assert.equal(confirmed.captureState, "saving-to-pinref", "same-tab same-Pin confirmation crosses only into local commit");
const localFailed = transitionCaptureAttempt(confirmed, {
  type: "LOCAL_COMMIT_FAILED",
  tabId: 41,
  pinId: started.pinId,
  evidence: { kind: "simulated-local-write-failure", confidence: "reliable" }
});
assert.equal(localFailed.captureState, "local-write-failed", "local failure remains a retryable attempt, not a Reference");
assert.equal(transitionCaptureAttempt(localFailed, { type: "RETRY_LOCAL" }).captureState, "saving-to-pinref", "Retry never requires a second Pinterest Save");
assert.equal(transitionCaptureAttempt(started, { type: "TIMEOUT" }).captureState, "save-not-confirmed", "lost evidence must not become false success");
assert.equal(
  chooseLargestVisiblePreview([
    { url: "data:image/png;base64,cutout", width: 520, height: 600, visible: true },
    { url: "https://i.pinimg.com/originals/main-pin.jpg", width: 360, height: 588, visible: true },
    { url: "https://i.pinimg.com/236x/related-pin.jpg", width: 220, height: 300, visible: true },
    { url: "https://i.pinimg.com/originals/offscreen.jpg", width: 900, height: 1200, visible: false }
  ]),
  "https://i.pinimg.com/originals/main-pin.jpg",
  "direct Pin reload should choose the largest visible safe Pinterest image, not a cutout or offscreen related image"
);
assert.equal(isPinterestUrl("https://ca.pinterest.com/"), true, "Pinterest home should enable the Side Panel");
assert.equal(isPinterestUrl("https://www.pinterest.com/pin/1098948746608149917/"), true, "Pinterest Pin pages should enable the Side Panel");
assert.equal(isPinterestUrl("https://pinterest.com/search/pins/?q=reference"), true, "all Pinterest internal routes should enable the Side Panel");
assert.equal(isPinterestUrl("https://pinterest.evil.example/pin/123456/"), false, "lookalike hosts must not enable the Side Panel");
assert.equal(isPinterestUrl("https://www.google.com/"), false, "non-Pinterest pages must keep the Side Panel disabled");
assert.deepEqual(
  { ...panelOptionsForTab(42, "https://ca.pinterest.com/pin/1098948746608149917/") },
  { tabId: 42, path: "sidepanel.html", enabled: true },
  "an already-open Pinterest tab should be configured without waiting for a content-script hello"
);
assert.deepEqual(
  { ...panelOptionsForTab(43, "https://www.google.com/") },
  { tabId: 43, enabled: false },
  "Side Panel scoping must always be tab-specific"
);

assert.equal(
  parsePinId("https://ca.pinterest.com/pin/1098948746608149917/?utm_source=test", "https://ca.pinterest.com/"),
  "1098948746608149917",
  "localized Pinterest URLs should resolve to the same Pin ID"
);

assert.equal(
  chooseDetailPinId({
    routePinId: "1098948746608149917",
    canonicalPinId: "999999999999999999",
    openGraphPinId: "999999999999999999"
  }),
  "1098948746608149917",
  "the current SPA route must beat stale canonical and Open Graph metadata"
);

assert.equal(
  chooseDetailPreview({
    pinId: "1098948746608149917",
    linkedPreviews: ["https://i.pinimg.com/current-pin.jpg"],
    metadataPinId: "999999999999999999",
    metadataPreview: "https://i.pinimg.com/stale-previous-pin.jpg"
  }),
  "https://i.pinimg.com/current-pin.jpg",
  "a preview linked to the active Pin must beat stale SPA metadata"
);

assert.equal(
  chooseDetailPreview({
    pinId: "1098948746608149917",
    linkedPreviews: [],
    metadataPinId: "999999999999999999",
    metadataPreview: "https://i.pinimg.com/stale-previous-pin.jpg"
  }),
  null,
  "stale metadata must not be shown as the active Pin preview"
);

assert.equal(
  chooseDetailPreview({
    pinId: "1098948746608149917",
    linkedPreviews: [],
    metadataPinId: "1098948746608149917",
    metadataPreview: "https://i.pinimg.com/current-pin.jpg"
  }),
  "https://i.pinimg.com/current-pin.jpg",
  "matching metadata remains a valid fallback"
);

assert.equal(
  chooseDetailPreview({
    pinId: "1126885138050626374",
    detailPreviews: ["https://i.pinimg.com/originals/current-closeup.jpg"],
    linkedPreviews: [],
    metadataPinId: "999999999999999999",
    metadataPreview: "https://i.pinimg.com/originals/stale.jpg"
  }),
  "https://i.pinimg.com/originals/current-closeup.jpg",
  "an unlinked image in the current Pin closeup must be accepted before stale metadata"
);

console.log("PASS: Pin identity and detail-preview alignment");

const storageState = {};
const storeContext = vm.createContext({
  globalThis: {},
  chrome: {
    storage: {
      local: {
        async get(key) { return { [key]: storageState[key] }; },
        async set(values) { Object.assign(storageState, values); }
      }
    }
  }
});
const storeSource = fs.readFileSync(new URL("./pinref-store.js", import.meta.url), "utf8");
vm.runInContext(storeSource, storeContext);
const store = storeContext.globalThis.PinRefStore;

storageState[store.STORAGE_KEY] = {
  version: 1,
  records: {
    "999999999999999999": {
      pinId: "999999999999999999",
      boardContext: "legacy board",
      savedAt: "2026-09-24T00:00:00.000Z"
    }
  }
};
const migratedLibrary = await store.readLibrary();
assert.equal(migratedLibrary.version, 4, "the local library should migrate to the Import Session schema");
assert.equal("boardContext" in migratedLibrary.records["999999999999999999"], false, "migration should erase legacy board mapping");
assert.equal(storageState[store.STORAGE_KEY].version, 4, "migration should persist the Import Session schema");

await store.saveImportSession(unconfirmedImport);
const persistedImport = (await store.readLibrary()).importSessions[unconfirmedImport.sessionId];
assert.equal(persistedImport.status, "paused", "Partial Import Session survives service-worker restart storage round trips");
assert.equal(Object.keys(persistedImport.candidates).length, 2, "restart persistence keeps identity-merged candidates");

await store.saveAttempt(localFailed);
let libraryWithAttempt = await store.readLibrary();
assert.equal(libraryWithAttempt.attempts[localFailed.attemptId].originTabId, 41, "attempts survive worker restart with immutable origin tab identity");
const failedCommit = await store.commitAttempt(localFailed.attemptId, { pinId: localFailed.pinId }, { simulateFailure: true });
assert.equal(failedCommit.ok, false, "a simulated local failure must not create a Reference");
libraryWithAttempt = await store.readLibrary();
assert.equal(Boolean(libraryWithAttempt.records[localFailed.pinId]), false, "failed attempts stay outside the Library");
const recoveredCommit = await store.commitAttempt(localFailed.attemptId, { pinId: localFailed.pinId, note: "" });
assert.equal(recoveredCommit.ok, true, "retry commits the original attempt");
assert.equal((await store.readLibrary()).attempts[localFailed.attemptId], undefined, "successful commit removes the attempt from Needs Attention");

let records = await store.mergeFromContent({
  "1098948746608149917": {
    pinId: "1098948746608149917",
    previewUrl: "https://i.pinimg.com/original.jpg",
    tags: " Fashion, pose, fashion ",
    note: "first note",
    savedAt: "2026-09-25T00:00:00.000Z"
  }
});
assert.deepEqual([...records["1098948746608149917"].tags], ["fashion", "pose"], "stored tags should be normalized");

await store.updateRecord("1098948746608149917", { note: "edited in Dashboard", tags: ["fashion", "lighting"] });
records = await store.mergeFromContent({
  "1098948746608149917": {
    pinId: "1098948746608149917",
    previewUrl: "https://i.pinimg.com/detail.jpg",
    tags: [],
    note: "stale content-script copy"
  }
});
assert.equal(records["1098948746608149917"].note, "edited in Dashboard", "page snapshots must not overwrite Dashboard edits");
assert.deepEqual([...records["1098948746608149917"].tags], ["fashion", "lighting"], "page snapshots must preserve canonical tags");
assert.equal(records["1098948746608149917"].previewUrl, "https://i.pinimg.com/detail.jpg", "fresh Pin observations may improve the preview");
records = await store.mergeFromContent({
  "1098948746608149917": {
    pinId: "1098948746608149917",
    boardContext: "legacy board that must be discarded"
  }
});
assert.equal("boardContext" in records["1098948746608149917"], false, "PinRef must not retain Pinterest board mapping");

await store.updateSettings({ tagColors: { fashion: "#b69aac" }, tagOrder: ["fashion", "lighting"] });
const libraryWithSettings = await store.readLibrary();
assert.equal(libraryWithSettings.tagColors.fashion, "#b69aac", "Dashboard tag colors should persist with the shared library");
assert.deepEqual([...libraryWithSettings.tagOrder], ["fashion", "lighting"], "Dashboard tag order should persist with the shared library");

const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
assert.ok(manifest.permissions.includes("storage"), "the integrated prototype requires local storage permission");
assert.ok(manifest.permissions.includes("scripting"), "extension reload recovery requires scripting permission to reconnect existing Pinterest tabs");
assert.ok(manifest.permissions.includes("activeTab"), "the Import prototype must exercise activeTab rather than assuming persistent host access");
assert.deepEqual([...manifest.optional_host_permissions], ["https://*.pinterest.com/*"], "fallback host access must remain Pinterest-only and optional");
assert.equal(manifest.content_scripts, undefined, "static host injection must not make the activeTab experiment a false positive");
assert.ok(fs.existsSync(new URL("./dashboard.html", import.meta.url)), "the extension must include its Dashboard page");
assert.match(fs.readFileSync(new URL("./sidepanel.html", import.meta.url), "utf8"), /id="reload-metadata"/, "Side Panel should expose metadata reload");
assert.match(fs.readFileSync(new URL("./dashboard.html", import.meta.url), "utf8"), /id="reload-dashboard-metadata"/, "Dashboard should expose metadata reload");

const workerSource = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
assert.doesNotMatch(workerSource, /setOptions\(\{ enabled: false \}\)/, "startup must not race a global disable against tab-specific enablement");
assert.match(workerSource, /configureSidePanelForTab/, "the worker should configure existing and newly activated tabs directly");
assert.match(workerSource, /ensureContentScript/, "the worker should reconnect an already-open Pinterest tab after extension reload");
assert.match(workerSource, /pinref:reloadMetadata/, "Dashboard and Side Panel should share one metadata reload command");
assert.match(workerSource, /pinref:captureStarted/, "native Save must create a persistent Capture Attempt");
assert.match(workerSource, /pinref:captureEvidence/, "Pinterest evidence must be processed separately from click intent");
assert.match(workerSource, /pinref:startImport/, "Dashboard should own explicit Import start");
assert.match(workerSource, /another-scan-active/, "only one Import scan may be active per browser profile");
assert.match(workerSource, /permission-revoked/, "permission revocation must stop an active scan");
assert.doesNotMatch(workerSource, /mergeFromContent\(message\.state\.records\)/, "content snapshots must not create References");
assert.match(workerSource, /if \(!tab\?\.active/, "background tab updates must not publish themselves as Side Panel context");
assert.match(workerSource, /pinref:dashboardReady/, "Dashboard activation should request Side Panel closure");
assert.match(workerSource, /sidePanel\.close\(\{ windowId \}\)/, "Dashboard transition should close the browser-owned Side Panel in the same window");
assert.match(workerSource, /pinref:closePanel/, "the Side Panel close button should delegate browser-owned panel closure to the worker");
assert.match(workerSource, /sidePanel\.close\(\{ tabId \}\)/, "a tab-specific PinRef panel must be closed with its Pinterest tab id");
assert.match(workerSource, /setOptions\(\{ tabId, enabled: false \}\)/, "older Brave builds need a disable-and-restore close fallback");
assert.match(fs.readFileSync(new URL("./content.js", import.meta.url), "utf8"), /pinref:refreshMetadata/, "reload should request a fresh observation from Pinterest content");
const contentSource = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
assert.match(contentSource, /handleNativePinterestSave/, "Pinterest native Save should be the PinRef capture trigger");
assert.match(contentSource, /pinref:ping/, "the content script should expose a liveness check before reinjection");
assert.match(contentSource, /handlePinterestBoardSelectorIntent/, "opening Pinterest's board picker should retain the source Pin until final Save");
assert.match(contentSource, /pendingNativeSaveExpiresAt/, "pending board-picker attribution must expire instead of leaking to a later Save");
assert.match(contentSource, /pinref:startImportScan/, "the existing Pinterest content harness should run the bound Import scan");
assert.match(contentSource, /END_UNCONFIRMED/, "a heuristic plateau must report Unable to confirm rather than Complete");
assert.match(contentSource, /visibleImportCandidates/, "Import candidates must come from identity-bearing Pin links");
assert.doesNotMatch(contentSource, /for \(const anchor of anchors\) ensureOverlay\(anchor\)/, "scans must not inject the legacy PinRef overlay");
const sidePanelSource = fs.readFileSync(new URL("./sidepanel.js", import.meta.url), "utf8");
assert.doesNotMatch(sidePanelSource, /pinref:saveActive|Save current Pin/, "Side Panel must wait for Pinterest Save instead of offering direct add");
assert.match(sidePanelSource, /pinref:closePanel/, "the Side Panel close button must ask the worker to close the panel");
assert.match(sidePanelSource, /tabs\.query\(\{ active: true, currentWindow: true \}\)/, "the Side Panel close request must resolve its owning Pinterest tab");
assert.doesNotMatch(`${contentSource}\n${sidePanelSource}`, /boardContext|Board context|board context/, "Pinterest page integration and Side Panel must not capture or expose board mapping");
assert.ok(manifest.permissions.includes("tabs"), "startup recovery requires tab URLs so existing Pinterest tabs can be configured after extension reload");

const dashboardSource = fs.readFileSync(new URL("./dashboard.js", import.meta.url), "utf8");
const dashboardStyles = fs.readFileSync(new URL("./dashboard.css", import.meta.url), "utf8");
assert.doesNotMatch(dashboardSource, /boardContext|Board context|board context|record\.board|\.board\b/, "Dashboard must not retain, search, or expose Pinterest board mapping");
for (const requiredSurface of ["library-sidebar", "inspector-panel", "tag-picker", "mode-waterfall", "mode-masonry"]) {
  assert.ok(`${dashboardSource}\n${dashboardStyles}`.includes(requiredSurface), `the integrated Dashboard should retain ${requiredSurface}`);
}
assert.doesNotMatch(dashboardSource, /7820[0-9]|Silhouette study|Crimson portrait/, "the integrated Dashboard must not seed mock records");

console.log("PASS: shared persistent library and Dashboard integration");
