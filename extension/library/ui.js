/* Shared presentation helpers and Note autosave controller. Durable rules live in the worker. */
(function () {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const command = async command => {
    try { return await chrome.runtime.sendMessage({type:"pinref:libraryCommand",command}) || {ok:false,reason:"connection-unavailable"}; }
    catch { return {ok:false,reason:"local-write-failed"}; }
  };
  let renderingDepth=0;
  let pointerActive=false;
  const deferredRenders=new Set();
  const finishInteraction=()=>setTimeout(()=>{pointerActive=false;const pending=[...deferredRenders];deferredRenders.clear();pending.forEach(render=>render());},0);
  document.addEventListener("pointerdown",()=>{pointerActive=true;},true);
  document.addEventListener("pointerup",finishInteraction,true);
  document.addEventListener("pointercancel",finishInteraction,true);
  document.addEventListener("compositionend",finishInteraction,true);
  function deferRender(render){if(pointerActive||document.activeElement?.isComposing){deferredRenders.add(render);return true;}return false;}
  function image(record, className="") {
    const safe=/^https:\/\/i\.pinimg\.com\//i.test(record?.previewUrl || "");
    return `<div class="art ${className}">${safe ? `<img src="${escape(record.previewUrl)}" alt="Preview of Pin ${escape(record.pinId)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="preview-fallback">Preview unavailable</span>'}</div>`;
  }
  function preserveRender(root, render) {
    renderingDepth+=1;
    try {
    const active=document.activeElement;
    const key=active?.dataset.focus;
    const start=active?.selectionStart, end=active?.selectionEnd;
    const scroll=[...root.querySelectorAll("[data-scroll]")].map(el=>[el.dataset.scroll,el.scrollTop]);
    render();
    if (key) {
      const el=root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
      el?.focus({preventScroll:true});
      if (typeof start === "number" && el?.setSelectionRange && el.type !== "color") el.setSelectionRange(start,end);
    }
    scroll.forEach(([key,top])=>{const el=root.querySelector(`[data-scroll="${CSS.escape(key)}"]`);if(el)el.scrollTop=top;});
    root.querySelectorAll("img").forEach(img=>img.addEventListener("error",()=>{
      const text=document.createElement("span");text.className="preview-fallback";text.textContent="Preview unavailable";img.replaceWith(text);
    },{once:true}));
    } finally {renderingDepth-=1;}
  }
  // Notes autosave with no user-visible draft (ADR-0014). Uncommitted text lives only in
  // this editor until it commits; the last committed write wins across surfaces.
  function createNotes({getState, changed}) {
    const editors = new Map();
    let queue = Promise.resolve();

    function editor(pinId) {
      const record = getState().references[pinId];
      let e = editors.get(pinId);
      if (!e) {
        e = {pinId, text:record.note, dirty:false, saving:false, failed:false, base:null, status:"Saved", timer:null};
        editors.set(pinId, e);
      } else if (record && !e.dirty && !e.saving) {
        e.text = record.note;
      }
      return e;
    }

    function setStatus(e, input) {
      const status = (input?.closest(".detail-section") || document).querySelector(`[data-note-status="${CSS.escape(e.pinId)}"]`);
      status?.replaceChildren(document.createTextNode(e.status));
    }

    function save(e) {
      clearTimeout(e.timer);
      if (!e.dirty) return Promise.resolve(true);
      const task = queue.then(async () => {
        if (!e.dirty) return true;
        if (!getState().references[e.pinId]) {
          e.failed = true;
          e.status = "Save failed — this Reference is no longer in the Library";
          changed();
          return false;
        }
        const text = e.text;
        e.saving = true;
        e.status = "Saving…";
        changed();
        const result = await command({type:"SAVE_NOTE", pinId:e.pinId, text, lifecycleRevision:e.base.lifecycleRevision, generation:e.base.generation});
        e.saving = false;
        if (result.ok) {
          const current = getState().references[e.pinId];
          if (current?.generation === result.record.generation) {
            current.note = result.record.note;
            current.noteRevision = result.record.noteRevision;
          }
          e.dirty = e.text !== text;
          e.failed = false;
          if (!e.dirty) e.base = null;
          e.status = e.dirty ? "Saving…" : "Saved";
        } else {
          e.failed = true;
          e.status = "Save failed";
        }
        changed();
        return result.ok;
      });
      queue = task.catch(() => false);
      return task;
    }

    function html(pinId) {
      const e = editor(pinId);
      const retry = e.failed ? `<button class="quiet-button" data-note-retry="${escape(pinId)}">Retry<span class="sr-only"> saving Note for Pin ${escape(pinId)}</span></button>` : "";
      return `<section class="detail-section"><h3>Note <small>Pin ${escape(pinId)}</small></h3>`
        + `<textarea class="note-editor" data-note="${escape(pinId)}" data-focus="note-${escape(pinId)}" aria-label="Note for Pin ${escape(pinId)}" placeholder="No Note">${escape(e.text)}</textarea>`
        + `<small role="status" data-note-status="${escape(pinId)}">${escape(e.status)}</small>${retry}</section>`;
    }

    function bind(root) {
      root.querySelectorAll("[data-note]").forEach(input => {
        let composing = false;
        const update = () => {
          const e = editor(input.dataset.note);
          if (!e.dirty) {
            // Bind the edit to the Reference's current lifecycle so a write that lands after Trash is rejected.
            const record = getState().references[e.pinId];
            e.base = {lifecycleRevision:record.lifecycleRevision, generation:record.generation};
          }
          e.text = input.value;
          e.dirty = true;
          e.status = "Saving…";
          setStatus(e, input);
          clearTimeout(e.timer);
          if (!composing) e.timer = setTimeout(() => save(e), 650);
        };
        input.addEventListener("compositionstart", () => { composing = true; input.isComposing = true; });
        input.addEventListener("compositionend", () => { composing = false; input.isComposing = false; update(); });
        input.addEventListener("input", update);
        input.addEventListener("blur", () => { if (!composing && !renderingDepth) save(editor(input.dataset.note)); });
      });
      root.querySelectorAll("[data-note-retry]").forEach(el => el.onclick = () => {
        const e = editor(el.dataset.noteRetry);
        const record = getState().references[e.pinId];
        // An explicit Retry after Restore targets the same Reference generation again.
        if (e.base && record?.generation === e.base.generation) e.base.lifecycleRevision = record.lifecycleRevision;
        return save(e);
      });
    }

    async function flush() {
      const results = await Promise.all([...editors.values()].filter(e => e.dirty).map(e => save(e)));
      return results.every(Boolean);
    }

    return {html, bind, flush, hasDirty:() => [...editors.values()].some(e => e.dirty)};
  }
  function assignmentCommand(state,pinIds,tagId,assigned) {
    return {type:"ASSIGN_TAG",pinIds,tagId,assigned,bases:Object.fromEntries(pinIds.map(id=>[id,{revision:state.references[id].assignmentRevisions[tagId] || 0,lifecycleRevision:state.references[id].lifecycleRevision,generation:state.references[id].generation}]))};
  }
  function createTagCommand(state,pinIds,name){
    return {type:"CREATE_TAG",name,pinIds,bases:Object.fromEntries(pinIds.map(id=>[id,{generation:state.references[id].generation,lifecycleRevision:state.references[id].lifecycleRevision}]))};
  }
  function lifecycleCommand(state,type,pinIds){
    const source=type==="TRASH"?state.references:state.trash;
    return {type,pinIds,bases:Object.fromEntries(pinIds.map(id=>[id,{generation:source[id].generation,lifecycleRevision:source[id].lifecycleRevision}]))};
  }
  function drag(element, handle, enabled, moved) {
    handle?.addEventListener("pointerdown",event=>{
      if (!enabled() || event.target.closest("button,input") || event.button!==0) return;
      const box=element.getBoundingClientRect(), x=event.clientX, y=event.clientY;
      handle.setPointerCapture(event.pointerId);
      const move=e=>{
        const left=Math.max(8,Math.min(innerWidth-box.width-8,box.left+e.clientX-x));
        const top=Math.max(8,Math.min(innerHeight-box.height-8,box.top+e.clientY-y));
        Object.assign(element.style,{left:`${left}px`,top:`${top}px`,right:"auto",bottom:"auto",transform:"none"});
        moved?.({left,top});
      };
      const end=()=>{handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",end);handle.removeEventListener("pointercancel",end);};
      handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",end);handle.addEventListener("pointercancel",end);
    });
  }
  window.PinRefUI={escape,command,image,preserveRender,createNotes,assignmentCommand,createTagCommand,lifecycleCommand,drag,deferRender,isRendering:()=>renderingDepth>0};
})();
