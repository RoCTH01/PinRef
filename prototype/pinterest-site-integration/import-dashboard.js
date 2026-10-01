(() => {
  "use strict";

  const panel = document.querySelector("#import-lab");
  const launcher = document.querySelector("#open-import-lab");
  if (!panel || !launcher) return;

  if (chrome.runtime.getManifest().version !== "0.0.21" && !sessionStorage.getItem("pinref-import-manifest-reload")) {
    sessionStorage.setItem("pinref-import-manifest-reload", "requested");
    chrome.runtime.reload();
    return;
  }

  const view = { tabs: [], sessions: {}, permission: { hostGranted: false, mode: "unknown" }, selectedTabId: null, status: "" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const send = (message) => chrome.runtime.sendMessage(message);

  async function reload() {
    const [tabsResult, sessionsResult] = await Promise.all([
      send({ type: "pinref:listImportTabs" }),
      send({ type: "pinref:getImportSessions" })
    ]);
    view.tabs = tabsResult?.tabs || [];
    view.sessions = sessionsResult?.sessions || {};
    view.permission = sessionsResult?.permission || tabsResult?.permission || view.permission;
    if (!view.tabs.some((tab) => tab.id === view.selectedTabId)) view.selectedTabId = view.tabs.find((tab) => tab.surface)?.id || null;
    render();
  }

  function candidateHTML(session, candidate) {
    const retry = candidate.result === "failed" ? `<button data-retry="${esc(candidate.pinId)}" data-session="${esc(session.sessionId)}">Retry local write</button>` : "";
    const scopes = (candidate.scopeHistory || []).map((scope) => `${scope.scopeKey} · ${scope.scopeHeading || "no external heading"}`).join(" | ") || "unscoped";
    return `<div class="import-candidate"><strong>Pin ${esc(candidate.pinId)}</strong><p>${esc(candidate.result || "candidate")} · observed ${Number(candidate.observationCount || 1)}×</p><p class="import-scope-note">DOM scope: ${esc(scopes)}</p><div class="import-lab-row">${retry}<button data-result="imported" data-pin="${esc(candidate.pinId)}" data-session="${esc(session.sessionId)}">Sim imported</button><button data-result="duplicate" data-pin="${esc(candidate.pinId)}" data-session="${esc(session.sessionId)}">Sim duplicate</button><button data-result="in-trash" data-pin="${esc(candidate.pinId)}" data-session="${esc(session.sessionId)}">Sim In Trash</button><button data-result="failed" data-pin="${esc(candidate.pinId)}" data-session="${esc(session.sessionId)}">Sim write failure</button></div></div>`;
  }

  function scopeSummaryHTML(candidates) {
    const scopes = new Map();
    for (const candidate of candidates) {
      const latest = candidate.scopeHistory?.at(-1) || { scopeKey: "unscoped", scopeHeading: null, scopeBoundaryKind: "none" };
      const key = `${latest.scopeKey}|${latest.scopeHeading || ""}`;
      const entry = scopes.get(key) || { ...latest, candidates: 0 };
      entry.candidates += 1;
      scopes.set(key, entry);
    }
    const rows = [...scopes.values()].sort((a, b) => b.candidates - a.candidates).map((scope) =>
      `<tr><td><code>${esc(scope.scopeKey)}</code></td><td>${esc(scope.scopeHeading || "—")}</td><td>${scope.candidates}</td><td>${esc(scope.scopeBoundaryKind || "unknown")}</td></tr>`
    ).join("");
    return `<div class="import-scope-summary"><h3>DOM membership scopes</h3><p>Diagnostic only. A scope is not trusted until real Pinterest evidence shows it excludes every recommendation and commerce module.</p><table><thead><tr><th>Scope</th><th>Nearest outside heading</th><th>Unique Pins</th><th>Boundary</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No scope observations yet.</td></tr>'}</tbody></table></div>`;
  }

  function sessionHTML(session) {
    const candidates = Object.values(session.candidates || {});
    const canResume = ["paused", "ready-to-import"].includes(session.status);
    const canReview = ["paused", "ready-to-import"].includes(session.status);
    const canDone = ["importing", "import-incomplete"].includes(session.status) && !session.results?.failed;
    const trace = (session.trace || []).map((entry) => `${entry.at}  ${entry.event} → ${entry.state}${entry.detail ? ` (${entry.detail})` : ""}`).join("\n");
    return `<section class="import-lab-card" data-session-card="${esc(session.sessionId)}"><h2>${esc(session.surfaceKind)} · ${esc(session.status)}</h2><dl><dt>Session</dt><dd><code>${esc(session.sessionId)}</code></dd><dt>Binding</dt><dd>tab ${session.originTabId}<br><code>${esc(session.surfaceKey)}</code></dd><dt>Stop reason</dt><dd>${esc(session.stopReason || "—")}</dd><dt>Completion</dt><dd>${esc(session.completionEvidence?.kind || "—")} · ${esc(session.completionEvidence?.confidence || "—")}</dd><dt>Candidates</dt><dd>${candidates.length}; skipped identity ${session.skippedIdentity || 0}; excluded outside membership scope ${session.skippedMembership || 0}</dd><dt>Results</dt><dd>${esc(JSON.stringify(session.results || {}))}</dd></dl>${scopeSummaryHTML(candidates)}<div class="import-lab-row">${session.status === "scanning" ? `<button class="danger" data-cancel="${esc(session.sessionId)}">Cancel</button>` : ""}${canResume ? `<button data-resume="${esc(session.sessionId)}">Resume from top</button>` : ""}${canReview ? `<button data-action="BEGIN_IMPORT" data-session="${esc(session.sessionId)}">Stop and review</button>` : ""}${canDone ? `<button data-action="DONE" data-session="${esc(session.sessionId)}">Done</button>` : ""}<button data-action="DISMISS" data-session="${esc(session.sessionId)}">Dismiss</button></div><h3 style="margin-top:12px">Candidates</h3><div class="import-candidates">${candidates.map((candidate) => candidateHTML(session, candidate)).join("") || "<p>No identity-known candidates yet.</p>"}</div><details><summary>State transition trace</summary><pre class="import-trace">${esc(trace)}</pre></details></section>`;
  }

  function render() {
    const eligible = view.tabs.filter((tab) => tab.surface);
    panel.innerHTML = `<header><div><h1>Import from Pinterest · hard-gate lab</h1><p>Dashboard owns the session. Live Chrome/Pinterest observations are separate from the clearly labelled simulated commit controls.</p></div><button id="close-import-lab" aria-label="Close">×</button></header><section class="import-lab-card"><h2>Permission and surface</h2><p>Extension v${esc(chrome.runtime.getManifest().version)} · Mode: <strong>${esc(view.permission.mode)}</strong>. ${view.permission.hostGranted ? "Pinterest-only optional host permission is granted." : "No persistent Pinterest host permission."}</p><div class="import-lab-row"><button id="reload-unpacked-extension">Reload prototype extension</button><button id="grant-import-permission">Grant Pinterest-only permission</button><button id="revoke-import-permission">Revoke permission</button></div><div class="import-lab-row"><select id="import-tab-select" aria-label="Pinterest import surface"><option value="">Choose a Saved or Board tab</option>${eligible.map((tab) => `<option value="${tab.id}" ${tab.id === view.selectedTabId ? "selected" : ""}>${esc(tab.surface.surfaceKind)} · ${esc(tab.title)}</option>`).join("")}</select><button id="refresh-import-tabs">Refresh</button><button id="start-import" class="primary" ${view.selectedTabId ? "" : "disabled"}>Start scan</button></div><p>${esc(view.status || (eligible.length ? "Starting activates the selected Pinterest tab." : "Open a Pinterest Saved root or one Board, then refresh."))}</p></section><div class="import-lab-grid">${Object.values(view.sessions).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(sessionHTML).join("") || `<section class="import-lab-card"><p>No Import Session yet.</p></section>`}</div>`;
    bind();
  }

  async function act(message, label) {
    view.status = label;
    render();
    const result = await send(message).catch((error) => ({ ok: false, reason: String(error) }));
    view.status = result?.ok ? `${label}: done` : `${label}: ${result?.reason || result?.error || "failed"}`;
    await reload();
  }

  function bind() {
    panel.querySelector("#close-import-lab")?.addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector("#reload-unpacked-extension")?.addEventListener("click", () => chrome.runtime.reload());
    panel.querySelector("#refresh-import-tabs")?.addEventListener("click", reload);
    panel.querySelector("#import-tab-select")?.addEventListener("change", (event) => { view.selectedTabId = Number(event.target.value) || null; render(); });
    panel.querySelector("#start-import")?.addEventListener("click", () => act({ type: "pinref:startImport", tabId: view.selectedTabId }, "Start scan"));
    panel.querySelector("#grant-import-permission")?.addEventListener("click", async () => { const granted = await chrome.permissions.request({ origins: ["https://*.pinterest.com/*"] }); view.status = granted ? "Pinterest-only permission granted" : "Permission was not granted"; await reload(); });
    panel.querySelector("#revoke-import-permission")?.addEventListener("click", async () => { const removed = await chrome.permissions.remove({ origins: ["https://*.pinterest.com/*"] }); view.status = removed ? "Pinterest permission revoked" : "No permission was removed"; await reload(); });
    panel.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => act({ type: "pinref:cancelImport", sessionId: button.dataset.cancel }, "Cancel scan")));
    panel.querySelectorAll("[data-resume]").forEach((button) => button.addEventListener("click", () => act({ type: "pinref:resumeImport", sessionId: button.dataset.resume }, "Resume from top")));
    panel.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => act({ type: "pinref:simulateImportAction", sessionId: button.dataset.session, actionType: button.dataset.action }, `Simulate ${button.dataset.action}`)));
    panel.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => act({ type: "pinref:simulateImportAction", sessionId: button.dataset.session, actionType: "COMMIT_RESULT", pinId: button.dataset.pin, result: button.dataset.result }, `Simulate ${button.dataset.result}`)));
    panel.querySelectorAll("[data-retry]").forEach((button) => button.addEventListener("click", () => act({ type: "pinref:simulateImportAction", sessionId: button.dataset.session, actionType: "RETRY_LOCAL", pinId: button.dataset.retry }, "Simulate local retry")));
  }

  launcher.addEventListener("click", async () => { panel.hidden = false; await reload(); });
  chrome.storage.onChanged.addListener((changes, areaName) => { if (!panel.hidden && areaName === "local" && changes[PinRefStore.STORAGE_KEY]) reload(); });
})();
