(function exposeLibrary(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PinRefLibrary = api;
})(globalThis, function () {
  "use strict";
  const normalizedName = value => String(value || "").normalize("NFKC").trim().toLowerCase();
  // Repeat views of the same Reference inside this window record no new use, so passive viewing
  // cannot turn routine panel refreshes into a stream of writes.
  const USE_COALESCING_MS = 60000;
  const fail = reason => ({ok:false, reason, persist:false});
  const safePreview = value => {
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "i.pinimg.com" ? url.href : null; }
    catch { return null; }
  };
  const MAX_PIN_IMAGES = 24;
  const safePreviews = value => [...new Set((Array.isArray(value) ? value : []).map(safePreview).filter(Boolean))].slice(0, MAX_PIN_IMAGES);
  function createApplication({repository, now = () => new Date().toISOString(), id = () => crypto.randomUUID()}) {
    async function execute(c) {
      return repository.updateState(state => {
        const records = (c.pinIds || [c.pinId]).map(pinId => state.references[pinId]);
        const reference = state.references[c.pinId];
        const tag = state.tags[c.tagId];
        const validRecords = () => records.length && records.every(Boolean);
        const collision = name => Object.values(state.tags).find(t => t.tagId !== c.tagId && normalizedName(t.name) === normalizedName(name));
        // Use is a timestamp, never a revision: it only moves forward, so concurrent writers cannot disagree.
        const markUsed = record => { record.lastUsedAt = now(); };
        const assignments = (record, tagId, assigned) => {
          record.tags = assigned ? [...new Set([...record.tags, tagId])] : record.tags.filter(t => t !== tagId);
          record.assignmentRevisions[tagId] = (record.assignmentRevisions[tagId] || 0) + 1;
        };
        const receipt = () => {
          state.receipt = {id:id(), expiresAt:Date.parse(now()) + 15000, revision:state.libraryRevision + 1,
            tags:structuredClone(state.tags), tagOrder:[...state.tagOrder],
            assignments:Object.fromEntries([...Object.values(state.references), ...Object.values(state.trash)].map(r=>[r.pinId,{tags:[...r.tags],assignmentRevisions:{...r.assignmentRevisions}}]))};
        };
        switch (c.type) {
          case "SET_PREFERENCE": {
            const allowed = {theme:["light","dark"], galleryMode:["masonry","waterfall"], inspectorMode:["floating","docked"]};
            if (!allowed[c.key]?.includes(c.value)) return fail("invalid-preference");
            state.preferences[c.key] = c.value; break;
          }
          case "SAVE_NOTE": {
            // Last committed write wins (ADR-0014); lifecycle and generation still reject writes across Trash or Permanent Delete.
            if (!reference) return fail("reference-not-active");
            if (reference.lifecycleRevision !== c.lifecycleRevision || reference.generation !== c.generation) return fail("stale-reference");
            if (typeof c.text !== "string") return fail("invalid-note");
            reference.note = c.text.trim() ? c.text : "";
            reference.noteRevision += 1;
            markUsed(reference);
            return {ok:true, record:structuredClone(reference)};
          }
          case "SAVE_NAME": {
            // A Reference Name is optional; empty falls back to the Pin ID. Last committed write wins, like Notes.
            if (!reference) return fail("reference-not-active");
            if (reference.lifecycleRevision !== c.lifecycleRevision || reference.generation !== c.generation) return fail("stale-reference");
            if (typeof c.name !== "string" || c.name.trim().length > 120) return fail("invalid-name");
            reference.name = c.name.trim();
            markUsed(reference);
            return {ok:true, record:structuredClone(reference)};
          }
          case "CREATE_TAG": {
            const name = String(c.name || "").trim();
            if (!name || name.length > 80) return fail("invalid-tag-name");
            if (collision(name)) return fail("tag-name-exists");
            if (c.pinIds?.length && !validRecords()) return fail("reference-not-active");
            if (c.pinIds?.length && records.some(r=>c.bases?.[r.pinId]?.generation!==r.generation||c.bases?.[r.pinId]?.lifecycleRevision!==r.lifecycleRevision)) return fail("stale-reference");
            const tagId = id();
            state.tags[tagId] = {tagId,name,color:"#a9c6ff",revision:0}; state.tagOrder.push(tagId);
            if (c.pinIds?.length) records.forEach(r=>{assignments(r,tagId,true);markUsed(r);});
            return {ok:true,tagId};
          }
          case "ASSIGN_TAG": {
            if (!tag || !validRecords()) return fail("reference-or-tag-unavailable");
            for (const r of records) {
              const base = c.bases?.[r.pinId];
              if (!base || base.generation !== r.generation || base.lifecycleRevision !== r.lifecycleRevision || base.revision !== (r.assignmentRevisions[c.tagId] || 0)) return fail("stale-assignment");
            }
            records.forEach(r=>{assignments(r,c.tagId,Boolean(c.assigned));markUsed(r);}); break;
          }
          case "TOUCH_REFERENCES": {
            // Viewing a Reference records use. Unknown or Trashed ids are ignored rather than failing,
            // because a view is incidental to whatever the user was actually doing.
            const seen = records.filter(Boolean)
              .filter(r => Date.parse(now()) - Date.parse(r.lastUsedAt || r.addedToPinRefAt || 0) >= USE_COALESCING_MS);
            if (!seen.length) return {ok:true, persist:false};
            seen.forEach(markUsed); break;
          }
          case "EDIT_TAG": {
            if (!tag || tag.revision !== c.baseRevision) return fail("stale-tag");
            if (c.name !== undefined) {
              const name=String(c.name).trim();
              if (!name || name.length > 80) return fail("invalid-tag-name");
              const target=collision(name);
              if (target) return {...fail("tag-name-exists"),targetTagId:target.tagId};
              tag.name=name;
            }
            if (c.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(c.color)) return fail("invalid-color"); tag.color=c.color; }
            tag.revision += 1; break;
          }
          case "REORDER_TAGS": {
            if (!Array.isArray(c.tagIds) || new Set(c.tagIds).size !== state.tagOrder.length || c.tagIds.length !== state.tagOrder.length || c.tagIds.some(t=>!state.tags[t])) return fail("stale-tag-order");
            if (JSON.stringify(c.baseOrder) !== JSON.stringify(state.tagOrder)) return fail("stale-tag-order");
            state.tagOrder=[...c.tagIds]; break;
          }
          case "DELETE_TAGS":
          case "MERGE_TAG": {
            const ids = c.type === "MERGE_TAG" ? [c.tagId] : c.tagIds;
            if (!ids?.length || ids.some(t=>!state.tags[t] || state.tags[t].revision !== c.bases?.[t])) return fail("stale-tag");
            if (c.type === "MERGE_TAG" && (!state.tags[c.targetTagId] || ids.includes(c.targetTagId))) return fail("invalid-merge");
            receipt();
            for (const r of [...Object.values(state.references),...Object.values(state.trash)]) {
              if (c.type === "MERGE_TAG" && r.tags.includes(c.tagId)) assignments(r,c.targetTagId,true);
              for (const tagId of ids) if (r.tags.includes(tagId)) assignments(r,tagId,false);
            }
            ids.forEach(t=>delete state.tags[t]); state.tagOrder=state.tagOrder.filter(t=>!ids.includes(t));
            return {ok:true,receiptId:state.receipt.id};
          }
          case "UNDO_TAG_CHANGE": {
            const r=state.receipt;
            if (!r || r.id !== c.receiptId || r.revision !== state.libraryRevision || Date.parse(now()) > r.expiresAt) return fail("undo-expired-or-stale");
            state.tags=r.tags; state.tagOrder=r.tagOrder;
            for (const record of [...Object.values(state.references),...Object.values(state.trash)]) {
              if (r.assignments[record.pinId]) Object.assign(record,r.assignments[record.pinId]);
            }
            state.receipt=null; break;
          }
          case "TRASH": {
            if (!validRecords()) return fail("reference-not-active");
            if(records.some(r=>c.bases?.[r.pinId]?.generation!==r.generation||c.bases?.[r.pinId]?.lifecycleRevision!==r.lifecycleRevision))return fail("stale-reference");
            records.forEach(r=>{r.lifecycleRevision+=1; r.trashedAt=now();state.trash[r.pinId]=r;delete state.references[r.pinId];}); break;
          }
          case "RESTORE":
          case "PERMANENT_DELETE": {
            if (!c.pinIds?.length || c.pinIds.some(p=>!state.trash[p])) return fail("not-in-trash");
            if(c.pinIds.some(p=>c.bases?.[p]?.generation!==state.trash[p].generation||c.bases?.[p]?.lifecycleRevision!==state.trash[p].lifecycleRevision))return fail("stale-reference");
            if(c.type==="PERMANENT_DELETE")state.receipt=null;
            for (const pinId of c.pinIds) {
              if (c.type === "RESTORE") {const r=state.trash[pinId];r.lifecycleRevision+=1;delete r.trashedAt;state.references[pinId]=r;}
              delete state.trash[pinId];
              for (const [key,pin] of Object.entries(state.operations)) if(pin===pinId) delete state.operations[key];
            } break;
          }
          case "BEGIN_CAPTURE": {
            if (!/^\d{6,}$/.test(c.pinId) || !c.attemptId || !Number.isInteger(c.tabId)) return fail("invalid-capture");
            if (state.attempts[c.attemptId]) return fail("attempt-exists");
            // A repeated Save for an existing Reference is a no-op (ADR-0001). Refusing here stops
            // the content script observing Pinterest for an outcome PinRef would discard.
            if (state.references[c.pinId]) return fail("reference-exists");
            state.attempts[c.attemptId]={attemptId:c.attemptId,pinId:c.pinId,originTabId:c.tabId,documentId:c.documentId,url:c.url,
              previewUrl:safePreview(c.previewUrl),images:safePreviews(c.previewUrls),status:"pending",createdAt:now()}; break;
          }
          case "CAPTURE_OUTCOME": {
            const attempt=state.attempts[c.attemptId];
            if (!attempt || attempt.originTabId !== c.tabId || attempt.documentId !== c.documentId || attempt.pinId !== c.pinId) return fail("stale-capture");
            if (!["pending","unconfirmed"].includes(attempt.status)) return fail("capture-already-confirmed");
            attempt.status=c.confirmed ? "confirmed" : "unconfirmed";
            attempt.evidence=c.confirmed ? "same-control-saved-state" : "save-not-confirmed"; break;
          }
          case "COMMIT_CAPTURE": {
            const attempt=state.attempts[c.attemptId];
            if (!attempt || attempt.status !== "confirmed") return fail("save-not-confirmed");
            if (state.trash[attempt.pinId]) {attempt.status="in-trash";break;}
            if (!state.references[attempt.pinId]) state.references[attempt.pinId]={pinId:attempt.pinId,generation:id(),url:`https://www.pinterest.com/pin/${attempt.pinId}/`,previewUrl:attempt.previewUrl,
              images:attempt.images?.length?[...attempt.images]:safePreviews([attempt.previewUrl]),
              tags:[],note:"",noteRevision:0,lifecycleRevision:0,assignmentRevisions:{},linkStatus:"unknown",addedToPinRefAt:now(),lastUsedAt:now()};
            delete state.attempts[c.attemptId]; break;
          }
          case "RECORD_PIN_IMAGES": {
            // Add-only: a Pin the user already has can reveal images PinRef never saw, and recording
            // them must never touch the Reference's own preview, identity or any edited field
            // (ADR-0015). PinRef only writes what Pinterest already rendered; it never fetches.
            const record=state.references[c.pinId];
            const observed=safePreviews(c.previewUrls);
            if (!record || !observed.length) return {ok:true, persist:false};
            const added=observed.filter(url=>!record.images.includes(url));
            if (!added.length) return {ok:true, persist:false};
            record.images=[...record.images, ...added].slice(0, MAX_PIN_IMAGES); break;
          }
          case "DISMISS_ATTEMPT": delete state.attempts[c.attemptId]; break;
          case "RECOVER_CAPTURES":
            Object.values(state.attempts).forEach(a=>{if(a.status==="pending")a.status="unconfirmed";}); break;
          case "INTERRUPT_CAPTURES":
            Object.values(state.attempts).forEach(a=>{if(a.originTabId===c.tabId&&a.status==="pending")a.status="unconfirmed";}); break;
          default:return fail("unknown-library-command");
        }
        return {ok:true};
      });
    }
    return {execute};
  }
  return {createApplication,safePreview};
});
