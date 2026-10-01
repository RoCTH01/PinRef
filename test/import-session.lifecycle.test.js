const test = require("node:test");
const assert = require("node:assert/strict");

const { createImportApplication } = require("../extension/import/application.js");
const { importSurfaceForUrl } = require("../extension/import/domain.js");

function createHarness() {
  const saved = new Map();
  const calls = [];
  const referenceStates = new Map();
  const committed = new Map();
  const failingPins = new Set();
  const throwingPins = new Set();
  const behavior = { scannerStartResponse: { ok: true }, permissionGranted: true, scannerAvailable: true, foreground: true };
  const tab = {
    id: 41,
    url: "https://www.pinterest.com/robbypin/reference/",
    title: "Reference board"
  };
  const repository = {
    async listSessions() { return [...saved.values()]; },
    async getSession(id) { return saved.get(id) || null; },
    async deleteSession(id) { if(behavior.failDelete)throw new Error("delete unavailable");saved.delete(id); },
    async saveSession(session) { saved.set(session.sessionId, structuredClone(session)); return session; },
    async getReferenceStates(pinIds) {
      return Object.fromEntries(pinIds.map((pinId) => [pinId, referenceStates.get(pinId) || null]));
    },
    async commitReference({ operationId, candidate, importedAt }) {
      if (throwingPins.has(candidate.pinId)) throw new Error("storage unavailable");
      if (failingPins.has(candidate.pinId)) return { ok: false, reason: "simulated-write-failure" };
      if (!committed.has(operationId)) committed.set(operationId, { pinId: candidate.pinId, previewUrl: candidate.previewUrl || null, addedToPinRefAt: importedAt, tags: [], note: "" });
      return { ok: true, record: committed.get(operationId) };
    }
  };
  const browser = {
    async isActiveSurface() { return behavior.foreground; },
    async getTab(id) { assert.equal(id, tab.id); return tab; },
    async hasPinterestPermission() { return behavior.permissionGranted; },
    async ensureScanner(id) { calls.push(["ensureScanner", id]); return behavior.scannerAvailable; },
    async startScanner(id, payload) { calls.push(["startScanner", id, payload]); return behavior.scannerStartResponse; },
    async stopScanner(id, sessionId, reason) { calls.push(["stopScanner", id, sessionId, reason]); }
  };
  const application = createImportApplication({
    repository,
    browser,
    clock: () => "2026-09-30T04:00:00.000Z",
    createId: () => "import-session-1"
  });
  return { application, saved, calls, tab, referenceStates, committed, failingPins, throwingPins, behavior };
}

test("Side Panel starts one Import Session bound to the exact Pinterest tab and Board surface", async () => {
  const { application, saved, calls, tab } = createHarness();

  const result = await application.execute({ type: "START", tabId: tab.id });

  assert.equal(result.ok, true);
  assert.equal(result.session.status, "scanning");
  assert.equal(result.session.originTabId, tab.id);
  assert.equal(result.session.surfaceKind, "board");
  assert.equal(result.session.surfaceKey, tab.url);
  assert.equal(saved.get("import-session-1").status, "scanning");
  assert.deepEqual(calls, [
    ["ensureScanner", 41],
    ["startScanner", 41, {
      sessionId: "import-session-1",
      surface: {
        surfaceKind: "board",
        surfaceKey: tab.url,
        surfaceUrl: tab.url
      }
    }]
  ]);
});

test("Start and Resume require the original foreground surface and reject stale source selection", async () => {
  const { application, behavior, tab } = createHarness();
  behavior.foreground = false;
  assert.equal((await application.execute({ type: "START", tabId: tab.id })).reason, "source-not-active");
  behavior.foreground = true;
  assert.equal((await application.execute({ type: "START", tabId: tab.id, surfaceKey: "https://www.pinterest.com/other/board/" })).reason, "binding-mismatch");
  await application.execute({ type: "START", tabId: tab.id });
  await application.execute({ type: "INTERRUPT", sessionId: "import-session-1", reason: "tab-switch" });
  behavior.foreground = false;
  assert.equal((await application.execute({ type: "RESUME", sessionId: "import-session-1" })).reason, "source-not-active");
});

test("Stop and review preserves Partial selection through a rescan, with newly found Pins unselected", async () => {
  const { application, tab } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });
  const observe = (pinId) => application.execute({ type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url, eventType: "OBSERVE_BATCH", observations: [{ pinId }] });
  await observe("111111111111");
  const stopped = await application.execute({ type: "STOP_REVIEW", sessionId: "import-session-1" });
  assert.equal(stopped.session.status, "reviewing");
  assert.equal(stopped.session.scanComplete, false);
  await application.execute({ type: "SET_SELECTED", sessionId: "import-session-1", pinId: "111111111111", selected: true });
  const resumed = await application.execute({ type: "RESUME", sessionId: "import-session-1" });
  assert.equal(resumed.session.status, "scanning");
  await observe("222222222222");
  const review = await application.execute({ type: "STOP_REVIEW", sessionId: "import-session-1" });
  assert.deepEqual(review.session.selectedPinIds, ["111111111111"]);
  assert.equal(Object.keys(review.session.candidates).length, 2);
});

test("only Saved root and concrete Board routes qualify as Import surfaces", () => {
  assert.equal(importSurfaceForUrl("https://ca.pinterest.com/robbypin/_pins/").surfaceKind, "saved-root");
  assert.equal(importSurfaceForUrl("https://www.pinterest.com/robbypin/reference/?invite=1").surfaceKey, "https://www.pinterest.com/robbypin/reference/");
  for (const url of [
    "https://www.pinterest.com/pin/123456789/",
    "https://www.pinterest.com/search/pins/",
    "https://www.pinterest.com/robbypin/_boards/",
    "https://www.pinterest.com/robbypin/reference/more/"
  ]) assert.equal(importSurfaceForUrl(url), null, url);
});

test("Start prefers an available activeTab scanner before requiring retained host permission", async () => {
  const { application, behavior, tab } = createHarness();
  behavior.permissionGranted = false;
  behavior.scannerAvailable = true;

  const result = await application.execute({ type: "START", tabId: tab.id });

  assert.equal(result.ok, true);
  assert.equal(result.session.status, "scanning");
});

test("scan observations merge by Pin identity and an unconfirmed plateau stays Partial and resumable", async () => {
  const { application, saved, calls, tab } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });

  await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: tab.id,
    surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH",
    observations: [
      { pinId: "111111111111", previewUrl: "https://i.pinimg.com/a.jpg" },
      { pinId: "222222222222", previewUrl: "https://i.pinimg.com/b.jpg" }
    ]
  });
  await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: tab.id,
    surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH",
    observations: [{ pinId: "111111111111", previewUrl: "https://i.pinimg.com/a-better.jpg" }]
  });
  const ended = await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: tab.id,
    surfaceKey: tab.url,
    eventType: "END_UNCONFIRMED",
    evidence: "four-round-scroll-height-and-identity-plateau"
  });

  assert.equal(ended.session.status, "paused");
  assert.equal(ended.session.stopReason, "unable-to-confirm-completion");
  assert.equal(ended.session.completionEvidence.confidence, "heuristic-only");
  assert.deepEqual(Object.keys(ended.session.candidates), ["111111111111", "222222222222"]);
  assert.equal(ended.session.candidates["111111111111"].observationCount, 2);
  assert.equal(ended.session.candidates["111111111111"].previewUrl, "https://i.pinimg.com/a-better.jpg");

  const resumed = await application.execute({ type: "RESUME", sessionId: "import-session-1" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.session.status, "scanning");
  assert.equal(saved.get("import-session-1").candidates["111111111111"].observationCount, 2);
  assert.equal(calls.at(-1)[0], "startScanner");
});

test("scan evidence from another tab cannot mutate the bound Import Session", async () => {
  const { application, saved, tab } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });

  const result = await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: 57,
    surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH",
    observations: [{ pinId: "333333333333" }]
  });

  assert.equal(Object.keys(result.session.candidates).length, 0);
  assert.match(result.session.trace.at(-1).event, /IGNORED_TAB_MISMATCH/);
  assert.equal(saved.get("import-session-1").originTabId, 41);
});

test("review defaults to no selection and Select all new excludes active duplicates and Trash", async () => {
  const { application, tab, referenceStates } = createHarness();
  referenceStates.set("222222222222", "active");
  referenceStates.set("333333333333", "trash");
  await application.execute({ type: "START", tabId: tab.id });
  await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: tab.id,
    surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH",
    observations: [
      { pinId: "111111111111" },
      { pinId: "222222222222" },
      { pinId: "333333333333" }
    ]
  });
  await application.execute({
    type: "SCAN_EVENT",
    sessionId: "import-session-1",
    tabId: tab.id,
    surfaceKey: tab.url,
    eventType: "END_UNCONFIRMED"
  });

  const review = await application.execute({ type: "BEGIN_REVIEW", sessionId: "import-session-1" });
  assert.equal(review.session.status, "reviewing");
  assert.deepEqual(review.session.selectedPinIds, []);
  assert.equal(review.session.candidates["222222222222"].eligibility, "duplicate");
  assert.equal(review.session.candidates["333333333333"].eligibility, "in-trash");
  assert.equal(review.session.results.duplicate, 1);
  assert.equal(review.session.results.inTrash, 1);

  const selected = await application.execute({ type: "SELECT_ALL_NEW", sessionId: "import-session-1" });
  assert.deepEqual(selected.session.selectedPinIds, ["111111111111"]);
});

test("Import commits only selected new candidates with actual import time and retries the same operation", async () => {
  const { application, tab, committed, failingPins } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH", observations: [{ pinId: "111111111111", previewUrl: "https://i.pinimg.com/a.jpg" }]
  });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "END_UNCONFIRMED"
  });
  await application.execute({ type: "BEGIN_REVIEW", sessionId: "import-session-1" });
  await application.execute({ type: "SELECT_ALL_NEW", sessionId: "import-session-1" });
  failingPins.add("111111111111");

  const failed = await application.execute({ type: "IMPORT_SELECTED", sessionId: "import-session-1" });
  assert.equal(failed.session.status, "import-incomplete");
  assert.equal(failed.session.candidates["111111111111"].result, "failed");
  assert.equal(committed.size, 0);

  failingPins.clear();
  const retried = await application.execute({ type: "RETRY", sessionId: "import-session-1", pinId: "111111111111" });
  assert.equal(retried.session.status, "results");
  assert.equal(retried.session.candidates["111111111111"].result, "imported");
  assert.deepEqual([...committed.keys()], ["import:import-session-1:111111111111"]);
  assert.equal(committed.values().next().value.addedToPinRefAt, "2026-09-30T04:00:00.000Z");
  assert.equal("boardContext" in committed.values().next().value, false);

  const done = await application.execute({ type: "DONE", sessionId: "import-session-1" });
  assert.equal(done.session.status, "import-complete");
});

test("Retry rejects candidates that do not have a failed local write", async () => {
  const { application, tab, committed } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH", observations: [{ pinId: "111111111111" }]
  });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "END_UNCONFIRMED"
  });
  await application.execute({ type: "BEGIN_REVIEW", sessionId: "import-session-1" });

  const result = await application.execute({ type: "RETRY", sessionId: "import-session-1", pinId: "111111111111" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-retry");
  assert.equal(committed.size, 0);
});

test("a rejected storage write becomes a persisted retryable candidate failure", async () => {
  const { application, saved, tab, throwingPins } = createHarness();
  await application.execute({ type: "START", tabId: tab.id });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "OBSERVE_BATCH", observations: [{ pinId: "111111111111" }]
  });
  await application.execute({
    type: "SCAN_EVENT", sessionId: "import-session-1", tabId: tab.id, surfaceKey: tab.url,
    eventType: "END_UNCONFIRMED"
  });
  await application.execute({ type: "BEGIN_REVIEW", sessionId: "import-session-1" });
  await application.execute({ type: "SELECT_ALL_NEW", sessionId: "import-session-1" });
  throwingPins.add("111111111111");

  const result = await application.execute({ type: "IMPORT_SELECTED", sessionId: "import-session-1" });

  assert.equal(result.ok, true);
  assert.equal(result.session.status, "import-incomplete");
  assert.equal(result.session.candidates["111111111111"].result, "failed");
  assert.match(result.session.candidates["111111111111"].failureReason, /storage unavailable/);
  assert.equal(saved.get("import-session-1").status, "import-incomplete");
});

test("Cancel, navigation, tab switch, tab close, permission revoke and worker restart preserve a Partial session", async (t) => {
  for (const reason of ["cancelled-by-user", "navigation", "tab-switch", "tab-closed", "permission-revoked", "service-worker-restart"]) {
    await t.test(reason, async () => {
      const { application, tab, calls } = createHarness();
      await application.execute({ type: "START", tabId: tab.id });
      const result = await application.execute({ type: "INTERRUPT", sessionId: "import-session-1", reason });

      assert.equal(result.session.status, "paused");
      assert.equal(result.session.stopReason, reason);
      assert.deepEqual(calls.at(-1), ["stopScanner", tab.id, "import-session-1", reason]);
    });
  }
});

test("a scanner launch failure persists a resumable Partial instead of a false scanning state", async () => {
  const { application, saved, tab, behavior } = createHarness();
  behavior.scannerStartResponse = { ok: false, reason: "trusted-collection-unavailable" };

  const result = await application.execute({ type: "START", tabId: tab.id });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "trusted-collection-unavailable");
  assert.equal(result.session.status, "paused");
  assert.equal(result.session.stopReason, "trusted-collection-unavailable");
  assert.equal(saved.get("import-session-1").status, "paused");
});

test("confirmed writes are journaled before commit and worker recovery reconciles a committed but unreported item", async () => {
  const { createChromeRepository } = require("../extension/import/store.js");
  let disk = {};
  let simulateCrash = true;
  const repository = createChromeRepository({
    async get() { return structuredClone(disk); },
    async set(value) {
      const state = value.pinrefState;
      if (simulateCrash && state.importSessions.s?.candidates["111111111111"]?.result === "imported") {
        simulateCrash = false;
        throw new Error("worker stopped before saving result");
      }
      disk = structuredClone(value);
    }
  });
  const browser = { getTab: async () => ({ id: 1, url: "https://www.pinterest.com/a/_pins/" }), isActiveSurface: async () => true, ensureScanner: async () => true, startScanner: async () => ({ ok: true }), stopScanner: async () => {} };
  const app = createImportApplication({ repository, browser, createId: () => "s" });
  await app.execute({ type: "START", tabId: 1 });
  await app.execute({ type: "SCAN_EVENT", sessionId: "s", tabId: 1, eventType: "OBSERVE_BATCH", observations: [{ pinId: "111111111111" }, { pinId: "222222222222" }] });
  await app.execute({ type: "STOP_REVIEW", sessionId: "s" });
  await app.execute({ type: "SELECT_ALL_NEW", sessionId: "s" });
  await assert.rejects(app.execute({ type: "IMPORT_SELECTED", sessionId: "s" }), /worker stopped/);
  assert.deepEqual((await repository.getSession("s")).pendingPinIds, ["111111111111", "222222222222"]);
  const restarted = createImportApplication({ repository, browser });
  const recovered = await restarted.execute({ type: "RECOVER_WRITES", sessionId: "s" });
  assert.equal(recovered.session.status, "results");
  assert.equal(recovered.session.results.imported, 2);
  assert.equal(Object.keys((await repository.readState()).references).length, 2);
  assert.equal((await restarted.execute({ type: "RESUME", sessionId: "s" })).reason, "invalid-resume");
});

test("all Duplicate and In Trash review can finish without an empty import; failed cleanup retains usable review", async () => {
  const { application, tab, referenceStates, behavior, saved } = createHarness();
  await application.execute({type:"START",tabId:tab.id});
  const empty=await application.execute({type:"SCAN_EVENT",sessionId:"import-session-1",tabId:tab.id,eventType:"END_RELIABLE"});
  assert.equal(empty.session.scanComplete,false);
  assert.equal(empty.session.status,"paused");
  await application.execute({type:"RESUME",sessionId:"import-session-1"});
  await application.execute({type:"SCAN_EVENT",sessionId:"import-session-1",tabId:tab.id,eventType:"OBSERVE_BATCH",observations:[{pinId:"111111111111"},{pinId:"222222222222"}]});
  referenceStates.set("111111111111","active");
  referenceStates.set("222222222222","trash");
  await application.execute({type:"STOP_REVIEW",sessionId:"import-session-1"});
  behavior.failDelete=true;
  await assert.rejects(application.execute({type:"DONE",sessionId:"import-session-1"}),/delete unavailable/);
  assert.equal(saved.get("import-session-1").status,"reviewing");
  behavior.failDelete=false;
  const done=await application.execute({type:"DONE",sessionId:"import-session-1"});
  assert.equal(done.ok,true);
  assert.equal(done.session.status,"import-complete");
  assert.equal(saved.has("import-session-1"),false);
});
