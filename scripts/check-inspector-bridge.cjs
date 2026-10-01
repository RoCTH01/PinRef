const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {createBrowser}=require("./browser-fixture.cjs");

// Reproduces a Dashboard tab with its Docked Inspector and the native Side Panel
// open in the same browser window. The Inspector must have one owner, not two.
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PINREF_BROWSER,headless:true});
  const h=createBrowser(),context=await browser.newContext({viewport:{width:1200,height:900}}),pages=new Map(),errors=[];
  try {
    await context.route("https://i.pinimg.com/**",route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"/>'}));
    await context.exposeBinding("fixtureMessage",async({page,frame},message)=>{
      const surface=frame.url().includes("/dashboard/index.html")?"dashboard":pages.get(page);
      const sender={url:h.url(`${surface}/index.html`)};
      const result=await h.message(message,sender);
      // Chrome broadcasts storage.onChanged to every extension page and frame.
      if(!message.type.startsWith("pinref:get"))setTimeout(()=>{for(const other of pages.keys())for(const f of other.frames())f.evaluate(()=>window.fixtureNotify?.()).catch(()=>{});},0);
      return structuredClone(result);
    });
    let dashboardPort=null;
    await context.exposeBinding("fixtureDashboardPost",async({page},message)=>{
      if(!dashboardPort){
        const listeners=[],disconnect=[];
        dashboardPort={name:"pinref:dashboard",sender:{url:h.url("dashboard/index.html"),tab:h.tabs.get(41)},onMessage:{addListener(fn){listeners.push(fn);},emit(value){listeners.forEach(fn=>fn(value));}},onDisconnect:{addListener(fn){disconnect.push(fn);}},postMessage(value){page.evaluate(item=>window.fixtureDashboardNotify?.(item),value).catch(()=>{});},disconnect(){disconnect.forEach(fn=>fn());}};
        h.chrome.runtime.onConnect.emit(dashboardPort);
      }
      dashboardPort.onMessage.emit(message);
      setTimeout(()=>{for(const [other,surface] of pages)if(surface==="sidepanel")other.evaluate(()=>window.fixtureNotify?.()).catch(()=>{});},0);
    });
    const sidePanelCalls=[];
    // Mirror Chrome: open/close of the native Side Panel connects/disconnects the worker's panel port.
    await context.exposeBinding("fixtureSidePanel",async(_source,action)=>{
      sidePanelCalls.push(action);
      if(action==="close"&&h.port.connected!==false){h.port.connected=false;h.port.disconnect();}
      if(action==="open"&&h.port.connected===false){h.port=h.connectPanel();}
    });
    await context.addInitScript(()=>{
      const listeners=[];
      window.fixtureNotify=()=>listeners.forEach(fn=>fn({pinrefState:{}},"local"));
      window.chrome={runtime:{sendMessage:message=>window.fixtureMessage(message),connect:options=>{
        if(options?.name==="pinref:dashboard"){
          const messages=[];window.fixtureDashboardNotify=value=>messages.forEach(fn=>fn(value));
          return {onMessage:{addListener(fn){messages.push(fn);}},onDisconnect:{addListener(){}},postMessage:message=>window.fixtureDashboardPost(message),disconnect(){}};
        }
        return {onMessage:{addListener(fn){setTimeout(()=>fn({type:"ready"}),0);}},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}};
      }},tabs:{getCurrent:async()=>({id:41})},windows:{getCurrent:async()=>({id:7})},sidePanel:{open:async()=>window.fixtureSidePanel("open"),close:async()=>window.fixtureSidePanel("close")},storage:{onChanged:{addListener(fn){listeners.push(fn);}}},permissions:{request:async()=>true,remove:async()=>true}};
    });
    const {session}=await h.command({type:"START",tabId:41});
    await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789",previewUrl:"https://i.pinimg.com/one.png"}]);
    await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
    await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
    await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});
    await h.message({type:"pinref:libraryCommand",command:{type:"SET_PREFERENCE",key:"inspectorMode",value:"docked"}},{url:h.url("dashboard/index.html")});
    h.tabs.get(41).url=h.url("dashboard/index.html");
    const open=async surface=>{const page=await context.newPage();pages.set(page,surface);page.on("pageerror",error=>errors.push(error.message));await page.goto(pathToFileURL(path.resolve(__dirname,`../extension/${surface}/index.html`)).href);return page;};
    const dashboard=await open("dashboard"),panel=await open("sidepanel");
    await dashboard.locator('[data-select="123456789"]').click();
    const inspector=panel.frameLocator(".dashboard-inspector-frame");
    await inspector.getByRole("heading",{name:"Pin 123456789",exact:true}).waitFor({timeout:5000}).catch(()=>{});
    const surfaces={dashboardDocked:await dashboard.locator(".inspector-panel.docked").count(),nativePin:await inspector.getByRole("heading",{name:"Pin 123456789",exact:true}).count()};
    assert.deepEqual(surfaces,{dashboardDocked:0,nativePin:1},"Docked Inspector should be one native surface, not a Dashboard duplicate plus idle panel");
    assert.equal(await inspector.getByRole("textbox",{name:"Note for Pin 123456789"}).count(),1);

    // Float from the Docked Inspector: the Side Panel closes and the Inspector moves onto the Dashboard.
    await inspector.getByRole("button",{name:"Float Inspector",exact:true}).click();
    await dashboard.locator(".inspector-panel.floating").waitFor();
    assert.ok(sidePanelCalls.includes("close"),"Floating closes the Side Panel");
    assert.equal(h.getDisk().pinrefState.preferences.inspectorMode,"floating");

    // Closing keeps the placement; the extension action reopens it Floating.
    await dashboard.locator("[data-close-inspector]").click();
    await dashboard.waitForFunction(()=>!document.querySelector(".inspector-panel"));
    h.chrome.action.onClicked.emit(h.tabs.get(41));
    await dashboard.locator(".inspector-panel.floating").waitFor();
    assert.equal(h.getDisk().pinrefState.preferences.inspectorMode,"floating");

    // Dock again: the Side Panel opens and the Dashboard page renders no Inspector.
    await dashboard.locator(".inspector-panel [data-dock]").click();
    await dashboard.waitForFunction(()=>!document.querySelector(".inspector-panel"));
    assert.ok(sidePanelCalls.filter(call=>call==="open").length>=1,"Docking opens the Side Panel");
    assert.equal(h.getDisk().pinrefState.preferences.inspectorMode,"docked");

    // Leaving the Dashboard tab flushes Note text typed in the Docked Inspector before it is removed.
    await panel.evaluate(()=>window.fixtureNotify());
    const note=inspector.getByRole("textbox",{name:"Note for Pin 123456789"});
    await note.waitFor();
    await note.fill("Typed in the Docked Inspector");
    h.tabs.get(41).url="https://example.com/";
    await panel.evaluate(()=>window.fixtureNotify());
    await panel.waitForFunction(()=>!document.querySelector(".dashboard-inspector-frame"));
    assert.equal(h.getDisk().pinrefState.references["123456789"].note,"Typed in the Docked Inspector");

    assert.deepEqual(errors,[]);
    console.log("PASS: Docked Inspector in the Side Panel owns Dashboard selection; Float, close/reopen, Dock and Note flush on leave");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
