const test = require("node:test");
const assert = require("node:assert/strict");
const {createBrowser}=require("../scripts/browser-fixture.cjs");
test("Library commands share imported records, keep the last committed Note and reject edits after Trash",async()=>{
  const h=createBrowser();
  const {session}=await h.command({type:"START",tabId:41});
  await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"}]);
  await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
  await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
  await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});
  const command=async c=>{
    if(["TRASH","RESTORE"].includes(c.type)){const s=await h.state(),source=c.type==="TRASH"?s.references:s.trash;c={...c,bases:Object.fromEntries(c.pinIds.map(id=>[id,{generation:source[id].generation,lifecycleRevision:source[id].lifecycleRevision}]))};}
    return h.message({type:"pinref:libraryCommand",command:c},{url:h.url("dashboard/index.html")});
  };
  const reference=(await h.state()).references["123456789"];
  const tagged=await command({type:"CREATE_TAG",name:"Inspiration",pinIds:["123456789"],bases:{"123456789":{generation:reference.generation,lifecycleRevision:0}}});
  assert.equal(tagged.ok,true);
  const tagId=tagged.tagId;
  const generation=(await h.state()).references["123456789"].generation;
  assert.equal((await command({type:"SAVE_NOTE",pinId:"123456789",text:"First note",lifecycleRevision:0,generation})).ok,true);
  const later=await command({type:"SAVE_NOTE",pinId:"123456789",text:"Written elsewhere",lifecycleRevision:0,generation});
  assert.equal(later.ok,true,"same-Note edits resolve as last committed write wins");
  const disk=h.getDisk().pinrefState;
  assert.equal(disk.references["123456789"].note,"Written elsewhere");
  assert.equal(disk.drafts,undefined,"Notes keep no stored drafts");
  assert.deepEqual(disk.references["123456789"].tags,[tagId]);
  assert.equal((await command({type:"SAVE_DRAFT",pinId:"123456789",text:"x"})).reason,"unavailable-command");
  assert.equal((await command({type:"TRASH",pinIds:["123456789"]})).ok,true);
  assert.equal((await command({type:"SAVE_NOTE",pinId:"123456789",text:"Too late",lifecycleRevision:0,generation})).reason,"reference-not-active");
  await command({type:"RESTORE",pinIds:["123456789"]});
  assert.equal((await command({type:"SAVE_NOTE",pinId:"123456789",text:"Stale lifecycle",lifecycleRevision:0,generation})).reason,"stale-reference");
  assert.equal(h.getDisk().pinrefState.references["123456789"].note,"Written elsewhere");
});

test("extension action opens the Docked Inspector outside Dashboard; active Saved Pins, individual Pin and outside pages are distinguished",async()=>{
  const h=createBrowser();
  assert.equal(h.chrome.sidePanel.behavior.openPanelOnActionClick,false);
  h.chrome.action.onClicked.emit(h.tabs.get(41));
  assert.equal(JSON.stringify(h.chrome.sidePanel.opened),JSON.stringify([{windowId:7}]));
  assert.equal((await h.state()).source.kind,"saved-root");
  // The Side Panel exists only on Pinterest and Dashboard; elsewhere the action opens Dashboard.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.chrome.sidePanel.options.get(41)?.enabled,true);
  const outside={id:42,windowId:7,index:1,active:false,url:"https://example.com/"};h.tabs.set(42,outside);
  h.chrome.tabs.onUpdated.emit(42,{url:outside.url},outside);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.chrome.sidePanel.options.get(42)?.enabled,false);
  assert.equal(h.chrome.sidePanel.options.get(42)?.path,undefined,"keeps the one global panel instance");
  h.chrome.action.onClicked.emit(outside);
  assert.equal(h.chrome.sidePanel.opened.length,1,"no Side Panel outside Pinterest and Dashboard");
  assert.equal(JSON.stringify(h.chrome.tabs.created),JSON.stringify([{url:h.url("dashboard/index.html"),windowId:7,index:2}]));
  const dashboardTab={id:43,windowId:7,index:2,active:false,url:h.url("dashboard/index.html")};h.tabs.set(43,dashboardTab);
  h.chrome.tabs.onUpdated.emit(43,{url:dashboardTab.url},dashboardTab);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.chrome.sidePanel.options.get(43)?.enabled,true);
  h.tabs.delete(42);h.tabs.delete(43);
  h.tabs.get(41).url="https://ca.pinterest.com/roahillust/_pins/";
  assert.equal((await h.state()).source.kind,"saved-root");
  h.tabs.get(41).url="https://ca.pinterest.com/roahillust/anomoly-design/";
  assert.equal((await h.state()).source.kind,"board");
  h.tabs.get(41).url="https://ca.pinterest.com/";
  assert.equal((await h.state()).source.kind,"unsupported");
  h.tabs.get(41).url="https://ca.pinterest.com/roahillust/_boards/";
  assert.equal((await h.state()).source.kind,"unsupported");
  h.tabs.get(41).url="https://www.pinterest.com/pin/123456789/";
  assert.equal((await h.state()).source.kind,"pin");
  assert.equal((await h.command({type:"START",tabId:41})).reason,"unsupported-surface");
  h.tabs.get(41).url="https://example.com/";
  assert.equal((await h.state()).source.kind,"outside-pinterest");
});

test("native Save pauses Import, binds capture evidence to its origin, and deduplicates local commits",async()=>{
  const h=createBrowser();const {session}=await h.command({type:"START",tabId:41});
  const sender={tab:h.tabs.get(41),documentId:"doc-a",frameId:0,url:h.tabs.get(41).url};
  const started=await h.message({type:"pinref:captureStarted",attemptId:"capture-1",pinId:"123456789",url:h.tabs.get(41).url},sender);
  assert.equal(started.ok,true);
  assert.equal((await h.state()).sessions[session.sessionId].status,"paused");
  assert.equal(Object.keys((await h.state()).references).length,0);
  const event={type:"pinref:captureEvidence",attemptId:"capture-1",pinId:"123456789",confirmed:true};
  assert.equal((await h.message(event,{...sender,documentId:"other-doc"})).ok,false);
  assert.equal((await h.message(event,sender)).ok,true);
  assert.equal(Object.keys((await h.state()).references).length,1);
  assert.equal(Object.keys((await h.state()).attempts).length,0);
});

test("tab titles are not exposed as collection metadata or recorded on new sessions",async()=>{
  const h=createBrowser();
  Object.assign(h.tabs.get(41), {title:"(79) Pinterest",url:"https://ca.pinterest.com/roahillust/anomoly-design/"});
  const state=await h.state();
  assert.equal(state.source.kind,"board");
  assert.equal(state.source.title,undefined);
  assert.equal(Object.keys(state.sessions).length,0);
  const {session}=await h.command({type:"START",tabId:41});
  assert.equal(session.sourceTitle,undefined);
  assert.equal(session.surfaceKey,state.source.surface.surfaceKey);
});

test("panel controls do not interrupt a scan, but closing it preserves Partial and stops its scanner",async()=>{
  const h=createBrowser();
  const started=await h.command({type:"START",tabId:41});
  assert.equal(started.ok,true);
  assert.equal((await h.scan(started.session,"HEARTBEAT")).continueScan,true);
  await h.scan(started.session,"OBSERVE_BATCH",[{pinId:"123456789"}]);
  h.chrome.sidePanel.onClosed.emit({windowId:7});
  await h.settle();
  const s=h.getDisk().pinrefState.importSessions[started.session.sessionId];
  assert.equal(s.status,"paused");
  assert.equal(s.stopReason,"panel-closed");
  assert.equal(Object.keys(s.candidates).length,1);
  assert.equal(h.stopped.length,1);
});

test("switching surfaces pauses, and a new tab at the same URL cannot resume the original session",async()=>{
  const h=createBrowser();
  const original=h.tabs.get(41).url;
  const {session}=await h.command({type:"START",tabId:41});
  h.tabs.get(41).url="https://www.pinterest.com/pin/123456789/";
  h.chrome.tabs.onUpdated.emit(41,{url:h.tabs.get(41).url},h.tabs.get(41));
  await h.settle();
  assert.equal((await h.state()).sessions[session.sessionId].status,"paused");
  h.tabs.delete(41);
  h.tabs.set(42,{id:42,windowId:7,active:true,url:original});
  assert.equal((await h.command({type:"RESUME",sessionId:session.sessionId})).reason,"source-not-active");
  assert.equal((await h.state()).sessions[session.sessionId].originTabId,41);
});

test("foreground window loss pauses while activation in an unrelated background window does not",async()=>{
  const h=createBrowser();
  const {session}=await h.command({type:"START",tabId:41});
  h.chrome.tabs.onActivated.emit({tabId:99,windowId:8});
  await h.settle();
  assert.equal((await h.state()).sessions[session.sessionId].status,"scanning");
  h.windows.get(7).focused=false;
  h.chrome.windows.onFocusChanged.emit(-1);
  await h.settle();
  assert.equal((await h.state()).sessions[session.sessionId].stopReason,"loss-of-foreground-reliability");
});

test("Dashboard cannot execute Import commands and panel review survives permission revocation",async()=>{
  const h=createBrowser();
  assert.equal((await h.message({type:"pinref:importCommand",windowId:7,command:{type:"START",tabId:41}},{url:h.url("dashboard/index.html")})).ok,false);
  const {session}=await h.command({type:"START",tabId:41});
  await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"}]);
  await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
  await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
  h.chrome.permissions.onRemoved.emit({origins:["https://*.pinterest.com/*"]});
  await h.settle();
  const result=await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});
  assert.equal(result.session.results.imported,1);
  assert.equal(result.session.status,"results");
});

test("reopening the panel recovers confirmed writes whose result failed to persist without waiting for worker restart",async()=>{
  const h=createBrowser();
  const {session}=await h.command({type:"START",tabId:41});
  await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"}]);
  await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
  await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
  h.failResultOnce();
  assert.equal((await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId})).ok,false);
  h.port.disconnect();
  h.connectPanel();
  await h.settle();
  const state=await h.state();
  assert.equal(state.sessions[session.sessionId].status,"results");
  assert.equal(Object.keys(state.references).length,1);
});

test("Inspector Placement: the action reopens a Floating Inspector on Dashboard, and an open Side Panel over Dashboard means Docked",async()=>{
  const h=createBrowser();
  const dashboardUrl=h.url("dashboard/index.html");
  const library=command=>h.message({type:"pinref:libraryCommand",command},{url:dashboardUrl});
  await library({type:"SET_PREFERENCE",key:"inspectorMode",value:"floating"});
  h.port.disconnect();
  const tab=h.tabs.get(41);
  tab.url=dashboardUrl;
  const received=[];
  const listeners=[];
  const dashboardPort={name:"pinref:dashboard",sender:{url:dashboardUrl,tab},
    onMessage:{addListener(fn){listeners.push(fn);}},onDisconnect:{addListener(){}},
    postMessage(value){received.push(value.type);},disconnect(){}};
  h.chrome.runtime.onConnect.emit(dashboardPort);
  await Promise.all(listeners.map(fn=>fn({windowId:7,tabId:41,pinIds:[],activePinId:null,placement:"floating"})));

  h.chrome.action.onClicked.emit(tab);
  assert.ok(received.includes("open-inspector"),"Floating placement reopens on the Dashboard page");
  assert.equal(h.chrome.sidePanel.opened.length,0,"Floating placement never opens the Side Panel");

  h.connectPanel();
  await h.settle();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await h.state()).preferences.inspectorMode,"docked","opening the Side Panel over Dashboard docks the Inspector");
});

test("Side Panel availability is reconciled on tab activation and creation, and the global panel instance stays openable",async()=>{
  const h=createBrowser();
  const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
  await settle();
  // Disabling the global options would disable the one panel instance and leave sidePanel.open with nothing to open.
  assert.equal(h.chrome.sidePanel.defaults,null,"availability is per tab, never a global disable");
  // Switching tabs is the gesture that hides the Side Panel, so activation alone must reconcile it.
  const outside={id:52,windowId:7,index:1,active:false,url:"https://example.com/"};
  h.tabs.set(52,outside);
  h.chrome.tabs.onActivated.emit({tabId:52,windowId:7});
  await settle();
  assert.equal(h.chrome.sidePanel.options.get(52)?.enabled,false);
  const pinTab={id:53,windowId:7,index:2,active:false,url:"https://ca.pinterest.com/pin/123456789/"};
  h.tabs.set(53,pinTab);
  h.chrome.tabs.onCreated.emit(pinTab);
  await settle();
  assert.equal(h.chrome.sidePanel.options.get(53)?.enabled,true);
  assert.equal(h.chrome.sidePanel.options.get(53)?.path,undefined,"keeps the one global panel instance");
  h.chrome.tabs.onActivated.emit({tabId:53,windowId:7});
  await settle();
  assert.equal(h.chrome.sidePanel.options.get(53)?.enabled,true);
  h.chrome.action.onClicked.emit(h.tabs.get(53));
  assert.equal(JSON.stringify(h.chrome.sidePanel.opened),JSON.stringify([{windowId:7}]),"the action still opens the Side Panel on Pinterest");
  h.tabs.delete(52);h.tabs.delete(53);
});

test("Capture Attempts stay aligned with the Library: no Attempt for an existing Reference, and an Attempt resolves when its Pin arrives or leaves Trash",async()=>{
  const h=createBrowser();
  const sender={tab:h.tabs.get(41),documentId:"doc-a",frameId:0,url:h.tabs.get(41).url};
  const capture=async(attemptId,pinId,confirmed)=>{
    const started=await h.message({type:"pinref:captureStarted",attemptId,pinId,url:h.tabs.get(41).url},sender);
    await h.message({type:"pinref:captureEvidence",attemptId,pinId,confirmed},sender);
    return started;
  };
  const attempts=async()=>Object.values((await h.state()).attempts).map(a=>`${a.pinId}:${a.status}`).sort();

  // A Save that Pinterest never confirms leaves a retryable Attempt.
  await capture("capture-1","123456789",false);
  assert.equal(JSON.stringify(await attempts()),JSON.stringify(["123456789:unconfirmed"]));

  // Importing that Pin answers the Attempt: the Reference the user wanted now exists.
  const {session}=await h.command({type:"START",tabId:41});
  await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"}]);
  await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
  await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
  await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});
  assert.equal(JSON.stringify(await attempts()),JSON.stringify([]),"an Attempt whose Pin is now a Reference is resolved");

  // Saving again on Pinterest for a Pin already in the Library is a no-op, never a new Attempt.
  // Refusing the start is what stops the content script observing Pinterest for an outcome PinRef
  // would discard, so the no-op has to be visible in the answer, not only in the absence of state.
  assert.equal((await capture("capture-2","123456789",false)).ok,false,"a repeated Save for an existing Reference starts nothing");
  assert.equal(JSON.stringify(await attempts()),JSON.stringify([]));

  // A Pin in Trash is different: PinRef says so rather than silently resurrecting it.
  const lifecycle=async(type,pinId)=>{
    const record=(await h.state())[type==="TRASH"?"references":"trash"][pinId];
    return h.message({type:"pinref:libraryCommand",command:{type,pinIds:[pinId],
      bases:{[pinId]:{generation:record.generation,lifecycleRevision:record.lifecycleRevision}}}},{url:h.url("dashboard/index.html")});
  };
  await lifecycle("TRASH","123456789");
  await capture("capture-3","123456789",true);
  assert.equal(JSON.stringify(await attempts()),JSON.stringify(["123456789:in-trash"]));

  // Restoring it from Trash answers that Attempt too.
  await lifecycle("RESTORE","123456789");
  assert.equal(JSON.stringify(await attempts()),JSON.stringify([]),"an in-Trash Attempt is resolved once its Pin is restored");
});
