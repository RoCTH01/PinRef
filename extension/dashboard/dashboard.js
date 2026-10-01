(function () {
  "use strict";
  const {escape:e,command,image,preserveRender,createNotes,assignmentCommand,drag}=PinRefUI;
  const app=document.querySelector("#app"), compact=matchMedia("(max-width:900px)");
  const inspectorOnly=new URLSearchParams(location.search).get("inspector")==="1";
  if(inspectorOnly)document.body.classList.add("inspector-embed");
  let dashboardPort=null,dashboardWindowId=null,dashboardTabId=null,closing=false;
  const v={state:null,destination:"library",query:"",tagQuery:"",filter:null,selected:new Set(),tagSelection:new Set(),activeNote:null,
    sidebarOpen:!compact.matches,sortRecent:true,picker:false,pickerQuery:"",tagEditor:null,inspectorClosed:false,panelConnected:false,message:"",busy:false,position:null,imageRatios:new Map()};
  const notes=createNotes({getState:()=>v.state,changed:()=>render()});
  const mergeRequest=new URLSearchParams(location.search);
  if(mergeRequest.get("view")==="attention")v.destination="attention";
  const selected=()=>[...v.selected].map(id=>v.state.references[id]).filter(Boolean);
  const tags=()=>v.state.tagOrder.map(id=>v.state.tags[id]).filter(Boolean);
  const tagCount=(id,trash=false)=>[...Object.values(v.state.references),...(trash?Object.values(v.state.trash):[])].filter(r=>r.tags.includes(id)).length;
  const button=(text,attr,cls="quiet-button")=>`<button class="${cls}" ${attr}>${text}</button>`;
  function publishSelection(){
    if(inspectorOnly||!dashboardPort||!v.state||!Number.isInteger(dashboardWindowId)||!Number.isInteger(dashboardTabId))return;
    try{dashboardPort.postMessage({windowId:dashboardWindowId,tabId:dashboardTabId,pinIds:[...v.selected],activePinId:v.activeNote});}catch{/* Reconnect restores the current selection. */}
  }
  function openNativeInspector(){
    if(inspectorOnly||v.panelConnected||!Number.isInteger(dashboardWindowId)||!chrome.sidePanel?.open)return;
    chrome.sidePanel.open({windowId:dashboardWindowId}).catch(()=>{v.message="Could not open the Side Panel. The Inspector remains available here.";render();});
  }
  async function connectDashboard(){
    if(inspectorOnly||closing||dashboardPort||!chrome.runtime?.connect||!chrome.tabs?.getCurrent||!chrome.windows?.getCurrent)return;
    const [tab,window]=await Promise.all([chrome.tabs.getCurrent(),chrome.windows.getCurrent()]);
    if(!tab?.id||!window?.id||closing)return;
    dashboardWindowId=window.id;dashboardTabId=tab.id;
    const port=chrome.runtime.connect({name:"pinref:dashboard"});dashboardPort=port;
    port.onMessage.addListener(message=>{
      if(message.type==="panel-visibility"&&v.panelConnected!==Boolean(message.open)){v.panelConnected=Boolean(message.open);render();}
      if(message.type==="clear-selection"){v.selected.clear();v.activeNote=null;render();}
    });
    port.onDisconnect.addListener(()=>{if(dashboardPort===port)dashboardPort=null;v.panelConnected=false;if(!closing){render();setTimeout(connectDashboard,500);}});
    publishSelection();
  }
  const focusAfterRender=selector=>setTimeout(()=>app.querySelector(selector)?.focus(),0);
  function searchHtml(){
    const suggestions=tags().filter(t=>t.name.toLowerCase().includes(v.query.trim().toLowerCase())).slice(0,8);
    return `<div class="search-box" ${compact.matches&&v.sidebarOpen?"inert":""}><span>⌕</span><input data-search data-focus="search" aria-label="Search Library" placeholder="Search Tags and Notes" value="${e(v.query)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="${Boolean(v.suggestions)}" aria-controls="search-suggestions">${v.suggestions?`<div id="search-suggestions" class="search-suggestions" role="listbox" aria-label="Tag suggestions"><div class="suggestion-heading">Filter by Tag</div>${suggestions.map(t=>button(`<i style="--item-color:${e(t.color)}"></i><span>${e(t.name)}</span><small>${tagCount(t.tagId)}</small>`,`data-suggest="${e(t.tagId)}" data-focus="suggest-${e(t.tagId)}" role="option" aria-selected="false"`,"suggestion-item")).join("")||'<p class="muted">No matching Tags. Search still includes committed Notes.</p>'}</div>`:""}</div>`;
  }
  function filtered() {
    const q=v.query.trim().toLowerCase();
    return Object.values(v.state.references).filter(r=>(!v.filter||r.tags.includes(v.filter))&&(v.destination!=="untagged"||!r.tags.length)&&
      (!q||`${r.note} ${r.tags.map(id=>v.state.tags[id]?.name||"").join(" ")}`.toLowerCase().includes(q)))
      .sort((a,b)=>v.sortRecent?String(b.addedToPinRefAt).localeCompare(a.addedToPinRefAt):String(a.addedToPinRefAt).localeCompare(b.addedToPinRefAt));
  }
  async function act(c) {
    if(v.busy)return {ok:false};
    v.busy=true;const result=await command(c);v.busy=false;
    v.message=result.ok?"Saved locally":({"drafts-pending":"Resolve or discard the Note draft before moving to Trash.","stale-assignment":"This assignment changed elsewhere. Review and retry.","undo-expired-or-stale":"Undo is no longer safe. Newer changes were preserved.","tag-name-exists":"That Tag exists. Use the separate Merge action."}[result.reason]||`Could not save: ${result.reason||"connection unavailable"}. Try again.`);
    v.retryCommand=result.ok?null:c;
    clearTimeout(v.feedbackTimer);
    if(result.ok)v.feedbackTimer=setTimeout(()=>{v.message="";render();},result.receiptId?15000:3000);
    if(result.receiptId)v.receiptId=result.receiptId;
    await load();return result;
  }
  function sidebar() {
    const s=v.state,records=Object.values(s.references);
    const items=[["library","All Pins",records.length,"▦"],["recent","Recently added",records.length,"◷"],["untagged","Untagged",records.filter(r=>!r.tags.length).length,"◇"],["attention","Needs Attention",Object.keys(s.attempts).length,"!"],["trash","Trash",Object.keys(s.trash).length,"⌫"],["import-guide","How to import","","↓"]];
    return `<aside id="sidebar" class="library-sidebar" aria-label="Dashboard navigation" ${!v.sidebarOpen?"inert":""}><div class="sidebar-brand"><strong>PinRef</strong></div><nav>${items.map(([id,label,count,icon])=>button(`<span>${icon}</span><span>${label}</span><em>${count}</em>`,`data-destination="${id}" data-focus="nav-${id}"`,`sidebar-item ${v.destination===id&&!v.filter?"active":""}`)).join("")}<section class="sidebar-section tags-section"><div class="sidebar-heading">${v.tagSelection.size?`<div class="sidebar-selection-head"><strong>${v.tagSelection.size} Tags selected</strong>${button("Delete","data-delete-tags","danger")}${button("×",'data-clear-tags aria-label="Clear Tag selection"',"")}</div>`:`<span>Tags <em class="sidebar-heading-count">${tags().length}</em></span>${button("+",'data-create-tag aria-label="Create Tag"',"")}`}</div><div class="sidebar-tag-search"><input aria-label="Search Tags" data-tag-query data-focus="tag-query" placeholder="Search Tags" value="${e(v.tagQuery)}"></div><div class="sidebar-tag-list" data-scroll="tags">${tags().filter(t=>t.name.toLowerCase().includes(v.tagQuery.toLowerCase())).map(t=>`<div class="tag-row-control" draggable="true" data-drag-tag="${e(t.tagId)}"><input type="checkbox" aria-label="Select Tag ${e(t.name)}" data-tag-select="${e(t.tagId)}" ${v.tagSelection.has(t.tagId)?"checked":""}>${button(`<span class="tag-dot" style="--tag-color:${e(t.color)}"></span><span>${e(t.name)}</span><em>${tagCount(t.tagId)}</em>`,`data-filter="${e(t.tagId)}" data-focus="tag-${e(t.tagId)}"`,`sidebar-item ${v.filter===t.tagId?"active":""}`)}${button("···",`data-edit-tag="${e(t.tagId)}" data-focus="sidebar-edit-${e(t.tagId)}" aria-label="Manage Tag ${e(t.name)}"`,"tag-more")}</div>`).join("")||'<p class="muted">No matching Tags</p>'}</div></section></nav><footer class="sidebar-footer">${button(`◐ <strong>${s.preferences.theme==="light"?"Dark":"Light"} theme</strong>`,"data-theme","sidebar-footer-button")}<small class="muted">Local to this browser profile.<br>Pinterest is never changed.</small></footer></aside>`;
  }
  function gallery() {
    const records=filtered();
    return `<header class="contact-header"><div class="topbar-primary"></div><div class="gallery-toolbar"><div class="gallery-context"><strong>${e(v.filter?v.state.tags[v.filter]?.name||"Tags":v.destination==="untagged"?"Untagged":v.destination==="recent"?"Recently added":"All Pins")}</strong><span>${records.length}</span></div><div class="gallery-controls">${button(v.sortRecent?"Newest first ↓":"Oldest first ↑","data-sort","compact-sort")}<div class="layout-switcher" aria-label="Gallery layout">${["masonry","waterfall"].map(mode=>button(mode==="masonry"?"▦ Masonry":"▥ Waterfall",`data-layout="${mode}" aria-pressed="${v.state.preferences.galleryMode===mode}"`,`layout-option ${v.state.preferences.galleryMode===mode?"active":""}`)).join("")}</div>${button("◫",`data-dock aria-label="${v.state.preferences.inspectorMode==="docked"?"Float":"Dock"} Inspector"`,"icon-button")}</div></div></header>${records.length?`<div class="contact-sheet mode-${v.state.preferences.galleryMode}" aria-label="Library Contact Sheet">${records.map(r=>`<article class="ref-card ${v.selected.has(r.pinId)?"selected":""}" data-card="${r.pinId}" style="--masonry-span:16">${button(`${image(r,"card-art")}`,`data-select="${r.pinId}" data-focus="pin-${r.pinId}" aria-label="Select Pin ${r.pinId}" aria-pressed="${v.selected.has(r.pinId)}"`,"card-select")}${button("",`data-toggle-select="${r.pinId}" data-focus="toggle-${r.pinId}" aria-label="Toggle selection of Pin ${r.pinId}" aria-pressed="${v.selected.has(r.pinId)}"`,"select-box")}</article>`).join("")}</div>`:`<section class="empty-card"><span class="empty-icon">◇</span><h2>${Object.keys(v.state.references).length?"No matching References":"Your local Library is empty"}</h2><p>${Object.keys(v.state.references).length?"Try another search or Tag filter.":"Open Saved Pins or a Board on Pinterest, then use the PinRef Side Panel to import."}</p>${button("How to import",'data-destination="import-guide"')}</section>`}`;
  }
  function attention() {
    return `<section class="needs-attention"><header><h1>Needs Attention</h1><p>Capture Attempts are not References. Pinterest Save must be confirmed before a local commit.</p></header><div class="attempt-list">${Object.values(v.state.attempts).map(a=>`<article class="attempt-card"><div><h2>Pin ${e(a.pinId)}</h2><p>${a.status==="confirmed"?"Pinterest Save confirmed · local save needs retry":a.status==="in-trash"?"In Trash · restore from Trash if wanted":a.status==="pending"?"Waiting for Pinterest Save confirmation…":"Save not confirmed. No Reference was added."}</p><a href="https://www.pinterest.com/pin/${a.pinId}/" target="_blank" rel="noopener">Open on Pinterest ↗</a></div><div class="attempt-actions">${a.status==="confirmed"?button("Retry local save",`data-capture-retry="${e(a.attemptId)}"`):a.status!=="in-trash"?button("Check again",`data-capture-check="${e(a.attemptId)}"`):""}${button("Dismiss",`data-dismiss-attempt="${e(a.attemptId)}"`)}</div></article>`).join("")||'<p class="empty-card">Nothing needs attention.</p>'}</div></section>`;
  }
  function trash() {
    const records=Object.values(v.state.trash);
    return `<section class="needs-attention"><header><h1>Trash</h1><p>References stay until you restore or permanently delete them. Pinterest is unaffected.</p>${records.length?button(`Empty Trash (${records.length})`,"data-empty-trash","quiet-button danger"):""}</header><div class="attempt-list">${records.map(r=>`<article class="attempt-card"><div class="trash-summary">${image(r,"summary-art")}<h2>Pin ${r.pinId}</h2><p>${e(r.note||"No Note")}</p><p>${r.tags.map(id=>e(v.state.tags[id]?.name)).join(" · ")}</p></div><div class="attempt-actions">${button("Restore",`data-restore="${r.pinId}"`)}${button("Permanent Delete",`data-delete="${r.pinId}"`,"quiet-button danger")}</div></article>`).join("")||'<p class="empty-card">Trash is empty.</p>'}</div></section>`;
  }
  function guide() {return `<section class="empty-card import-guide"><h1>Import from Pinterest</h1><h2>Import beside the collection you want</h2><p>1. Open Saved Pins (the Pins tab) or one concrete Board.</p><p>2. Click the PinRef extension to open its Side Panel.</p><p>3. Start a scan, review candidates, then import your selection.</p><p>No Pins are imported automatically.</p><a class="quiet-button" href="https://www.pinterest.com/" target="_blank" rel="noopener">Open Pinterest ↗</a></section>`;}
  function inspector() {
    const records=selected(),mode=v.state.preferences.inspectorMode;
    if((!records.length&&mode!=="docked")||v.inspectorClosed||(!inspectorOnly&&mode==="docked"&&v.panelConnected))return "";
    const active=records.find(r=>r.pinId===v.activeNote)||records[0];
    const common=records.length?records[0].tags.filter(id=>records.every(r=>r.tags.includes(id))):[];
    const placement=v.position&&mode==="floating"&&!compact.matches?`style="left:${v.position.left}px;top:${v.position.top}px;right:auto;bottom:auto"`:"";
    return `<aside class="inspector-panel ${mode} ${records.length?"":"empty"}" aria-label="Inspector" ${placement}><header class="panel-titlebar draggable-titlebar"><div class="panel-heading"><strong>Inspector</strong><small>${records.length?`${records.length} selected`:"No selection"}</small></div><span class="spacer"></span>${inspectorOnly?"":button("↺",'data-reset-position aria-label="Reset Inspector position"',"panel-toolbar-button")}${button("◫",`data-dock aria-label="${mode==="docked"?"Float":"Dock"} Inspector"`,"panel-toolbar-button")}${inspectorOnly?"":button("×",'data-close-inspector aria-label="Close Inspector"',"panel-toolbar-button")}</header>${!records.length?'<div class="inspector-empty"><span class="inspector-empty-icon">◇</span><strong>Select a Reference</strong><p>Its Tags, Note and source will appear here.</p></div>':`<div class="inspector-body detail-content" data-scroll="inspector"><section class="selection-overview">${records.length>1?`<div class="stacked-thumbnails">${records.slice(0,3).map(r=>image(r,"stack-art")).join("")}</div>`:image(active,"summary-art")}<div class="selection-overview-copy"><h2>${records.length>1?`${records.length} References`:`Pin ${active.pinId}`}</h2><p>In PinRef · saved locally</p></div></section><section class="detail-section"><h3>${records.length>1?"Common Tags":"Tags"}</h3><div class="editable-tag-row">${common.map(id=>`<span class="editable-tag">${button(e(v.state.tags[id]?.name),`data-edit-tag="${e(id)}" data-focus="inspector-edit-${e(id)}" aria-label="Globally rename ${e(v.state.tags[id]?.name)}"`,"tag-name")}${button("×",`data-unassign="${e(id)}" aria-label="Remove ${e(v.state.tags[id]?.name)} from selection"`,"")}</span>`).join("")}${button("+",'data-picker aria-label="Add Tag"',"add-tag-round")}</div>${records.length>1?'<small class="muted">Tag changes apply to all selected References. Notes never do.</small>':""}</section>${records.length>1?`<section class="selection-notes"><h3>Notes</h3><div class="note-tabs">${records.map(r=>button(`<strong>Pin ${r.pinId}</strong><span>${e(r.note||"No Note")}</span>`,`data-note-tab="${r.pinId}" data-focus="note-tab-${r.pinId}" aria-pressed="${active.pinId===r.pinId}"`,`note-tab ${active.pinId===r.pinId?"active":""}`)).join("")}</div><div class="note-preview" data-note-preview><strong>Preview a Note</strong><p>Hover or focus to preview; click to edit only that Reference.</p></div></section>`:""}${notes.html(active.pinId)}<dl class="detail-grid"><dt>Added to PinRef</dt><dd>${e(new Date(active.addedToPinRefAt).toLocaleString())}</dd><dt>Pinterest link</dt><dd>${e(active.linkStatus)}</dd></dl><a class="open-source-button" href="https://www.pinterest.com/pin/${active.pinId}/" target="_blank" rel="noopener">View on Pinterest ↗</a><div class="editor-recovery">${button("Reload preview",`data-preview="${active.pinId}"`)}${button("Check Pinterest status",`data-check="${active.pinId}"`)}</div>${button(`Move ${records.length} to Trash`,"data-trash","quiet-button danger")}<div class="inspector-actions">${button("Clear selection","data-clear-selection","inspector-clear")}</div></div>`}</aside>`;
  }
  function picker() {
    if(!v.picker)return "";
    const records=selected();
    return `${button("",'data-close-picker aria-label="Close Tag picker"',"tag-picker-scrim")}<section class="tag-picker toolbar-popover" role="dialog" aria-label="Add Tags"><header class="tag-picker-head"><strong>Add Tags · ${records.length} selected</strong>${button("×",'data-close-picker aria-label="Close Tag picker"',"icon-button")}</header><input data-picker-query data-focus="picker-query" aria-label="Find or create Tag" placeholder="Find or create Tag" value="${e(v.pickerQuery)}"><div class="tag-picker-list">${tags().filter(t=>t.name.toLowerCase().includes(v.pickerQuery.toLowerCase())).map(t=>{const all=records.every(r=>r.tags.includes(t.tagId));return button(`<i style="--item-color:${e(t.color)}"></i><span>${e(t.name)}</span><small>${all?"Applied to all":"Add"}</small>`,`data-assign="${e(t.tagId)}" ${all?"disabled":""}`,"tag-option");}).join("")}</div>${v.pickerQuery.trim()?button(`Create “${e(v.pickerQuery.trim())}” & assign`,"data-create-assign"):""}<footer class="tag-picker-footer">${button("Done","data-close-picker")}</footer></section>`;
  }
  function tagEditor() {
    const item=v.tagEditor,tag=item&&v.state.tags[item.id];if(!tag)return "";
    return `${button("",'data-close-tag-editor aria-label="Close Tag editor"',"tag-picker-scrim")}<section class="tag-editor-panel" role="dialog" aria-label="Manage Tag"><header><strong>Global Tag editor</strong>${button("×",'data-close-tag-editor aria-label="Close Tag editor"',"icon-button")}</header><p>Affects ${tagCount(tag.tagId,true)} References, including Trash.</p><label>Name <input data-tag-name data-focus="rename-tag" value="${e(item.name)}" maxlength="80"></label><small role="status">${e(item.status||"Changes save automatically")}</small><label>Marker color <input type="color" data-tag-color value="${e(tag.color)}"></label><div class="editor-recovery">${button("Move up","data-tag-up")}${button("Move down","data-tag-down")}</div>${item.target?`<p>“${e(v.state.tags[item.target]?.name)}” already exists. Merge keeps that Tag and combines assignments.</p>${button("Merge into existing Tag","data-merge-tag")}`:""}${button("Delete globally","data-delete-tag","quiet-button danger")}</section>`;
  }
  function render() {
    if(!v.state)return;
    if(PinRefUI.deferRender(render))return;
    const galleryScroll=app.querySelector('[data-scroll="gallery"]')?.scrollTop;
    document.documentElement.dataset.theme=v.state.preferences.theme;
    const libraryView=["library","recent","untagged"].includes(v.destination),docked=v.state.preferences.inspectorMode==="docked"&&!v.inspectorClosed&&libraryView&&!v.panelConnected&&!inspectorOnly;
    preserveRender(app,()=>{
      app.innerHTML=inspectorOnly ? `${inspector()}${picker()}${tagEditor()}` : `<div class="workspace ${v.sidebarOpen?"":"sidebar-closed"} ${docked?"inspector-docked-layout":""}">${sidebar()}${button("",'data-close aria-label="Close sidebar" tabindex="-1"',"sidebar-backdrop")}<div class="anchored-topbar">${button("☰",`data-open aria-label="${v.sidebarOpen?"Close":"Open"} sidebar" aria-expanded="${v.sidebarOpen}"`,"sidebar-toggle")}${libraryView?searchHtml():""}</div><main id="main-content" tabindex="-1" class="contact ${docked?"inspector-docked":""}" data-scroll="gallery" ${compact.matches&&v.sidebarOpen?"inert":""}>${libraryView?gallery():v.destination==="attention"?attention():v.destination==="trash"?trash():guide()}</main>${libraryView?inspector():""}${picker()}${tagEditor()}</div>`;
      document.querySelector("#announcements").textContent=v.message;
      const feedback=document.querySelector("#visible-feedback");feedback.hidden=!v.message;
      feedback.innerHTML=v.message?`${e(v.message)} ${v.receiptId?button("Undo Tag change","data-undo"):""}${v.retryCommand?button("Retry","data-retry-library"):""}${button("×",'data-dismiss-feedback aria-label="Dismiss message"')}`:"";
      feedback.querySelector("[data-undo]")?.addEventListener("click",()=>act({type:"UNDO_TAG_CHANGE",receiptId:v.receiptId}).then(()=>{v.receiptId=null;}));
      feedback.querySelector("[data-retry-library]")?.addEventListener("click",()=>act(v.retryCommand));
      feedback.querySelector("[data-dismiss-feedback]")?.addEventListener("click",()=>{v.message="";v.retryCommand=null;render();});
      bind();notes.bind(app);
    });
    const inspectorEl=app.querySelector(".inspector-panel");if(inspectorEl)drag(inspectorEl,inspectorEl.querySelector("header"),()=>!compact.matches&&v.state.preferences.inspectorMode==="floating",position=>{v.position=position;});
    const pickerEl=app.querySelector(".tag-picker");if(pickerEl){
      const rect=pickerEl.getBoundingClientRect(),anchor=v.pickerAnchor||{left:innerWidth-rect.width-24,top:80,bottom:100};
      const proposed=v.pickerPosition||{left:anchor.left,top:anchor.bottom+rect.height+12<=innerHeight?anchor.bottom+8:anchor.top-rect.height-8};
      Object.assign(pickerEl.style,{left:`${Math.max(12,Math.min(innerWidth-rect.width-12,proposed.left))}px`,top:`${Math.max(12,Math.min(innerHeight-rect.height-12,proposed.top))}px`,transform:"none"});
      drag(pickerEl,pickerEl.querySelector("header"),()=>true,position=>{v.pickerPosition=position;});
    }
    app.querySelectorAll(".ref-card img").forEach(img=>{
      const card=img.closest(".ref-card"),pinId=card.dataset.card;
      const apply=(width,height)=>{card.style.setProperty("--ratio",`${width}/${height}`);card.style.setProperty("--masonry-span",Math.ceil((card.clientWidth*height/width+12)/18));};
      const previous=v.imageRatios.get(pinId);if(previous)apply(previous.width,previous.height);
      const size=()=>{if(!img.naturalWidth||!img.naturalHeight)return;const dimensions={width:img.naturalWidth,height:img.naturalHeight};v.imageRatios.set(pinId,dimensions);apply(dimensions.width,dimensions.height);};
      img.addEventListener("load",size,{once:true});if(img.complete)size();
    });
    // Restore after image ratios are applied: restoring during the DOM replacement
    // can clamp the scroll position against the temporary, shorter gallery.
    if(galleryScroll!==undefined)app.querySelector('[data-scroll="gallery"]')?.scrollTo(0,galleryScroll);
    publishSelection();
  }
  async function changeFilter(update){await notes.flush();v.selected.clear();v.activeNote=null;v.picker=false;update();render();}
  async function closeTagEditor(){await saveTagName();v.tagEditor=null;render();const opener=app.querySelector(`[data-focus="${CSS.escape(v.tagOpener||"")}"]`);(opener&&!opener.closest("[inert]")?opener:app.querySelector("[data-open]"))?.focus();}
  async function saveTagName() {
    const edit=v.tagEditor;if(!edit)return true;if(edit.saving)return edit.saving;
    clearTimeout(edit.timer);const tag=v.state.tags[edit.id];if(!tag||edit.name===tag.name)return true;
    edit.saving=(async()=>{const result=await command({type:"EDIT_TAG",tagId:edit.id,name:edit.name,baseRevision:edit.baseRevision??tag.revision});
      if(result.ok)edit.baseRevision=(edit.baseRevision??tag.revision)+1;
      edit.status=result.ok?"Saved globally":result.reason==="tag-name-exists"?"Name exists — choose Merge or another name":"Could not save. Your rename draft is kept.";edit.target=result.targetTagId;await load();return result.ok;})();
    const result=await edit.saving;edit.saving=null;return result;
  }
  async function deleteTags(ids) {
    const count=[...Object.values(v.state.references),...Object.values(v.state.trash)].filter(r=>r.tags.some(t=>ids.includes(t))).length;
    if(!confirm(`Delete ${ids.length} Tags globally from ${count} References? Notes and Pinterest are unaffected.`))return;
    const result=await act({type:"DELETE_TAGS",tagIds:ids,bases:Object.fromEntries(ids.map(id=>[id,v.state.tags[id].revision]))});
    if(result.ok){v.tagSelection.clear();v.tagEditor=null;v.filter=null;render();}
  }
  function bind() {
    const on=(selector,fn,event="click")=>app.querySelectorAll(selector).forEach(el=>el.addEventListener(event,ev=>fn(el,ev)));
    on("[data-open]",()=>{v.sidebarOpen=!v.sidebarOpen;render();if(v.sidebarOpen&&compact.matches)focusAfterRender(".sidebar-item");});
    on("[data-close]",()=>{v.sidebarOpen=false;render();focusAfterRender("[data-open]");});
    on("[data-destination]",el=>changeFilter(()=>{v.destination=el.dataset.destination;v.filter=null;if(v.destination==="recent")v.sortRecent=true;if(compact.matches)v.sidebarOpen=false;}));
    on("[data-filter]",el=>changeFilter(()=>{v.destination="library";v.filter=el.dataset.filter;if(compact.matches)v.sidebarOpen=false;}));
    on("[data-search]",el=>{v.query=el.value;v.selected.clear();v.activeNote=null;v.picker=false;v.suggestions=true;notes.flush();render();},"input");
    on("[data-search]",()=>{if(!v.suggestions&&!v.suppressSuggestions&&!PinRefUI.isRendering()){v.suggestions=true;render();}},"focus");
    on("[data-search]",(_,ev)=>{if(ev.key==="ArrowDown"){ev.preventDefault();app.querySelector("[data-suggest]")?.focus();}},"keydown");
    on("[data-suggest]",async el=>{await changeFilter(()=>{v.query="";v.filter=el.dataset.suggest;v.suggestions=false;});focusAfterRender("#main-content");});
    on("[data-suggest]",(el,ev)=>{if(["ArrowDown","ArrowUp"].includes(ev.key)){ev.preventDefault();const options=[...app.querySelectorAll("[data-suggest]")],index=options.indexOf(el);options[(index+(ev.key==="ArrowDown"?1:options.length-1))%options.length]?.focus();}},"keydown");
    on("[data-tag-query]",el=>{v.tagQuery=el.value;render();},"input");
    on("[data-sort]",()=>{v.sortRecent=!v.sortRecent;render();});
    on("[data-layout]",el=>act({type:"SET_PREFERENCE",key:"galleryMode",value:el.dataset.layout}));
    on("[data-theme]",()=>act({type:"SET_PREFERENCE",key:"theme",value:v.state.preferences.theme==="dark"?"light":"dark"}));
    on("[data-dock]",async()=>{const toDock=v.state.preferences.inspectorMode==="floating";if(toDock)openNativeInspector();v.inspectorClosed=false;v.position=null;const result=await act({type:"SET_PREFERENCE",key:"inspectorMode",value:toDock?"docked":"floating"});if(result.ok&&!toDock&&inspectorOnly&&chrome.sidePanel?.close){const window=await chrome.windows.getCurrent();chrome.sidePanel.close({windowId:window.id}).catch(()=>{});}});
    on("[data-select]",async(el,ev)=>{if(v.state.preferences.inspectorMode==="docked")openNativeInspector();await notes.flush();const id=el.dataset.select;if(ev.shiftKey&&v.anchor){const ids=filtered().map(r=>r.pinId),a=ids.indexOf(v.anchor),b=ids.indexOf(id);if(a>=0)ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(id=>v.selected.add(id));}else if(ev.metaKey||ev.ctrlKey){if(v.selected.has(id))v.selected.delete(id);else v.selected.add(id);}else v.selected=v.selected.size===1&&v.selected.has(id)?new Set():new Set([id]);v.anchor=id;v.inspectorClosed=false;v.activeNote=id;render();});
    on("[data-clear-selection]",()=>{if(inspectorOnly){chrome.windows.getCurrent().then(window=>chrome.runtime.sendMessage({type:"pinref:clearDashboardSelection",windowId:window.id}));v.selected.clear();v.activeNote=null;render();}else changeFilter(()=>{});});
    on("[data-toggle-select]",async el=>{if(v.state.preferences.inspectorMode==="docked")openNativeInspector();await notes.flush();const id=el.dataset.toggleSelect;if(v.selected.has(id))v.selected.delete(id);else v.selected.add(id);v.anchor=id;v.activeNote=id;v.inspectorClosed=false;render();});
    on("[data-close-inspector]",async()=>{await notes.flush();v.inspectorClosed=true;render();app.querySelector(`[data-select="${v.anchor}"]`)?.focus();});
    on("[data-reset-position]",()=>{v.position=null;render();});
    on("[data-note-tab]",async el=>{await notes.flush();v.activeNote=el.dataset.noteTab;render();});
    const preview=el=>{const r=v.state.references[el.dataset.noteTab];app.querySelector("[data-note-preview]").innerHTML=`<strong>Pin ${r.pinId}</strong><p>${e(r.note||"No Note")}</p>`;};on("[data-note-tab]",preview,"mouseenter");on("[data-note-tab]",preview,"focus");
    on("[data-picker]",el=>{v.picker=true;v.pickerQuery="";v.pickerPosition=null;const rect=el.getBoundingClientRect();v.pickerAnchor={left:rect.left,top:rect.top,bottom:rect.bottom};render();focusAfterRender("[data-picker-query]");});
    on("[data-close-picker]",()=>{v.picker=false;render();app.querySelector("[data-picker]")?.focus();});
    on("[data-picker-query]",el=>{v.pickerQuery=el.value;render();},"input");
    on("[data-assign]",el=>act(assignmentCommand(v.state,[...v.selected],el.dataset.assign,true)));
    on("[data-unassign]",el=>act(assignmentCommand(v.state,[...v.selected],el.dataset.unassign,false)));
    on("[data-create-assign]",async()=>{const r=await act(PinRefUI.createTagCommand(v.state,[...v.selected],v.pickerQuery));if(r.ok){v.pickerQuery="";render();}});
    on("[data-create-tag]",()=>{const name=prompt("New Tag name");if(name)act({type:"CREATE_TAG",name});});
    on("[data-edit-tag]",el=>{const t=v.state.tags[el.dataset.editTag];v.tagEditor={id:t.tagId,name:t.name,baseRevision:t.revision};v.tagOpener=el.dataset.focus;render();focusAfterRender("[data-tag-name]");});
    on("[data-close-tag-editor]",closeTagEditor);
    on("[data-tag-name]",el=>{v.tagEditor.name=el.value;clearTimeout(v.tagEditor.timer);v.tagEditor.timer=setTimeout(saveTagName,600);},"input");
    on("[data-tag-name]",()=>{if(!PinRefUI.isRendering())saveTagName();},"blur");on("[data-tag-name]",(_,ev)=>{if(ev.key==="Enter")saveTagName();},"keydown");
    on("[data-tag-color]",el=>act({type:"EDIT_TAG",tagId:v.tagEditor.id,color:el.value,baseRevision:v.state.tags[v.tagEditor.id].revision}),"change");
    const reorder=offset=>{const order=[...v.state.tagOrder],index=order.indexOf(v.tagEditor.id),to=index+offset;if(to<0||to>=order.length)return;[order[index],order[to]]=[order[to],order[index]];act({type:"REORDER_TAGS",tagIds:order,baseOrder:v.state.tagOrder});};on("[data-tag-up]",()=>reorder(-1));on("[data-tag-down]",()=>reorder(1));
    on("[data-tag-select]",(el,ev)=>{const id=el.dataset.tagSelect;if(ev.shiftKey&&v.tagAnchor){const ids=tags().map(t=>t.tagId),a=ids.indexOf(v.tagAnchor),b=ids.indexOf(id);ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(t=>v.tagSelection.add(t));}else if(el.checked)v.tagSelection.add(id);else v.tagSelection.delete(id);v.tagAnchor=id;render();});
    on("[data-clear-tags]",()=>{v.tagSelection.clear();render();});on("[data-delete-tags]",()=>deleteTags([...v.tagSelection]));on("[data-delete-tag]",()=>deleteTags([v.tagEditor.id]));
    on("[data-merge-tag]",async()=>{const {id,target}=v.tagEditor;if(!confirm(`Merge into ${v.state.tags[target].name}? The target is kept and assignments combined.`))return;const r=await act({type:"MERGE_TAG",tagId:id,targetTagId:target,bases:{[id]:v.state.tags[id].revision}});if(r.ok){v.tagEditor=null;render();}});
    on("[data-drag-tag]",(el,ev)=>ev.dataTransfer.setData("text/plain",el.dataset.dragTag),"dragstart");on("[data-drag-tag]",(_,ev)=>ev.preventDefault(),"dragover");
    on("[data-drag-tag]",(el,ev)=>{ev.preventDefault();const id=ev.dataTransfer.getData("text/plain");if(!v.state.tags[id]||id===el.dataset.dragTag)return;const order=v.state.tagOrder.filter(t=>t!==id);order.splice(order.indexOf(el.dataset.dragTag),0,id);act({type:"REORDER_TAGS",tagIds:order,baseOrder:v.state.tagOrder});},"drop");
    on("[data-trash]",async()=>{if(!await notes.flush()){v.message="Resolve the Note draft before moving to Trash.";render();return;}const ids=[...v.selected];if(confirm(`Move ${ids.length} References to Trash? Pinterest is unaffected.`)){const r=await act(PinRefUI.lifecycleCommand(v.state,"TRASH",ids));if(r.ok){v.selected.clear();render();}}});
    on("[data-restore]",el=>act(PinRefUI.lifecycleCommand(v.state,"RESTORE",[el.dataset.restore])));const remove=ids=>{if(confirm(`Permanently delete ${ids.length} References? This cannot be undone. Pinterest is unaffected.`))act(PinRefUI.lifecycleCommand(v.state,"PERMANENT_DELETE",ids));};on("[data-delete]",el=>remove([el.dataset.delete]));on("[data-empty-trash]",()=>remove(Object.keys(v.state.trash)));
    on("[data-capture-retry]",el=>act({type:"COMMIT_CAPTURE",attemptId:el.dataset.captureRetry}));on("[data-dismiss-attempt]",el=>act({type:"DISMISS_ATTEMPT",attemptId:el.dataset.dismissAttempt}));
    on("[data-capture-check]",el=>evidence({type:"pinref:checkCapture",attemptId:el.dataset.captureCheck}));on("[data-preview]",el=>evidence({type:"pinref:refreshEvidence",pinId:el.dataset.preview,field:"preview"}));on("[data-check]",el=>evidence({type:"pinref:refreshEvidence",pinId:el.dataset.check,field:"link"}));
  }
  async function evidence(message){try{const r=await chrome.runtime.sendMessage(message);v.message=r.ok?"Evidence refreshed from the open Pinterest Pin":"Open this Pin in its original Pinterest tab and try again. Saved metadata is unchanged.";}catch{v.message="Could not refresh evidence. Saved metadata is unchanged.";}await load();}
  async function load() {
    try{const result=await chrome.runtime.sendMessage({type:"pinref:getDashboardState"});if(!result?.ok)throw new Error();v.state={tags:{},tagOrder:[],trash:{},drafts:{},attempts:{},preferences:{theme:"dark",galleryMode:"waterfall",inspectorMode:"floating"},...result};v.selected=new Set([...v.selected].filter(id=>v.state.references[id]));if(mergeRequest.has("merge")){const id=mergeRequest.get("merge"),target=mergeRequest.get("target");if(v.state.tags[id]&&v.state.tags[target])v.tagEditor={id,name:v.state.tags[id].name,target};mergeRequest.delete("merge");}render();}
    catch{document.querySelector("#announcements").textContent="Could not load Library. Reload to retry.";}
  }
  document.addEventListener("keydown",ev=>{
    if(ev.key==="Escape"&&v.suggestions){v.suggestions=false;render();v.suppressSuggestions=true;app.querySelector("[data-search]")?.focus();v.suppressSuggestions=false;return;}
    if(ev.key==="Escape"){if(v.picker){v.picker=false;render();app.querySelector("[data-picker]")?.focus();}else if(v.tagEditor){closeTagEditor();}else if(compact.matches&&v.sidebarOpen){v.sidebarOpen=false;render();app.querySelector("[data-open]").focus();}else if(v.selected.size)changeFilter(()=>{});}
    if(ev.key==="Tab"){const surface=app.querySelector('[role="dialog"]')||(compact.matches&&v.sidebarOpen?app.querySelector(".library-sidebar"):null);if(!surface)return;const controls=[...surface.querySelectorAll("button:not(:disabled),input,textarea,a[href]")].filter(el=>el.getClientRects().length);if(ev.shiftKey&&document.activeElement===controls[0]){ev.preventDefault();controls.at(-1)?.focus();}else if(!ev.shiftKey&&document.activeElement===controls.at(-1)){ev.preventDefault();controls[0]?.focus();}}
  });
  document.addEventListener("click",event=>{if(v.suggestions&&!event.target.closest(".search-box")){v.suggestions=false;render();}});
  window.addEventListener("beforeunload",event=>{if(notes.hasDirty()){notes.flush();event.preventDefault();event.returnValue="";}});
  window.addEventListener("pagehide",()=>{closing=true;dashboardPort?.disconnect();});
  window.addEventListener("message",event=>{
    if(!inspectorOnly||event.source!==window.parent||event.origin!==(location.protocol==="file:"?"null":location.origin)||event.data?.type!=="pinref:inspector-selection")return;
    const ids=Array.isArray(event.data.pinIds)?event.data.pinIds.filter(id=>v.state?.references?.[id]):[];
    v.selected=new Set(ids);v.activeNote=ids.includes(event.data.activePinId)?event.data.activePinId:ids[0]||null;render();
  });
  compact.addEventListener("change",()=>{v.sidebarOpen=!compact.matches;v.position=null;render();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes.pinrefState)load();});load();connectDashboard();
})();
