(async function runPanel() {
  "use strict";
  const root = document.querySelector("#panel-content");
  const feedback = document.querySelector("#feedback");
  const { id: windowId } = await chrome.windows.getCurrent();
  const view = { remote: null, sessionId: null, manualSessionId: null, captureFocus: false, captureJustStarted: false, sourceIdentity: null, mode: "idle", busy: false, sourceDetailsOpen: true, message: "", focus: null };
  const contextView=createContextView({getState:()=>view.remote,changed:(reload)=>reload?refresh():render(),feedback:message=>{view.message=message;}});
  document.addEventListener("click",async event=>{
    const link=event.target.closest('a[href*="dashboard/index.html"]');
    if(!link)return;
    const scanning=list().filter(s=>s.status==="scanning");
    if(!scanning.length)return;
    event.preventDefault();
    if(!confirm("Opening Dashboard will pause the scan as Partial. Continue?"))return;
    await contextView.flush();
    for(const session of scanning)await send({type:"STOP_REVIEW",sessionId:session.sessionId});
    window.open(link.href,"_blank","noopener");
  });
  let port;
  let loading = false;
  let refreshAgain = false;
  let closing = false;
  let pendingPermission = null;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  const list = () => Object.values(view.remote?.sessions || {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const current = () => view.remote?.sessions?.[view.sessionId];
  const sourceMatches = (s) => Boolean(s && s.originTabId === view.remote?.source?.tabId && s.surfaceKey === view.remote?.source?.surface?.surfaceKey);
  const labels = { scanning: "Scanning", paused: "Partial", "ready-to-import": "Ready to review", reviewing: "Review candidates", importing: "Importing…", results: "Import results", "import-incomplete": "Needs retry" };
  const kindLabels = { "saved-root":"Saved Pins", board:"Board", pin:"Individual Pin", unsupported:"Unsupported Pinterest page", "outside-pinterest":"Outside Pinterest" };
  const sourceIdentity = source => {
    if (source?.surface) return `${source.tabId}:${source.surface.surfaceKey}`;
    try { const url=new URL(source.url); return `${source?.tabId ?? ""}:${url.origin}${url.pathname}`; }
    catch { return `${source?.tabId ?? ""}:${source?.url ?? ""}`; }
  };
  const isPinterestHome = source => {
    try { const url=new URL(source.url); return url.protocol==="https:" && /(^|\.)pinterest\.com$/i.test(url.hostname) && url.pathname==="/"; }
    catch { return false; }
  };
  const pageMode = (source,remote=view.remote) => remote?.dashboardInspector && remote.preferences?.inspectorMode==="docked" ? "dashboard-inspector" : source?.surface ? "import" : source?.kind === "pin" || isPinterestHome(source) ? "pin" : "idle";
  const errors = {
    "permission-required":"Allow Pinterest access to continue this scan. PinRef reads this collection; it does not change Pinterest.",
    "source-not-active":"Keep the original Pinterest tab and collection in the foreground, then try again.",
    "binding-mismatch":"The original collection is no longer open in its tab. Existing candidates are kept; open a new Import for a new tab.",
    "another-scan-active":"Stop the current scan before starting another collection.",
    "content-script-unavailable":"Reload the Pinterest page, then try again.",
    "invalid-resume":"This session cannot resume scanning after local import begins.",
    "nothing-selected":"Choose at least one new candidate to import.",
    "session-not-finished":"Resolve outstanding failures before choosing Done.",
    "session-busy":"Wait for the current operation to finish.",
    "unsupported-surface":"Open Saved Pins or a concrete Board on Pinterest."
  };
  const send = (command) => chrome.runtime.sendMessage({ type: "pinref:importCommand", windowId, command });

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#eeefed" : "#111315";
  }
  setTheme(localStorage.getItem("pinref-theme") || (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark"));
  document.querySelector("#theme").addEventListener("click", async () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    const result=await PinRefUI.command({type:"SET_PREFERENCE",key:"theme",value:theme});
    if(result.ok){localStorage.setItem("pinref-theme",theme);setTheme(theme);}
  });

  function sourceHtml() {
    const source = view.remote.source;
    const running = list().find((s) => s.status === "scanning");
    return `<section class="panel-card import-source"><div class="source-label">Current collection · ${kindLabels[source.kind] || "Unavailable"}</div><span class="source-url">${escapeHtml(source.surface?.surfaceUrl || source.url)}</span>
      <p class="muted">PinRef reads and may automatically scroll this page. You choose which Pins to keep in this browser. Board names are temporary; Pinterest is not changed.</p>
      <div class="actions"><button class="button primary" data-action="START" ${running ? "disabled" : ""}>Start scan</button></div>
      ${running && !sourceMatches(running) ? `<p class="notice">Another collection is being scanned. Stop that scan before starting here. <button class="button" data-running="${escapeHtml(running.sessionId)}">Stop & review</button></p>` : ""}
      <details class="disclosure"><summary>How Import uses this page</summary><p>Keep this tab and collection unchanged while scanning; closing the panel pauses the scan. Board names are temporary and removed when you finish or dismiss the session.</p><p>PinRef does not modify Pinterest, read passwords or authentication cookies, intercept traffic, or send Import data to a PinRef server. Optional Pinterest access is revocable.</p></details>
      </section>`;
  }

  function sessionChooser() {
    const sessions=list();
    if (sessions.length===1 && view.mode==="import" && current()?.sessionId===sessions[0].sessionId) return "";
    return sessions.length ? `<details class="session-list" ${view.mode!=="import" || !current() ? "open" : ""}><summary>${sessions.length} unfinished import${sessions.length===1?"":"s"}</summary>${sessions.map(item=>`<button class="session-choice" data-session="${escapeHtml(item.sessionId)}" aria-pressed="${view.mode==="import" && view.sessionId===item.sessionId}"><span>${item.surfaceKind==="saved-root"?"Saved Pins":"Board"} · ${escapeHtml(item.surfaceKey)}</span><small>${labels[item.status] || item.status} · ${Object.keys(item.candidates).length} found</small></button>`).join("")}</details>` : "";
  }

  function idleHtml() {
    const source=view.remote.source;
    const outside=source.kind==="outside-pinterest";
    if(view.remote.dashboardInspector)return '<section class="inspector-empty sidepanel-empty"><span class="inspector-empty-icon">◇</span><strong>Inspector is floating in Dashboard</strong><p>Use the floating Inspector in Dashboard, or dock it there to move it into this Side Panel.</p></section>';
    return `<section class="inspector-empty sidepanel-empty"><span class="inspector-empty-icon">◇</span><strong>${outside?"Open Pinterest to begin":"No task for this page"}</strong><p>${outside?"Open a Pin or collection on Pinterest, then return here.":"This Pinterest page is neither a Pin detail nor a collection PinRef can scan."}</p></section><section class="panel-card idle-directions">${outside?"":`<span class="source-url">${escapeHtml(source.url)}</span>`}<h2>Where to go</h2><p><strong>This Pin</strong> appears on Pinterest Home or an individual Pin page. Use Pinterest’s Save to capture a Pin.</p><p><strong>Import</strong> appears on Saved Pins or a specific Board. Scanning starts only when you choose Start scan.</p></section>`;
  }

  function settingsHtml() {
    return `<details class="disclosure panel-settings"><summary>Settings</summary><p>${view.remote.permissionGranted ? "Optional Pinterest access is enabled." : "Optional Pinterest access is not enabled. Start a scan to request it only if needed."}</p>${view.remote.permissionGranted ? '<button class="button quiet" data-revoke-permission>Revoke Pinterest access</button>' : ""}</details>`;
  }

  function candidateHtml(s, c) {
    const outcome = c.result || c.eligibility || "new";
    const label = { imported:"Imported", duplicate:"Already in PinRef", "in-trash":"In Trash", failed:"Couldn’t save · Retry below", new:"New candidate" }[outcome];
    const enabled = s.status === "reviewing" && outcome === "new";
    const checked = enabled && s.selectedPinIds.includes(c.pinId);
    return `<article class="candidate${checked ? " selected" : ""}"><div class="candidate-preview">${c.previewUrl && /^https:\/\/i\.pinimg\.com\//i.test(c.previewUrl) ? `<img src="${escapeHtml(c.previewUrl)}" alt="Preview of Pin ${c.pinId}" width="400" height="300" loading="lazy">` : '<span class="preview-placeholder">Preview unavailable</span>'}</div><div class="candidate-copy"><label class="candidate-title"><input data-pin="${c.pinId}" type="checkbox" aria-label="Select Pin ${c.pinId}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}><span>Pin ${c.pinId}</span></label><span class="candidate-state ${outcome}">${label}</span><a class="pin-link" href="https://www.pinterest.com/pin/${c.pinId}/" target="_blank" rel="noopener">View on Pinterest ↗<span class="sr-only"> (opens a new tab)</span></a>${outcome === "failed" ? `<button class="button" data-retry="${c.pinId}">Retry</button>` : ""}</div></article>`;
  }

  function sessionHtml(s) {
    if (["results", "import-incomplete", "importing"].includes(s.status)) return resultHtml(s);
    const items = Object.values(s.candidates);
    const canResume = !s.importStartedAt && ["paused", "ready-to-import", "reviewing"].includes(s.status);
    const activeScan = list().some((item) => item.status === "scanning");
    const allResolved = items.length > 0 && items.every((c) => c.result || ["duplicate", "in-trash"].includes(c.eligibility));
    const canDone = !s.pendingPinIds?.length && !s.results.failed && (s.status === "results" || (s.status === "reviewing" && (s.importStartedAt || allResolved)));
    return `<section class="panel-card" aria-label="Import Session"><div class="session-title"><h2>${labels[s.status] || s.status}</h2><span class="status ${s.status}">${s.scanComplete ? "End confirmed" : "Partial"}</span></div><div class="source-label">Session source · ${s.surfaceKind === "saved-root" ? "Saved Pins" : "Board"}</div><span class="source-url">${escapeHtml(s.surfaceKey)}</span>
      ${!sourceMatches(s) ? '<p class="notice">These candidates belong to the source above, not the page currently open. Review is still available. Resume needs the original tab and collection.</p>' : ""}
      ${s.status === "scanning" ? `<p class="notice">Keep this Pinterest tab and page unchanged. Do not switch tabs or open a Pin while scanning.</p><p><span class="scan-count">${items.length}</span> Pins found</p><button class="button primary" data-action="STOP_REVIEW">Stop & review</button>` : `<div class="summary-grid">${[["Total",items.length],["New",items.filter(c=>c.eligibility==="new"&&!c.result).length],["Imported",s.results.imported]].map(([label,count])=>`<div><strong>${count}</strong><span>${label}</span></div>`).join("")}</div><p class="muted">${s.scanComplete ? "Collection end confirmed for this scan." : "Partial scan: you can import the Pins already found."}</p><details class="disclosure"><summary>Other scan details</summary><p>${s.results.duplicate} already in PinRef · ${s.results.inTrash} in Trash · ${s.results.failed} failed · ${s.skippedIdentity || 0} skipped identity · ${s.skippedMembership || 0} outside this collection</p></details>`}
      ${s.status === "reviewing" ? `<div class="candidate-toolbar"><strong>${s.selectedPinIds.length} selected</strong><p class="muted">Only selected new candidates are added to your Library.</p><div class="actions"><button class="button" data-action="SELECT_ALL_NEW">Select all new</button><button class="button quiet" data-action="CLEAR_SELECTION">Deselect all new</button><button class="button primary" data-action="IMPORT_SELECTED" ${s.selectedPinIds.length ? "" : "disabled"}>Import selected (${s.selectedPinIds.length})</button></div></div>` : ""}
      ${s.status === "importing" ? `<p class="notice">Saving selected Pins… ${s.pendingPinIds?.length || 0} remaining. You can close this panel; confirmed writes will continue.</p>` : ""}
      <div class="actions">${canResume ? `<button class="button" data-action="RESUME" ${sourceMatches(s) && !activeScan ? "" : "disabled"}>Resume from top</button>` : ""}${s.status === "results" && items.some((c)=>!c.result && c.eligibility === "new") ? '<button class="button" data-action="BEGIN_REVIEW">Review remaining</button>' : ""}${canDone ? '<button class="button primary" data-action="DONE">Done</button>' : ""}${!["scanning","importing"].includes(s.status) ? '<button class="button quiet" data-action="DISMISS">Dismiss session</button>' : ""}</div>
      <div class="import-candidates">${items.filter((c)=>!c.result).map((c)=>candidateHtml(s,c)).join("") || '<p class="empty-review">No remaining candidates to select.</p>'}</div></section>`;
  }

  function resultHtml(s) {
    const items = Object.values(s.candidates);
    const failed = items.filter((c) => c.result === "failed");
    const remaining = items.filter((c) => !c.result && c.eligibility === "new" && !s.pendingPinIds?.includes(c.pinId));
    const saving = s.status === "importing";
    const heading = saving ? "Saving selected Pins…" : failed.length ? "Some Pins need retry" : "Import results";
    return `<section class="panel-card" aria-label="Import Session">
      <h2 class="result-heading" tabindex="-1" data-result-heading>${heading}</h2>
      <div class="result-summary"><strong>${s.results.imported} ${s.results.imported === 1 ? "Pin" : "Pins"} added to Library</strong><p>${saving ? `${s.pendingPinIds?.length || 0} still saving. You can close this panel; confirmed writes will continue.` : failed.length ? `${failed.length} could not be saved. Retry them below; successful imports are safe.` : "Your import is saved. These Pins are no longer in the selection list."}</p></div>
      <a class="button" href="../dashboard/index.html" target="_blank" rel="noopener">View Library ↗<span class="sr-only"> (opens a new tab)</span></a>
      ${remaining.length ? `<p class="notice">${remaining.length} unselected ${remaining.length === 1 ? "Pin remains" : "Pins remain"} — nothing else will be imported automatically.</p>` : ""}
      ${!saving ? `<div class="actions">${!failed.length ? '<button class="button primary" data-action="DONE">Done</button>' : ""}${!failed.length && remaining.length ? '<button class="button" data-action="BEGIN_REVIEW">Review remaining</button>' : ""}${failed.length ? '<button class="button quiet" data-action="DISMISS">Dismiss session</button>' : ""}</div>` : ""}
      ${failed.length ? `<section class="failed-results" aria-label="Failed imports"><h3>Retry failed Pins</h3>${failed.map((c)=>`<div class="failed-result"><span>Pin ${escapeHtml(c.pinId)}<small>Not saved to Library</small></span><button class="button" data-retry="${escapeHtml(c.pinId)}" ${saving ? "disabled" : ""}>Retry<span class="sr-only"> Pin ${escapeHtml(c.pinId)}</span></button></div>`).join("")}</section>` : ""}
      <details class="disclosure"><summary>Source & scan details</summary><div class="source-label">Session source · ${s.surfaceKind === "saved-root" ? "Saved Pins" : "Board"}</div><span class="source-url">${escapeHtml(s.surfaceKey)}</span><p>${s.scanComplete ? "Collection end confirmed for this scan." : "Partial scan: the collection’s end was not confirmed. This does not affect Pins already saved to Library."}</p><p>${items.length} observed · ${s.results.duplicate} already in PinRef · ${s.results.inTrash} in Trash · ${s.skippedIdentity || 0} skipped identity · ${s.skippedMembership || 0} outside the collection</p></details>
    </section>`;
  }

  function render() {
    if (!view.remote) { feedback.textContent = view.message; return; }
    if(PinRefUI.deferRender(render))return;
    if(view.remote.preferences?.theme)setTheme(view.remote.preferences.theme);
    document.body.dataset.panelMode=view.mode;
    const heading=view.mode==="import"?"Import from Pinterest":view.mode==="pin"?"This Pin":view.mode==="dashboard-inspector"?"Inspector":"PinRef";
    document.querySelector("#mode-heading").textContent=heading;
    document.querySelector("#mode-context").textContent=view.manualSessionId?"Reviewing an import":view.mode==="idle"?"No available task":view.mode==="pin"?"Current Pinterest tab":kindLabels[view.remote.source.kind] || "Collection";
    document.title=`PinRef · ${heading}`;
    if(view.mode==="dashboard-inspector"){
      let frame=root.querySelector(".dashboard-inspector-frame");
      if(!frame){root.innerHTML='<iframe class="dashboard-inspector-frame" title="Dashboard Inspector" src="../dashboard/index.html?inspector=1"></iframe><div class="dashboard-inspector-sessions"></div>';frame=root.querySelector(".dashboard-inspector-frame");}
      const sessions=root.querySelector(".dashboard-inspector-sessions");sessions.innerHTML=sessionChooser();
      const sync=()=>frame.contentWindow?.postMessage({type:"pinref:inspector-selection",pinIds:view.remote.dashboardInspector.pinIds,activePinId:view.remote.dashboardInspector.activePinId},location.protocol==="file:"?"*":location.origin);
      frame.onload=sync;sync();
      bind();feedback.textContent=view.message;return;
    }
    if(view.mode==="pin"){
      PinRefUI.preserveRender(root,()=>{root.innerHTML=(view.captureFocus && view.remote.source.surface ? '<button class="button quiet back-to-page" data-return-to-page>← Back to this collection</button>' : "")+contextView.html()+sessionChooser()+settingsHtml();contextView.bind(root);bind();});
      feedback.textContent=view.message;return;
    }
    const active = document.activeElement;
    const attribute = [...(active?.attributes || [])].find((a)=>["data-action","data-pin","data-session","data-permission","data-running","data-retry"].includes(a.name));
    if (attribute) view.focus = `[${attribute.name}="${CSS.escape(attribute.value)}"]`;
    const scroll = window.scrollY;
    const s=view.mode==="import"?current():null;
    const source=view.remote.source;
    root.innerHTML = view.mode==="idle" ? idleHtml()+sessionChooser()+settingsHtml() : `${view.manualSessionId && (!source.surface || !sourceMatches(s)) ? `<button class="button quiet back-to-page" data-return-to-page>← ${source.surface?"Scan current collection":"Back to current page"}</button>` : ""}
      ${source.surface ? s ? `<details id="current-source" ${view.sourceDetailsOpen ? "open" : ""}><summary>Current collection & new scan</summary>${sourceHtml()}</details>` : sourceHtml() : ""}
      ${sessionChooser()}${s ? sessionHtml(s) : ""}${settingsHtml()}`;
    if (pendingPermission) root.insertAdjacentHTML("afterbegin", `<section class="panel-card" aria-label="Scan permission"><h2>Pinterest access needed</h2><p>Allow PinRef to read Pinterest collections for this scan and future scans. You can revoke access in Settings. Pinterest will not be changed.</p><span class="source-url">${escapeHtml(pendingPermission.surfaceKey)}</span><div class="actions"><button class="button primary" data-allow-scan>Allow access & ${pendingPermission.type === "RESUME" ? "resume" : "start"} scan</button><button class="button quiet" data-cancel-permission>Not now</button></div></section>`);
    if (view.busy) root.querySelectorAll("button,input").forEach((el)=>{el.disabled=true;});
    feedback.textContent = view.message;
    bind();
    if (!view.busy && view.focus) root.querySelector(view.focus)?.focus({preventScroll:true});
    window.scrollTo(0,scroll);
    root.querySelectorAll("img").forEach((img)=>img.addEventListener("error",()=>{const fallback=document.createElement("span");fallback.className="preview-placeholder";fallback.textContent="Preview unavailable";img.replaceWith(fallback);},{once:true}));
  }

  // Ask the embedded Dashboard Inspector to commit pending Note text before it is removed.
  function flushInspectorFrame() {
    const frame=root.querySelector(".dashboard-inspector-frame");
    if(!frame?.contentWindow)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{window.removeEventListener("message",listener);clearTimeout(timer);resolve();};
      const listener=event=>{if(event.source===frame.contentWindow&&event.data?.type==="pinref:inspector-flushed")done();};
      const timer=setTimeout(done,1500);
      window.addEventListener("message",listener);
      frame.contentWindow.postMessage({type:"pinref:inspector-flush"},location.protocol==="file:"?"*":location.origin);
    });
  }

  async function refresh() {
    if (loading) { refreshAgain = true; return; }
    loading = true;
    try {
      const result = await chrome.runtime.sendMessage({ type:"pinref:getPanelState", windowId });
      if (!result?.ok) throw new Error("unavailable");
      view.remote = result;
      let permissionSourceChanged=false;
      if (pendingPermission && (pendingPermission.tabId !== result.source.tabId || pendingPermission.surfaceKey !== result.source.surface?.surfaceKey)) {
        pendingPermission=null;
        permissionSourceChanged=true;
        view.message="The source changed. Choose Start or Resume on the intended collection.";
      }
      const identity=sourceIdentity(result.source);
      if (view.sourceIdentity !== identity) {
        if (view.sourceIdentity !== null) {
          await contextView.flush();
          view.manualSessionId=null;
          if (!view.captureJustStarted) view.captureFocus=false;
          if (!permissionSourceChanged) view.message="";
        }
        view.sourceIdentity=identity;
        view.sessionId=list().find(sourceMatches)?.sessionId || null;
        view.sourceDetailsOpen=!view.sessionId;
      }
      view.captureJustStarted=false;
      if (view.sessionId && !current()) { view.sessionId=null; view.sourceDetailsOpen=true; }
      if (view.manualSessionId && !view.remote.sessions?.[view.manualSessionId]) view.manualSessionId=null;
      const nextMode=view.captureFocus ? "pin" : view.manualSessionId ? "import" : pageMode(result.source,result);
      if(view.mode==="dashboard-inspector"&&nextMode!=="dashboard-inspector"){
        await flushInspectorFrame();
        // Floating moved the Inspector onto the Dashboard. The panel closes itself because the
        // embedded Inspector that asked for Floating may be removed before its own close call runs.
        if(result.dashboardInspector&&result.preferences?.inspectorMode==="floating"&&chrome.sidePanel?.close){
          chrome.sidePanel.close({windowId}).catch(()=>{view.mode=nextMode;render();});
          return;
        }
      }
      view.mode=nextMode;
      const s = current();
      if (!view.busy && s && ["paused","ready-to-import"].includes(s.status)) {
        const reviewed = await send({type:"BEGIN_REVIEW",sessionId:s.sessionId});
        if (reviewed?.ok) view.remote.sessions[s.sessionId] = reviewed.session;
      }
      render();
    } catch { view.message="Could not refresh PinRef. Reopen the panel to reconnect. Your stored sessions are kept."; render(); }
    finally { loading=false; if(refreshAgain){refreshAgain=false;refresh();} }
  }

  async function act(type, extra={}) {
    if (view.busy) return;
    const s = current();
    if (type === "DONE" && !confirm("Finish this session? Unselected candidates and temporary Board context will be removed. Imported References stay in your Library.")) return;
    if (type === "DISMISS" && !confirm("Dismiss this session and remove its candidates? Imported References stay in your Library.")) return;
    pendingPermission=null;
    const attempt = {type, extra:{sessionId:s?.sessionId,...extra}, tabId:view.remote.source.tabId, surfaceKey:view.remote.source.surface?.surfaceKey};
    view.busy=true; view.message=type === "IMPORT_SELECTED" ? "Importing selected Pins…" : "Updating session…"; render();
    try {
      const result=await send({type,sessionId:s?.sessionId,...extra});
      if (!result?.ok) {
        if (result?.reason === "permission-required" && ["START","RESUME"].includes(type)) pendingPermission=attempt;
        view.message=errors[result?.reason] || "This action could not finish. Reopen the panel to recover saved progress, then try again.";
      }
      else {
        view.message=type === "DONE" ? "Session finished. Imported References are in your Library." : ["IMPORT_SELECTED","RETRY"].includes(type) ? `${result.session.results.imported} added to Library. ${result.session.results.failed} failed.` : "";
        view.sessionId=["DONE","DISMISS"].includes(type) ? null : result.session?.sessionId || view.sessionId;
        if (["DONE","DISMISS"].includes(type)) view.manualSessionId=null;
        if(type === "START") view.sourceDetailsOpen=false;
      }
    } catch { view.message="Connection interrupted. Reopen the panel to see saved progress."; }
    finally {
      view.busy=false; await refresh();
      if (pendingPermission) { view.focus=null; root.querySelector("[data-allow-scan]")?.focus(); }
      if (["IMPORT_SELECTED","RETRY"].includes(type)) {
        const heading=root.querySelector("[data-result-heading]");
        if (heading) { view.focus=null; heading.focus(); }
      }
    }
  }

  function bind() {
    root.querySelector("#current-source")?.addEventListener("toggle",e=>{view.sourceDetailsOpen=e.target.open;});
    root.querySelectorAll("[data-session]").forEach((button)=>button.addEventListener("click",async()=>{await contextView.flush();view.sessionId=button.dataset.session;view.manualSessionId=button.dataset.session;view.mode="import";view.sourceDetailsOpen=false;refresh();}));
    root.querySelector("[data-return-to-page]")?.addEventListener("click",()=>{view.manualSessionId=null;view.captureFocus=false;view.sessionId=list().find(sourceMatches)?.sessionId || null;view.sourceDetailsOpen=!view.sessionId;view.mode=pageMode(view.remote.source);render();});
    root.querySelectorAll("[data-action]").forEach((button)=>button.addEventListener("click",()=>{
      const type=button.dataset.action;
      act(type,type === "START" ? {tabId:view.remote.source.tabId,surfaceKey:view.remote.source.surface?.surfaceKey} : {});
    }));
    root.querySelectorAll("[data-pin]").forEach((input)=>input.addEventListener("change",()=>act("SET_SELECTED",{pinId:input.dataset.pin,selected:input.checked})));
    root.querySelectorAll("[data-retry]").forEach((button)=>button.addEventListener("click",()=>act("RETRY",{pinId:button.dataset.retry})));
    root.querySelector("[data-running]")?.addEventListener("click",e=>{act("STOP_REVIEW",{sessionId:e.currentTarget.dataset.running});});
    root.querySelector("[data-cancel-permission]")?.addEventListener("click",()=>{
      pendingPermission=null; view.message="Scan not started."; render();
      root.querySelector('[data-action="START"]')?.focus();
    });
    root.querySelector("[data-allow-scan]")?.addEventListener("click",async()=>{
      if(view.busy || !pendingPermission) return;
      const attempt=pendingPermission;
      view.busy=true;
      try {
        // Request directly from this click so Chrome retains the user gesture.
        const request=chrome.permissions.request({origins:["https://*.pinterest.com/*"]});
        render();
        const granted=await request;
        await refresh();
        view.busy=false;
        if (granted && pendingPermission===attempt) {
          await act(attempt.type,attempt.extra);
          return;
        }
        if (!granted) view.message="Access was not granted. No scan started. You can retry or choose Not now.";
      } catch {view.message="Could not request Pinterest access. No scan started. Please try again.";}
      finally {view.busy=false;render();}
    });
    root.querySelector("[data-revoke-permission]")?.addEventListener("click",async()=>{
      try {
        const removed=await chrome.permissions.remove({origins:["https://*.pinterest.com/*"]});
        view.message=removed ? "Pinterest access revoked." : "Permission was not changed.";
      } catch {view.message="Could not revoke Pinterest access. Try again in Settings.";}
      await refresh();
    });
  }

  function connect() {
    port=chrome.runtime.connect({name:"pinref:panel"});
    port.onMessage.addListener(message=>{if(message.type==="capture-started"){view.captureFocus=true;view.captureJustStarted=true;view.manualSessionId=null;}refresh();});
    port.onDisconnect.addListener(()=>{
      if (!closing && document.visibilityState === "visible") { view.message="Connection paused. Reconnecting…"; render(); setTimeout(()=>{if(!closing && document.visibilityState === "visible")connect();},500); }
    });
    port.postMessage({windowId});
  }
  window.addEventListener("pagehide",()=>{contextView.flush();closing=true;port?.disconnect();});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState === "hidden"){closing=true;port?.disconnect();}
    else {closing=false;view.sourceIdentity=null;view.captureFocus=false;view.manualSessionId=null;connect();}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area === "local" && changes.pinrefState) refresh();});
  connect();
})();
