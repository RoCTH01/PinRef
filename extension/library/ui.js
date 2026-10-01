/* Shared presentation helpers and Note draft controller. Durable rules live in the worker. */
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
  function createNotes({getState, changed}) {
    const ownerId=sessionStorage.getItem("pinref-editor") || crypto.randomUUID();
    sessionStorage.setItem("pinref-editor",ownerId);
    const editors=new Map();
    let queue=Promise.resolve();
    function editor(pinId) {
      const record=getState().references[pinId];
      let e=editors.get(pinId);
      if (!e) {
        const draft=Object.values(getState().drafts || {}).find(d=>d.pinId===pinId&&d.ownerId===ownerId);
        e={draftId:draft?.draftId || crypto.randomUUID(),pinId,text:draft?.text ?? record.note,
          baseRevision:draft?.baseRevision ?? record.noteRevision, lifecycleRevision:draft?.lifecycleRevision ?? record.lifecycleRevision,
          generation:draft?.generation || record.generation,dirty:Boolean(draft),status:draft ? "Draft restored — Retry to save" : "Saved",timer:null};
        editors.set(pinId,e);
      } else if (!e.dirty && !e.saving && record.noteRevision >= e.baseRevision) {
        e.text=record.note; e.baseRevision=record.noteRevision;e.lifecycleRevision=record.lifecycleRevision;e.generation=record.generation;
      }
      return e;
    }
    async function save(e, useMine=false) {
      clearTimeout(e.timer);
      if (!e.dirty) return true;
      // Snapshot at execution time so a queued idle save cannot overwrite newer typing.
      const task=queue.then(async()=>{
        if(!e.dirty)return true;
        const record=getState().references[e.pinId];
        if (!record) {e.status="Reference no longer active. Copy your draft before leaving.";changed();return false;}
        if (useMine) {e.baseRevision=record.noteRevision;e.lifecycleRevision=record.lifecycleRevision;}
        const text=e.text;
        e.saving=true;e.status="Saving…";changed();
        const result=await command({type:"SAVE_NOTE",ownerId,draftId:e.draftId,pinId:e.pinId,text,baseRevision:e.baseRevision,lifecycleRevision:e.lifecycleRevision,generation:e.generation});
        e.saving=false;
        if (result.ok) {
          e.baseRevision=result.record.noteRevision;
          const current=getState().references[e.pinId];
          if(current?.generation===result.record.generation&&current.noteRevision<=result.record.noteRevision){current.note=result.record.note;current.noteRevision=result.record.noteRevision;}
          e.dirty=e.text!==text;e.conflict=false;e.status=e.dirty ? "Unsaved changes" : "Saved";
        }
        else {e.status=result.reason==="note-conflict" ? "Updated elsewhere — your draft is kept" : "Could not save — your draft is kept";e.conflict=result.reason==="note-conflict";}
        changed();return result.ok;
      });
      queue=task.catch(()=>false);return task;
    }
    function html(pinId) {
      const e=editor(pinId);
      const latest=getState().references[pinId];
      const otherDrafts=Object.values(getState().drafts||{}).filter(d=>d.pinId===pinId&&d.draftId!==e.draftId);
      return `<section class="detail-section"><h3>Note <small>Pin ${escape(pinId)}</small></h3><textarea class="note-editor" data-note="${escape(pinId)}" data-focus="note-${escape(pinId)}" aria-label="Note for Pin ${escape(pinId)}" placeholder="No Note">${escape(e.text)}</textarea><small role="status">${escape(e.status)}</small>${e.dirty ? `<div class="editor-recovery"><button class="quiet-button" data-note-retry="${pinId}">${e.conflict ? "Use my draft" : "Retry save"}</button><button class="quiet-button" data-note-discard="${pinId}">${e.conflict ? "Use latest" : "Discard draft"}</button><button class="quiet-button" data-note-copy="${pinId}">Copy draft</button></div>${e.conflict ? `<details><summary>Latest committed Note</summary><p class="preserve-lines">${escape(latest.note || "No Note")}</p></details>` : ""}` : ""}${otherDrafts.map(d=>`<details><summary>Unsaved draft from another editor</summary><p class="preserve-lines">${escape(d.text)}</p><button class="quiet-button" data-recover-draft="${escape(d.draftId)}">Recover this draft</button><button class="quiet-button" data-delete-draft="${escape(d.draftId)}">Discard this draft</button></details>`).join("")}</section>`;
    }
    function bind(root) {
      root.querySelectorAll("[data-note]").forEach(input=>{
        let composing=false;
        const update=()=>{
          const e=editor(input.dataset.note);e.text=input.value;e.dirty=true;e.status="Unsaved changes";
          // Input is already visible: invalidate the old Saved label synchronously,
          // without rebuilding the focused textarea or waiting for storage events.
          input.closest(".detail-section")?.querySelector('[role="status"]')?.replaceChildren(document.createTextNode(e.status));
          clearTimeout(e.timer);
          // Persist the Local Draft before idle commit; the Reference still holds only committed text.
          queue=queue.then(()=>command({type:"SAVE_DRAFT",ownerId,draftId:e.draftId,pinId:e.pinId,text:e.text,baseRevision:e.baseRevision,lifecycleRevision:e.lifecycleRevision,generation:e.generation}));
          if(!composing)e.timer=setTimeout(()=>save(e),650);
        };
        input.addEventListener("compositionstart",()=>{composing=true;input.isComposing=true;});
        input.addEventListener("compositionend",()=>{composing=false;input.isComposing=false;update();});
        input.addEventListener("input",update);
        input.addEventListener("blur",()=>{if(!composing&&!renderingDepth)save(editor(input.dataset.note));});
      });
      root.querySelectorAll("[data-note-retry]").forEach(el=>el.onclick=()=>{const e=editor(el.dataset.noteRetry);return save(e,e.conflict===true);});
      root.querySelectorAll("[data-note-discard]").forEach(el=>el.onclick=async()=>{
        const e=editor(el.dataset.noteDiscard);clearTimeout(e.timer);
        await queue;
        const result=await command({type:"DISCARD_DRAFT",draftId:e.draftId});
        if(result.ok){e.dirty=false;e.conflict=false;e.status="Saved";editor(e.pinId);}changed();
      });
      root.querySelectorAll("[data-note-copy]").forEach(el=>el.onclick=async()=>{
        try {await navigator.clipboard.writeText(editor(el.dataset.noteCopy).text);}
        catch {const input=root.querySelector(`[data-note="${el.dataset.noteCopy}"]`);input?.focus();input?.select();}
      });
      root.querySelectorAll("[data-recover-draft]").forEach(el=>el.onclick=()=>{
        const draft=getState().drafts[el.dataset.recoverDraft];
        if(!draft)return;
        const e=editor(draft.pinId);if(e.dirty&&!confirm("Replace this editor’s unsaved text with the recovered draft?"))return;
        Object.assign(e,{text:draft.text,baseRevision:draft.baseRevision,lifecycleRevision:draft.lifecycleRevision,generation:draft.generation,draftId:draft.draftId,dirty:true,status:"Draft recovered — review and retry",conflict:draft.baseRevision!==getState().references[draft.pinId].noteRevision});changed();
      });
      root.querySelectorAll("[data-delete-draft]").forEach(el=>el.onclick=async()=>{
        if(!confirm("Discard this unsaved draft? The committed Note is unchanged."))return;
        await command({type:"DISCARD_DRAFT",draftId:el.dataset.deleteDraft});changed();
      });
    }
    async function flush() { const results=await Promise.all([...editors.values()].filter(e=>e.dirty).map(e=>save(e)));return results.every(Boolean); }
    return {html,bind,flush,hasDirty:()=>[...editors.values()].some(e=>e.dirty)};
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
