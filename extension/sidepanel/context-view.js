(function () {
  "use strict";
  const {escape:e,image,command,createNotes,assignmentCommand}=PinRefUI;
  window.createContextView=({getState,changed,feedback})=>{
    const notes=createNotes({getState,changed});
    let query="",rename=null,previousPin=null;
    async function act(c){const result=await command(c);feedback(result.ok?"Saved locally":`Could not save: ${result.reason}. Your committed data is unchanged.`);await changed(true);return result;}
    function html(){
      const s=getState(),pin=s.context?.pinId;
      if(previousPin&&previousPin!==pin)notes.flush();previousPin=pin;
      if(!pin)return `<section class="inspector-empty sidepanel-empty"><span class="inspector-empty-icon">◇</span><strong>${s.context?.identityUnavailable?"Identity unavailable":"No Context Pin yet"}</strong><p>${s.context?.identityUnavailable?"This Save could not be bound to one Pin. Nothing was added. Open the Pin detail page before trying again.":"Open an individual Pin, or use Pinterest’s native Save on a Pin here. Hovering does not select a Pin."}</p></section><p class="muted">To scan existing saves, open Saved Pins or a specific Board.</p>`;
      const record=s.references[pin],trash=s.trash?.[pin];
      const attempt=Object.values(s.attempts||{}).filter(a=>a.pinId===pin).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
      const status=attempt?.status==="pending"?"Capture pending":attempt?"Needs attention":record?"Reference available":trash?"In Trash":"Not in PinRef";
      return `<section class="context-card detail-content"><div class="source-label">${status}</div>${image(record||trash||s.context,"context-preview")}<div class="selection-overview-copy"><h2>Pin ${e(pin)}</h2><p>Pinterest link · ${e(s.context?.status||"unknown")}</p></div>${!record?'<button class="button" data-context-refresh>Check current Pin</button>':""}${attempt?`<div class="notice"><strong>${attempt.status==="pending"?"Waiting for Pinterest…":attempt.status==="confirmed"?"Pinterest Save confirmed · local save needs retry":attempt.status==="in-trash"?"This Reference is in Trash":"Save not confirmed"}</strong><p>${attempt.status==="confirmed"?"Retry only the local save. You do not need to save on Pinterest again.":"A click alone does not add a Reference. Your Library is unchanged until Save is confirmed."}</p><div class="actions">${attempt.status==="confirmed"?`<button class="button" data-capture-retry="${e(attempt.attemptId)}">Retry local save</button>`:attempt.status!=="in-trash"?`<button class="button" data-capture-check="${e(attempt.attemptId)}">Check again</button>`:""}<a href="../dashboard/index.html?view=attention" target="_blank" rel="noopener">Manage in Needs Attention ↗</a></div></div>`:""}${!record?`<p class="muted">${trash?"This Pin is in Trash. Restore it from Dashboard; Capture and Import will not restore it silently.":s.context?.status==="saved"?"Already saved on Pinterest. Open Saved Pins or its Board to import it; PinRef does not guess its Board.":s.context?.status==="not-saved"?"Not saved on Pinterest. Use Pinterest’s own Save button; PinRef adds a Reference only after confirmed Save.":"Pinterest Save status is unknown. Keep the Pin open and check again; no Reference is added automatically."}</p>${trash?'<a href="../dashboard/index.html" target="_blank" rel="noopener">Manage in Dashboard ↗</a>':""}`:`<section class="detail-section"><h3>Tags</h3><div class="editable-tag-row">${record.tags.map(id=>`<span class="editable-tag"><button class="tag-name" data-context-rename="${e(id)}" aria-label="Globally rename ${e(s.tags[id]?.name)}">${e(s.tags[id]?.name)}</button><button data-context-remove="${e(id)}" aria-label="Remove ${e(s.tags[id]?.name)}">×</button></span>`).join("")}</div><label class="tag-query-label">Add Tag<input data-context-query data-focus="context-tag-query" placeholder="Find or create Tag" value="${e(query)}"></label>${query?`<div class="tag-picker-list">${s.tagOrder.map(id=>s.tags[id]).filter(t=>t.name.toLowerCase().includes(query.toLowerCase())&&!record.tags.includes(t.tagId)).map(t=>`<button class="tag-option" data-context-assign="${e(t.tagId)}"><i style="--item-color:${e(t.color)}"></i><span>${e(t.name)}</span><small>Add</small></button>`).join("")}<button class="button" data-context-create>Create “${e(query)}” & assign</button></div>`:""}${rename&&s.tags[rename.id]?`<div class="context-rename"><label>Global Rename · affects ${[...Object.values(s.references),...Object.values(s.trash)].filter(r=>r.tags.includes(rename.id)).length} References<input data-context-name data-focus="context-rename" value="${e(rename.name)}"></label><small>${e(rename.status||"Autosaves globally")}</small>${rename.target?`<a href="../dashboard/index.html?merge=${encodeURIComponent(rename.id)}&target=${encodeURIComponent(rename.target)}" target="_blank" rel="noopener">Preview Merge in Dashboard ↗</a>`:""}<button class="button quiet" data-context-close-rename>Close</button></div>`:""}</section>${notes.html(pin)}<dl class="detail-grid"><dt>Added</dt><dd>${e(new Date(record.addedToPinRefAt).toLocaleString())}</dd><dt>Pinterest</dt><dd>${e(record.linkStatus)}</dd></dl><div class="editor-recovery"><button class="button quiet" data-context-preview>Reload preview</button><button class="button quiet" data-context-status>Check Pinterest status</button></div>`}<a class="open-source-button" href="https://www.pinterest.com/pin/${pin}/" target="_blank" rel="noopener">View on Pinterest ↗</a></section>`;
    }
    async function saveRename(){
      if(!rename)return;clearTimeout(rename.timer);const tag=getState().tags[rename.id];if(!tag||tag.name===rename.name)return;
      const result=await command({type:"EDIT_TAG",tagId:rename.id,name:rename.name,baseRevision:tag.revision});
      rename.status=result.ok?"Saved globally":result.reason==="tag-name-exists"?"Name already exists. Review Merge in Dashboard.":"Save failed — edit or retry.";rename.target=result.targetTagId;changed(true);
    }
    function bind(root){
      const s=getState(),pin=s.context?.pinId;
      const on=(selector,fn,event="click")=>root.querySelectorAll(selector).forEach(el=>el.addEventListener(event,ev=>fn(el,ev)));
      notes.bind(root);
      on("[data-context-refresh]",()=>changed(true));
      on("[data-context-query]",el=>{query=el.value;changed();},"input");
      on("[data-context-create]",async()=>{const r=await act(PinRefUI.createTagCommand(s,[pin],query));if(r.ok){query="";changed();}});
      on("[data-context-assign]",el=>act(assignmentCommand(s,[pin],el.dataset.contextAssign,true)));
      on("[data-context-remove]",el=>act(assignmentCommand(s,[pin],el.dataset.contextRemove,false)));
      on("[data-context-rename]",el=>{rename={id:el.dataset.contextRename,name:s.tags[el.dataset.contextRename].name};changed();});
      on("[data-context-name]",el=>{rename.name=el.value;clearTimeout(rename.timer);rename.timer=setTimeout(saveRename,600);},"input");
      on("[data-context-name]",()=>{if(!PinRefUI.isRendering())saveRename();},"blur");on("[data-context-name]",(_,ev)=>{if(ev.key==="Enter")saveRename();},"keydown");
      on("[data-context-close-rename]",async()=>{await saveRename();rename=null;changed();});
      on("[data-capture-retry]",el=>act({type:"COMMIT_CAPTURE",attemptId:el.dataset.captureRetry}));
      async function evidence(message){try{const r=await chrome.runtime.sendMessage(message);feedback(r.ok?"Evidence refreshed":"Reliable evidence is unavailable. Keep the original Pin open and try again; saved metadata is unchanged.");}catch{feedback("Unable to refresh. Your saved data is unchanged.");}changed(true);}
      on("[data-capture-check]",el=>evidence({type:"pinref:checkCapture",attemptId:el.dataset.captureCheck}));
      on("[data-context-preview]",()=>evidence({type:"pinref:refreshEvidence",pinId:pin,field:"preview"}));
      on("[data-context-status]",()=>evidence({type:"pinref:refreshEvidence",pinId:pin,field:"link"}));
    }
    return {html,bind,flush:notes.flush};
  };
})();
