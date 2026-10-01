/* Pinterest boundary: no Save simulation, network interception, or Pinterest mutations. */
(() => {
  "use strict";
  if(globalThis.__pinrefContext)return;
  globalThis.__pinrefContext=true;
  const attempts=new Map();
  let route=location.href,context=null,pickerContext=null,identityUnavailable=false;
  const pinId=value=>{try{const u=new URL(value,location.href);return u.protocol==="https:"&&/(^|\.)pinterest\.com$/i.test(u.hostname)?u.pathname.match(/^\/pin\/(?:[^/]*--)?(\d{6,})\/?$/)?.[1]||null:null;}catch{return null;}};
  const preview=root=>{const img=root?.querySelector('img[src*="i.pinimg.com"]');try{const u=new URL(img?.currentSrc||img?.src);return u.protocol==="https:"&&u.hostname==="i.pinimg.com"?u.href:null;}catch{return null;}};
  const labels=control=>[control?.getAttribute("aria-label"),control?.getAttribute("title"),control?.textContent].map(x=>String(x||"").replace(/\s+/g," ").trim());
  const boardSelector=control=>labels(control).some(x=>/select.*board|choose.*board|(?:選擇|选择).*(?:圖版|圖板|图板|看板)/i.test(x));
  const unsaved=control=>!boardSelector(control)&&labels(control).some(x=>/^(save|儲存|保存)$/i.test(x));
  const saved=control=>labels(control).some(x=>/^(saved|已儲存|已保存)$/i.test(x));
  const send=value=>chrome.runtime.sendMessage(value).catch(()=>({ok:false}));
  const visible=el=>Boolean(el?.getClientRects().length);
  function detail() {
    const id=pinId(location.href);if(!id)return null;
    const root=document.querySelector('[data-test-id="pin-closeup"], [data-test-id="closeup-body"], [data-test-id="pin-closeup-container"]');
    const controls=[...(root?.querySelectorAll('button,[role="button"]')||[])].filter(visible);
    const status=visible(document.querySelector('[data-test-id="pin-unavailable"]'))?"unavailable":controls.some(saved)?"saved":controls.some(unsaved)?"not-saved":"unknown";
    return {pinId:id,url:location.href,previewUrl:preview(root),kind:"detail",status};
  }
  function cardContext(control) {
    // A single card, never a feed/container that happens to contain just one link.
    const card=control.closest('[data-test-id="pin"], [data-test-id="pinWrapper"], [data-test-id="pin-wrapper"]');
    if(card){const ids=[...new Set([...card.querySelectorAll('a[href*="/pin/"]')].map(a=>pinId(a.href)).filter(Boolean))];if(ids.length===1)return {pinId:ids[0],url:location.href,previewUrl:preview(card),kind:"feed",card};return null;}
    const current=detail();
    const root=control.closest('[data-test-id="pin-closeup"], [data-test-id="closeup-body"], [data-test-id="pin-closeup-container"]');
    return current&&root ? {...current,card:root} : null;
  }
  function snapshot() {
    if(location.href!==route){route=location.href;context=null;pickerContext=null;identityUnavailable=false;}
    const current=detail()||context;
    return {ok:true,url:location.href,pinId:current?.pinId||null,previewUrl:current?.previewUrl||null,status:current?.status||"unknown",identityUnavailable};
  }
  function reportContext(){send({type:"pinref:contextChanged",...snapshot()});}
  function sameIdentity(live) {
    if(location.href!==live.route||!live.control.isConnected)return false;
    const current=cardContext(live.control);
    if(current)return current.pinId===live.pinId;
    if(!live.picker||!live.card?.isConnected||live.control.closest('[role="dialog"]')!==live.dialog)return false;
    const ids=[...new Set([...live.card.querySelectorAll('a[href*="/pin/"]')].map(a=>pinId(a.href)).filter(Boolean))];
    return pinId(location.href)===live.pinId || ids.length===1&&ids[0]===live.pinId;
  }
  async function inspect(live,timeout=false) {
    if(live.finished&&!timeout)return;
    if(sameIdentity(live)&&saved(live.control)) {
      live.finished=true;clearTimeout(live.timer);live.observer?.disconnect();
      return send({type:"pinref:captureEvidence",attemptId:live.attemptId,pinId:live.pinId,confirmed:true});
    }
    if(timeout){live.finished=true;live.observer?.disconnect();return send({type:"pinref:captureEvidence",attemptId:live.attemptId,pinId:live.pinId,confirmed:false});}
    return {ok:false};
  }
  document.addEventListener("click",event=>{
    const control=event.composedPath().find(el=>el instanceof Element&&el.matches('button,[role="button"]'));
    if(!control||control.matches(":disabled")||control.getAttribute("aria-disabled")==="true")return;
    const found=cardContext(control);
    if(boardSelector(control)&&found){pickerContext={...found,at:Date.now(),route:location.href};return;}
    if(!unsaved(control))return;
    const dialog=control.closest('[role="dialog"]');
    const fromPicker=!found&&dialog&&pickerContext?.route===location.href&&Date.now()-pickerContext.at<30000&&pickerContext.card?.isConnected;
    const source=found||(fromPicker?pickerContext:null);if(!source){identityUnavailable=true;context=null;reportContext();return;}
    identityUnavailable=false;
    if([...attempts.values()].some(a=>!a.finished&&a.pinId===source.pinId))return;
    context={pinId:source.pinId,url:location.href,previewUrl:source.previewUrl};reportContext();
    const attemptId=crypto.randomUUID();const live={...source,attemptId,control,dialog,picker:fromPicker,route:location.href,finished:false};attempts.set(attemptId,live);
    // Observe before async storage returns: a fast Pinterest transition must not be missed.
    const start=send({type:"pinref:captureStarted",attemptId,pinId:source.pinId,url:location.href,previewUrl:source.previewUrl});
    start.then(result=>{
      if(!result.ok){live.finished=true;return;}
      live.observer=new MutationObserver(()=>inspect(live));live.observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["aria-label","title"]});
      live.timer=setTimeout(()=>inspect(live,true),6000);inspect(live);
    });
  },true);
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.type==="pinref:contextSnapshot"){respond(snapshot());return;}
    if(message.type==="pinref:checkCapture"){
      const live=attempts.get(message.attemptId);
      if(!live){respond({ok:false,reason:"original-evidence-unavailable"});return;}
      inspect(live,true).then(respond);return true;
    }
    if(message.type==="pinref:pinEvidence"){
      const current=detail();respond(current&&current.pinId===message.pinId?{ok:true,...current}:{ok:false,reason:"identity-mismatch"});
    }
  });
  // Pinterest SPA navigation may not dispatch popstate. Poll identity only; never scan or scroll.
  setInterval(()=>{if(route!==location.href){snapshot();reportContext();}},600);
  reportContext();
})();
