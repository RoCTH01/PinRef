const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {webcrypto}=require("node:crypto");
function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
}

function createBrowser() {
  let disk = {};
  let failResult = false;
  const tabs = new Map([[41, { id:41, windowId:7, active:true, url:"https://www.pinterest.com/person/_pins/", title:"Saved Pins" }]]);
  const windows = new Map([[7, { id:7, focused:true }]]);
  const stopped = [];
  const url = (file) => `chrome-extension://pinref/${file}`;
  const chrome = {
    runtime:{ getURL:url, onMessage:event(), onConnect:event() },
    action:{ onClicked:event() },
    sidePanel:{ onClosed:event(), opened:[], options:new Map(), defaults:null, async setPanelBehavior(value){this.behavior=value;}, async setOptions(options){if(options.tabId===undefined)this.defaults=options;else this.options.set(options.tabId,options);}, async open(options){this.opened.push(options);} },
    tabs:{ onActivated:event(), onCreated:event(), onUpdated:event(), onRemoved:event(), async get(id){if(!tabs.has(id))throw new Error("closed");return tabs.get(id);}, async query(query){return [...tabs.values()].filter(tab=>(query.windowId === undefined || tab.windowId===query.windowId)&&(!query.active || tab.active));}, created:[], async create(options){this.created.push(options);return {id:999,...options};}, async sendMessage(id,message){if(message.type === "pinref:stopImportScan")stopped.push({id,...message});return {ok:true};} },
    windows:{ onFocusChanged:event(), async get(id){return windows.get(id);} },
    permissions:{ onRemoved:event(), async contains(){return true;} },
    scripting:{ async executeScript(){} },
    storage:{local:{async get(){return structuredClone(disk);},async set(value){
      if(failResult && Object.values(value.pinrefState.importSessions).some(s=>s.candidates["123456789"]?.result === "imported")){failResult=false;throw new Error("result persistence failed");}
      disk=structuredClone(value);
    }}}
  };
  // The worker reads the wall clock directly, so tests that depend on elapsed time move the clock here.
  let clockOffset=0;
  class ShiftedDate extends Date {
    constructor(...args){ args.length ? super(...args) : super(Date.now()+clockOffset); }
    static now(){ return Date.now()+clockOffset; }
  }
  const context=vm.createContext({chrome,console,URL,structuredClone,crypto:webcrypto,Date:ShiftedDate});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../extension",file),"utf8"),context));
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../extension/background.js"),"utf8"),context);
  const sender={url:url("sidepanel/index.html")};
  const connectPanel=()=>{
    const port={name:"pinref:panel",sender,onMessage:event(),onDisconnect:event(),postMessage(){},disconnect(){this.onDisconnect.emit();}};
    chrome.runtime.onConnect.emit(port);
    port.onMessage.emit({windowId:7});
    return port;
  };
  const port=connectPanel();
  const message=(value,from=sender)=>new Promise(resolve=>chrome.runtime.onMessage.emit(value,from,resolve));
  const command=(value)=>message({type:"pinref:importCommand",windowId:7,command:value});
  const state=()=>message({type:"pinref:getPanelState",windowId:7});
  const scan=(session,eventType,observations=[])=>message({type:"pinref:scanEvent",sessionId:session.sessionId,surfaceKey:session.surfaceKey,eventType,observations},{tab:tabs.get(41)});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {chrome,tabs,windows,port,command,state,scan,settle,stopped,message,url,connectPanel,advanceTime:ms=>{clockOffset+=ms;},failResultOnce:()=>{failResult=true;},getDisk:()=>structuredClone(disk)};
}

module.exports={createBrowser};

