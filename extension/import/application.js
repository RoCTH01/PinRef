(function exposeImportApplication(root, factory) {
  const domain = typeof module === "object" && module.exports
    ? require("./domain.js")
    : root.PinRefImportDomain;
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PinRefImportApplication = api;
})(typeof globalThis === "object" ? globalThis : this, function createModule(domain) {
  "use strict";

  function createImportApplication({ repository, browser, clock = () => new Date().toISOString(), createId = () => crypto.randomUUID() }) {
    async function start(command) {
      if (!Number.isInteger(command.tabId)) return { ok: false, reason: "invalid-tab" };
      const active = (await repository.listSessions()).find((session) => session.status === domain.ACTIVE_STATUS);
      if (active) return { ok: false, reason: "another-scan-active", session: active };
      const tab = await browser.getTab(command.tabId);
      const surface = domain.importSurfaceForUrl(tab?.url);
      if (!surface) return { ok: false, reason: "unsupported-surface" };
      if (command.surfaceKey && command.surfaceKey !== surface.surfaceKey) return { ok: false, reason: "binding-mismatch" };
      if (!await browser.isActiveSurface(tab.id, surface.surfaceKey)) return { ok: false, reason: "source-not-active" };
      const scannerAvailable = await browser.ensureScanner(tab.id);
      if (!scannerAvailable) {
        if (!await browser.hasPinterestPermission()) return { ok: false, reason: "permission-required" };
        return { ok: false, reason: "content-script-unavailable" };
      }
      const at = clock();
      let session = domain.createImportSession({ sessionId: createId(), tabId: tab.id, surface, at });
      session.originWindowId = tab.windowId;
      session = domain.transitionImportSession(session, {
        type: "START_SCAN",
        tabId: tab.id,
        surfaceKey: surface.surfaceKey
      }, at);
      await repository.saveSession(session);
      const response = await browser.startScanner(tab.id, { sessionId: session.sessionId, surface });
      if (response?.ok) return { ok: true, session };
      const reason = response?.reason || "content-script-unavailable";
      session = domain.transitionImportSession(session, { type: "SCAN_FAILED", tabId: tab.id, reason }, clock());
      await repository.saveSession(session);
      return { ok: false, reason, session };
    }

    async function scanEvent(command) {
      const current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      if (command.eventType === "HEARTBEAT") return { ok: true, session: current };
      const session = domain.transitionImportSession(current, {
        type: command.eventType,
        tabId: command.tabId,
        surfaceKey: command.surfaceKey,
        observations: command.observations,
        skippedIdentity: command.skippedIdentity,
        skippedMembership: command.skippedMembership,
        evidence: command.evidence,
        reason: command.reason
      }, clock());
      await repository.saveSession(session);
      return { ok: true, session };
    }

    async function resume(command) {
      const current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      if (current.importStartedAt || !["paused", "ready-to-import", "reviewing"].includes(current.status)) return { ok: false, reason: "invalid-resume" };
      const running = (await repository.listSessions()).find((session) => session.status === domain.ACTIVE_STATUS && session.sessionId !== current.sessionId);
      if (running) return { ok: false, reason: "another-scan-active", session: running };
      const tab = await browser.getTab(current.originTabId);
      const surface = domain.importSurfaceForUrl(tab?.url);
      if (!surface || surface.surfaceKey !== current.surfaceKey) return { ok: false, reason: "binding-mismatch", session: current };
      if (!await browser.isActiveSurface(tab.id, surface.surfaceKey)) return { ok: false, reason: "source-not-active", session: current };
      const scannerAvailable = await browser.ensureScanner(tab.id);
      if (!scannerAvailable) {
        if (!await browser.hasPinterestPermission()) return { ok: false, reason: "permission-required", session: current };
        return { ok: false, reason: "content-script-unavailable", session: current };
      }
      const session = domain.transitionImportSession(current, {
        type: "RESUME_FROM_TOP",
        tabId: tab.id,
        surfaceKey: surface.surfaceKey
      }, clock());
      session.originWindowId = tab.windowId;
      await repository.saveSession(session);
      const response = await browser.startScanner(tab.id, { sessionId: session.sessionId, surface });
      if (response?.ok) return { ok: true, session };
      const reason = response?.reason || "content-script-unavailable";
      const paused = domain.transitionImportSession(session, { type: "SCAN_FAILED", tabId: tab.id, reason }, clock());
      await repository.saveSession(paused);
      return { ok: false, reason, session: paused };
    }

    async function transitionStored(command, action) {
      const current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      const session = domain.transitionImportSession(current, action, clock());
      await repository.saveSession(session);
      return { ok: true, session };
    }

    async function beginReview(command) {
      const current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      const pinIds = Object.keys(current.candidates);
      const referenceStates = await repository.getReferenceStates(pinIds);
      return transitionStored(command, { type: "BEGIN_REVIEW", referenceStates });
    }

    async function commitCandidate(session, pinId) {
      const candidate = session.candidates[pinId];
      if (!candidate || candidate.eligibility !== "new") return session;
      const importedAt = clock();
      let result;
      try {
        result = await repository.commitReference({
          operationId: `import:${session.sessionId}:${pinId}`,
          candidate,
          importedAt
        });
      } catch (error) {
        result = { ok: false, reason: String(error?.message || error || "local-write-failed") };
      }
      return domain.transitionImportSession(session, {
        type: "COMMIT_RESULT",
        pinId,
        result: result.ok ? (result.status || "imported") : "failed",
        reason: result.reason
      }, importedAt);
    }

    async function importSelected(command) {
      let current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      if (current.status !== "reviewing" || !current.selectedPinIds.length) return { ok: false, reason: "nothing-selected" };
      current = domain.transitionImportSession(current, { type: "BEGIN_IMPORT" }, clock());
      await repository.saveSession(current);
      return processPending(current);
    }

    async function processPending(current) {
      for (const pinId of [...(current.pendingPinIds || [])]) {
        current = await commitCandidate(current, pinId);
        await repository.saveSession(current);
      }
      return { ok: true, session: current };
    }

    async function retry(command) {
      let current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      if (current.status !== "import-incomplete" || current.candidates[command.pinId]?.result !== "failed") {
        return { ok: false, reason: "invalid-retry", session: current };
      }
      current = domain.transitionImportSession(current, { type: "RETRY_LOCAL", pinId: command.pinId }, clock());
      await repository.saveSession(current);
      return processPending(current);
    }

    async function interrupt(command) {
      const current = await repository.getSession(command.sessionId);
      if (!current) return { ok: false, reason: "session-not-found" };
      if (current.status === domain.ACTIVE_STATUS) {
        await browser.stopScanner(current.originTabId, current.sessionId, command.reason);
      }
      return transitionStored(command, { type: "INTERRUPT", tabId: current.originTabId, reason: command.reason });
    }

    return {
      async execute(command) {
        if (command?.type === "START") return start(command);
        if (command?.type === "SCAN_EVENT") return scanEvent(command);
        if (command?.type === "RESUME") return resume(command);
        if (command?.type === "BEGIN_REVIEW") return beginReview(command);
        if (command?.type === "SELECT_ALL_NEW") return transitionStored(command, { type: "SELECT_ALL_NEW" });
        if (command?.type === "CLEAR_SELECTION") return transitionStored(command, { type: "CLEAR_SELECTION" });
        if (command?.type === "SET_SELECTED") return transitionStored(command, { type: "SET_SELECTED", pinId: command.pinId, selected: command.selected });
        if (command?.type === "IMPORT_SELECTED") return importSelected(command);
        if (command?.type === "RETRY") return retry(command);
        if (command?.type === "RECOVER_WRITES") {
          const current = await repository.getSession(command.sessionId);
          return current ? processPending(current) : { ok: false, reason: "session-not-found" };
        }
        if (command?.type === "DONE" || command?.type === "DISMISS") {
          const current = await repository.getSession(command.sessionId);
          if (!current) return { ok: false, reason: "session-not-found" };
          if (current?.pendingPinIds?.length || current?.status === "scanning") return { ok: false, reason: "session-busy" };
          const session = domain.transitionImportSession(current, { type: command.type }, clock());
          if (!["import-complete", "dismissed"].includes(session.status)) return { ok: false, reason: "session-not-finished" };
          // One write removes all temporary context. Failure leaves the usable prior state.
          await repository.deleteSession(session.sessionId);
          return { ok: true, session };
        }
        if (command?.type === "INTERRUPT") return interrupt(command);
        if (command?.type === "STOP_REVIEW") {
          const stopped = await interrupt({ ...command, reason: "stopped-for-review" });
          return stopped.ok ? beginReview(command) : stopped;
        }
        return { ok: false, reason: "unknown-command" };
      }
    };
  }

  return { createImportApplication };
});
