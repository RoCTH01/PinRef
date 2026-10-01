importScripts("import/domain.js", "import/application.js", "import/store.js", "library/application.js");

const repository = PinRefImportStore.createChromeRepository();
const panelPath = "sidepanel/index.html";
const panelPorts = new Map();
const dashboardPorts = new Map();
const tabContexts = new Map();
// Pins established by an explicit native Save on a tab's current route; they may differ from the route's Pin.
const capturedContexts = new Map();
const panelOpenIn = (windowId) => [...panelPorts.values()].includes(windowId);
const dashboardUrl = chrome.runtime.getURL("dashboard/index.html");
const isDashboardUrl = value => String(value || "").split(/[?#]/)[0] === dashboardUrl;
const isPinterestUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)pinterest\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
};
// The Side Panel exists only on Pinterest and the Dashboard (ADR-0012). Omitting `path` keeps
// the one global panel instance, which Chrome hides on disabled tabs and restores on return.
const panelAllowedFor = url => isPinterestUrl(url) || isDashboardUrl(url);
function syncPanelAvailability(tab) {
  if (!Number.isInteger(tab?.id)) return Promise.resolve();
  return chrome.sidePanel.setOptions({ tabId: tab.id, enabled: panelAllowedFor(tab.url) });
}
const dashboardSelectionFor = (tab) => {
  if (!tab || !isDashboardUrl(tab.url)) return null;
  const match=[...dashboardPorts.values()].find(item=>item.tabId===tab.id && item.windowId===tab.windowId);
  return match ? {pinIds:match.pinIds,activePinId:match.activePinId} : {pinIds:[],activePinId:null};
};
function notifyDashboards(windowId) {
  for (const [port,context] of dashboardPorts) if (context.windowId===windowId) {
    try {port.postMessage({type:"panel-visibility",open:panelOpenIn(windowId)});} catch { /* Disconnected ports are removed below. */ }
  }
}
const browser = {
  async getTab(tabId) { return chrome.tabs.get(tabId).catch(() => null); },
  async hasPinterestPermission() {
    return chrome.permissions.contains({ origins: ["https://*.pinterest.com/*"] });
  },
  async isActiveSurface(tabId, surfaceKey) {
    const tab = await this.getTab(tabId);
    if (!tab?.active || !panelOpenIn(tab.windowId)) return false;
    const window = await chrome.windows.get(tab.windowId).catch(() => null);
    return Boolean(window?.focused && PinRefImportDomain.importSurfaceForUrl(tab.url)?.surfaceKey === surfaceKey);
  },
  async ensureScanner(tabId) {
    const alive = await chrome.tabs.sendMessage(tabId, { type: "pinref:pingImportScanner" }).catch(() => null);
    if (alive?.ok) return true;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/import-scanner.js"] });
      return Boolean((await chrome.tabs.sendMessage(tabId, { type: "pinref:pingImportScanner" }))?.ok);
    } catch { return false; }
  },
  async startScanner(tabId, payload) {
    if (!await this.isActiveSurface(tabId, payload.surface.surfaceKey)) return { ok: false, reason: "source-not-active" };
    return chrome.tabs.sendMessage(tabId, { type: "pinref:startImportScan", ...payload }).catch(() => null);
  },
  async stopScanner(tabId, sessionId, reason) {
    return chrome.tabs.sendMessage(tabId, { type: "pinref:stopImportScan", sessionId, reason }).catch(() => null);
  }
};
const application = PinRefImportApplication.createImportApplication({ repository, browser });
const library = PinRefLibrary.createApplication({repository});
const startup = recoverWorker();
let commandQueue = startup.catch(console.error);

function executeSerial(command, target = application) {
  const next = commandQueue.then(() => target.execute(command));
  commandQueue = next.catch(() => {});
  return next;
}

async function recoverWorker() {
  await library.execute({type:"RECOVER_CAPTURES"});
  for (const attempt of Object.values((await repository.readState()).attempts)) {
    if(attempt.status==="confirmed") await library.execute({type:"COMMIT_CAPTURE",attemptId:attempt.attemptId}).catch(console.error);
  }
  for (const session of await repository.listSessions()) {
    if (session.status === "scanning") {
      await application.execute({ type: "INTERRUPT", sessionId: session.sessionId, reason: "service-worker-restart" });
    }
    if (session.pendingPinIds?.length) {
      await application.execute({ type: "RECOVER_WRITES", sessionId: session.sessionId });
    }
    if (["import-complete", "dismissed"].includes(session.status)) await repository.deleteSession(session.sessionId);
  }
}

function recoverPendingWrites() {
  const task = commandQueue.then(async () => {
    for (const session of await repository.listSessions()) {
      if (session.pendingPinIds?.length) await application.execute({ type: "RECOVER_WRITES", sessionId: session.sessionId });
      if (["import-complete", "dismissed"].includes(session.status)) await repository.deleteSession(session.sessionId);
    }
  });
  commandQueue = task.catch(console.error);
  return task;
}

async function interruptMatching(predicate, reason) {
  await commandQueue.catch(() => {});
  for (const session of await repository.listSessions()) {
    if (session.status === "scanning" && await predicate(session)) {
      await executeSerial({ type: "INTERRUPT", sessionId: session.sessionId, reason });
    }
  }
}

// A Floating Inspector never coexists with an open Side Panel: an open Side Panel over
// the Dashboard tab means the Inspector is Docked (ADR-0013).
async function dockOverDashboard(windowId) {
  if (!panelOpenIn(windowId)) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!isDashboardUrl(tab?.url)) return;
  const state = await repository.readState();
  if (state.preferences?.inspectorMode !== "floating") return;
  await executeSerial({ type: "SET_PREFERENCE", key: "inspectorMode", value: "docked" }, library);
}

function notifyPanels() {
  for (const port of panelPorts.keys()) {
    try { port.postMessage({ type: "source-changed" }); } catch { /* onDisconnect removes the closed panel. */ }
  }
}

async function panelState(windowId, attempt=0) {
  await startup.catch(() => {});
  const [state, tabs, permissionGranted] = await Promise.all([
    repository.readState(), chrome.tabs.query({ active: true, windowId }), browser.hasPinterestPermission()
  ]);
  const tab = tabs[0];
  const context=tab ? await contextForTab(tab) : null;
  const [activeNow]=await chrome.tabs.query({active:true,windowId});
  if(activeNow?.id!==tab?.id||activeNow?.url!==tab?.url){
    if(attempt<2)return panelState(windowId,attempt+1);
    return {...state,ok:true,sessions:state.importSessions,permissionGranted,context:null,dashboardInspector:dashboardSelectionFor(activeNow),
      source:{tabId:activeNow?.id,windowId,url:activeNow?.url||"",...PinRefImportDomain.pageContextForUrl(activeNow?.url)}};
  }
  return { ...state, ok: true, sessions: state.importSessions, permissionGranted,
    context,dashboardInspector:dashboardSelectionFor(tab),
    source: { tabId: tab?.id, windowId, url: tab?.url || "", ...PinRefImportDomain.pageContextForUrl(tab?.url) } };
}

async function contextForTab(tab) {
  if(PinRefImportDomain.pageContextForUrl(tab.url).kind==="outside-pinterest")return null;
  try {
    let result=await chrome.tabs.sendMessage(tab.id,{type:"pinref:contextSnapshot"}).catch(()=>null);
    if(!result?.url){await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content/context-pin.js"]});result=await chrome.tabs.sendMessage(tab.id,{type:"pinref:contextSnapshot"});}
    const latest=await browser.getTab(tab.id);
    if(latest?.url!==tab.url||result?.url!==tab.url)return null;
    const detail=PinRefImportDomain.pageContextForUrl(tab.url);
    const captured=capturedContexts.get(tab.id);
    const explicitSave=captured?.url===tab.url&&captured.pinId===result.pinId;
    if(detail.kind==="pin"&&result.pinId!==detail.pinId&&!explicitSave)return {pinId:detail.pinId,previewUrl:null};
    return result?.pinId?{pinId:result.pinId,previewUrl:PinRefLibrary.safePreview(result.previewUrl),status:result.status||"unknown"}:result?.identityUnavailable?{identityUnavailable:true}:null;
  } catch {
    const detail=PinRefImportDomain.pageContextForUrl(tab.url);
    return detail.kind==="pin"?{pinId:detail.pinId,previewUrl:null,accessUnavailable:true}:null;
  }
}

async function handleMessage(message, sender) {
  const senderPage=String(sender.url||"").split(/[?#]/)[0];
  const fromPanel = senderPage === chrome.runtime.getURL(panelPath);
  const fromDashboard = senderPage === chrome.runtime.getURL("dashboard/index.html");
  const fromPinterest=Number.isInteger(sender.tab?.id)&&(sender.frameId===0||sender.frameId===undefined)&&PinRefImportDomain.pageContextForUrl(sender.url||sender.tab.url).kind!=="outside-pinterest";
  if(message?.type==="pinref:contextChanged"&&fromPinterest){
    const tab=await browser.getTab(sender.tab.id);
    if(tab?.url!==message.url)return {ok:false,reason:"stale-context"};
    tabContexts.set(tab.id,{pinId:message.pinId,url:message.url});notifyPanels();return {ok:true};
  }
  if(message?.type==="pinref:captureStarted"&&fromPinterest){
    const tab=await browser.getTab(sender.tab.id);
    if(tab?.url!==message.url)return {ok:false,reason:"stale-context"};
    await interruptMatching(s=>s.originTabId===tab.id,"native-save");
    const result=await executeSerial({type:"BEGIN_CAPTURE",attemptId:message.attemptId,pinId:message.pinId,tabId:tab.id,documentId:sender.documentId,url:message.url,previewUrl:message.previewUrl},library);
    if(result.ok)capturedContexts.set(tab.id,{pinId:message.pinId,url:message.url});
    if(result.ok)for(const [port,windowId] of panelPorts)if(windowId===tab.windowId&&tab.active)port.postMessage({type:"capture-started"});
    return result;
  }
  if(message?.type==="pinref:captureEvidence"&&fromPinterest){
    const result=await executeSerial({type:"CAPTURE_OUTCOME",attemptId:message.attemptId,pinId:message.pinId,tabId:sender.tab.id,documentId:sender.documentId,confirmed:message.confirmed===true},library);
    if(result.ok&&message.confirmed===true)return executeSerial({type:"COMMIT_CAPTURE",attemptId:message.attemptId},library);
    return result;
  }
  if(message?.type==="pinref:checkCapture"&&(fromPanel||fromDashboard)){
    const attempt=(await repository.readState()).attempts[message.attemptId];
    if(!attempt)return {ok:false};
    return chrome.tabs.sendMessage(attempt.originTabId,{type:"pinref:checkCapture",attemptId:attempt.attemptId},{documentId:attempt.documentId}).catch(()=>({ok:false}));
  }
  if (message?.type === "pinref:getDashboardState" && fromDashboard) {
    const state = await repository.readState();
    return { ...state, ok: true };
  }
  if (message?.type === "pinref:clearDashboardSelection" && fromDashboard && Number.isInteger(message.windowId)) {
    const [tab]=await chrome.tabs.query({active:true,windowId:message.windowId});
    const match=[...dashboardPorts].find(([,item])=>item.windowId===message.windowId && item.tabId===tab?.id);
    if (!match || !isDashboardUrl(tab?.url)) return {ok:false,reason:"dashboard-not-active"};
    match[1].pinIds=[];match[1].activePinId=null;
    match[0].postMessage({type:"clear-selection"});notifyPanels();
    return {ok:true};
  }
  if (message?.type === "pinref:libraryCommand" && (fromDashboard || fromPanel)) {
    const command=message.command || {};
    const allowed=["SET_PREFERENCE","SAVE_NOTE","SAVE_NAME","CREATE_TAG","ASSIGN_TAG","EDIT_TAG","REORDER_TAGS","DELETE_TAGS","MERGE_TAG","UNDO_TAG_CHANGE","TRASH","RESTORE","PERMANENT_DELETE","COMMIT_CAPTURE","DISMISS_ATTEMPT"];
    if (!allowed.includes(command.type) || (!fromDashboard && ["TRASH","RESTORE","PERMANENT_DELETE","DELETE_TAGS","MERGE_TAG","REORDER_TAGS","DISMISS_ATTEMPT"].includes(command.type)) || (!fromDashboard&&command.type==="CREATE_TAG"&&!command.pinIds?.length)) return {ok:false,reason:"unavailable-command"};
    return executeSerial(command,library);
  }
  if (message?.type === "pinref:getPanelState" && fromPanel && panelOpenIn(message.windowId)) return panelState(message.windowId);
  if (message?.type === "pinref:scanEvent") {
    if (!Number.isInteger(sender.tab?.id)) return { ok: false, reason: "missing-origin-tab" };
    if (!["HEARTBEAT", "OBSERVE_BATCH", "END_RELIABLE", "END_UNCONFIRMED", "INTERRUPT", "SCAN_FAILED"].includes(message.eventType)) return { ok: false, reason: "invalid-scan-event" };
    const session = await repository.getSession(message.sessionId);
    if (!session || session.originTabId !== sender.tab.id || session.surfaceKey !== message.surfaceKey || session.status !== "scanning") return { ok: false, reason: "stale-scan" };
    if (!await browser.isActiveSurface(session.originTabId, session.surfaceKey)) {
      await executeSerial({ type: "INTERRUPT", sessionId: session.sessionId, reason: "source-not-active" });
      return { ok: false, reason: "source-not-active" };
    }
    const result = await executeSerial({ type: "SCAN_EVENT", sessionId: message.sessionId, tabId: sender.tab.id,
      surfaceKey: message.surfaceKey, eventType: message.eventType, observations: message.observations,
      skippedIdentity: message.skippedIdentity, skippedMembership: message.skippedMembership,
      evidence: message.evidence, reason: message.reason });
    return { ...result, continueScan: result.session?.status === "scanning" };
  }
  if (message?.type === "pinref:importCommand" && fromPanel && panelOpenIn(message.windowId)) {
    const command = message.command || {};
    const allowed = ["START", "RESUME", "STOP_REVIEW", "BEGIN_REVIEW", "SET_SELECTED", "SELECT_ALL_NEW", "CLEAR_SELECTION", "IMPORT_SELECTED", "RETRY", "DONE", "DISMISS"];
    if (!allowed.includes(command.type)) return { ok: false, reason: "unknown-command" };
    if (["START", "RESUME"].includes(command.type)) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
      const session = command.type === "RESUME" ? await repository.getSession(command.sessionId) : null;
      if (!tab || tab.id !== (session ? session.originTabId : command.tabId)) return { ok: false, reason: "source-not-active" };
    }
    return executeSerial(command);
  }
  return { ok: false, reason: "unavailable-command" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: String(error) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "pinref:dashboard" && isDashboardUrl(port.sender?.url)) {
    port.onMessage.addListener(async message=>{
      if (!Number.isInteger(message.windowId) || !Number.isInteger(message.tabId)) return;
      const tab=await browser.getTab(message.tabId);
      if (!tab || tab.windowId!==message.windowId || !isDashboardUrl(tab.url)) return;
      const pinIds=[...new Set((Array.isArray(message.pinIds)?message.pinIds:[]).filter(id=>typeof id==="string"))];
      const activePinId=pinIds.includes(message.activePinId)?message.activePinId:pinIds[0]||null;
      const placement=message.placement==="floating"?"floating":"docked";
      const previous=dashboardPorts.get(port);
      dashboardPorts.set(port,{windowId:message.windowId,tabId:message.tabId,pinIds,activePinId,placement});
      if (!previous) port.postMessage({type:"panel-visibility",open:panelOpenIn(message.windowId)});
      if (!previous || previous.activePinId!==activePinId || previous.pinIds.join("|")!==pinIds.join("|")) notifyPanels();
    });
    port.onDisconnect.addListener(()=>{const previous=dashboardPorts.get(port);dashboardPorts.delete(port);if(previous)notifyPanels();});
    return;
  }
  if (port.name !== "pinref:panel" || port.sender?.url !== chrome.runtime.getURL(panelPath)) return;
  port.onMessage.addListener((message) => {
    if (Number.isInteger(message.windowId)) {
      panelPorts.set(port, message.windowId);
      notifyDashboards(message.windowId);
      dockOverDashboard(message.windowId).catch(console.error);
      recoverPendingWrites().catch(console.error).finally(() => {
        if (panelPorts.has(port)) port.postMessage({ type: "ready" });
      });
    }
  });
  port.onDisconnect.addListener(() => {
    const windowId = panelPorts.get(port);
    panelPorts.delete(port);
    notifyDashboards(windowId);
    if (!panelOpenIn(windowId)) interruptMatching((session) => session.originWindowId === windowId, "panel-closed").catch(console.error);
  });
});

// The action opens the Inspector in its remembered placement (ADR-0013). Chrome only allows
// sidePanel.open() synchronously within the click, so the Dashboard placement is read from its port.
// Elsewhere the Side Panel is unavailable, so the action opens Dashboard instead.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(syncPanelAvailability))).catch(console.error);
chrome.action.onClicked.addListener((tab) => {
  if (!panelAllowedFor(tab.url)) {
    chrome.tabs.create({ url: dashboardUrl, windowId: tab.windowId, index: tab.index + 1 }).catch(console.error);
    return;
  }
  const dashboard = [...dashboardPorts].find(([, item]) => item.tabId === tab.id && item.windowId === tab.windowId);
  if (dashboard?.[1].placement === "floating") {
    dashboard[0].postMessage({ type: "open-inspector" });
    return;
  }
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
chrome.sidePanel.onClosed.addListener(({ windowId }) => {
  for (const [port, owner] of panelPorts) {
    if (owner === windowId) { panelPorts.delete(port); port.disconnect(); }
  }
  notifyDashboards(windowId);
  interruptMatching((session) => session.originWindowId === windowId, "panel-closed").catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === "loading") syncPanelAvailability(tab).catch(console.error);
  if (change.url || change.status === "loading") {
    interruptMatching((session) => session.originTabId === tabId && (change.status === "loading" || PinRefImportDomain.importSurfaceForUrl(tab.url)?.surfaceKey !== session.surfaceKey), "navigation").catch(console.error);
  }
  if (change.url || change.title) notifyPanels();
  if (change.url && tab.active) dockOverDashboard(tab.windowId).catch(console.error);
  if(change.url){tabContexts.delete(tabId);capturedContexts.delete(tabId);}
  if(change.status==="loading")executeSerial({type:"INTERRUPT_CAPTURES",tabId},library).catch(console.error);
  if(change.status==="complete")browser.hasPinterestPermission().then(allowed=>{if(allowed)return contextForTab(tab);}).catch(console.error);
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  interruptMatching((session) => session.originWindowId === windowId && session.originTabId !== tabId, "tab-switch").catch(console.error);
  notifyPanels();
  dockOverDashboard(windowId).catch(console.error);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
  capturedContexts.delete(tabId);
  executeSerial({type:"INTERRUPT_CAPTURES",tabId},library).catch(console.error);
  interruptMatching((session) => session.originTabId === tabId, "tab-closed").catch(console.error);
  notifyPanels();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  interruptMatching((session) => session.originWindowId !== windowId, "loss-of-foreground-reliability").catch(console.error);
  notifyPanels();
});
chrome.permissions.onRemoved.addListener((permissions) => {
  if ((permissions.origins || []).some((origin) => origin.includes("pinterest.com"))) {
    interruptMatching(() => true, "permission-revoked").catch(console.error);
    notifyPanels();
  }
});
