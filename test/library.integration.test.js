const test=require("node:test");
const assert=require("node:assert/strict");
const {createBrowser}=require("../scripts/browser-fixture.cjs");
async function library() {
  const h=createBrowser();
  const {session}=await h.command({type:"START",tabId:41});
  await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"},{pinId:"987654321"}]);
  await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
  await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
  await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});
  const command=async c=>{
    if(["TRASH","RESTORE","PERMANENT_DELETE"].includes(c.type)&&!c.bases){const s=await h.state(),source=c.type==="TRASH"?s.references:s.trash;c={...c,bases:Object.fromEntries(c.pinIds.map(id=>[id,{generation:source[id].generation,lifecycleRevision:source[id].lifecycleRevision}]))};}
    if(c.type==="CREATE_TAG"&&c.pinIds?.length&&!c.bases){const s=await h.state();c={...c,bases:Object.fromEntries(c.pinIds.map(id=>[id,{generation:s.references[id].generation,lifecycleRevision:s.references[id].lifecycleRevision}]))};}
    return h.message({type:"pinref:libraryCommand",command:c},{url:h.url("dashboard/index.html")});
  };
  const state=async()=>h.message({type:"pinref:getDashboardState"},{url:h.url("dashboard/index.html")});
  return {...h,command,state};
}
test("independent field changes merge; stale same-Tag assignments cannot reverse newer writes",async()=>{
  const h=await library();const r=(await h.state()).references["123456789"];
  const a=await h.command({type:"CREATE_TAG",name:"Lighting"});const b=await h.command({type:"CREATE_TAG",name:"Composition"});
  const base={generation:r.generation,lifecycleRevision:r.lifecycleRevision,revision:0};
  const assign=tagId=>({type:"ASSIGN_TAG",pinIds:[r.pinId],tagId,assigned:true,bases:{[r.pinId]:base}});
  assert.equal((await h.command(assign(a.tagId))).ok,true);
  assert.equal((await h.command(assign(b.tagId))).ok,true);
  assert.equal((await h.command({...assign(a.tagId),assigned:false})).reason,"stale-assignment");
  assert.equal((await h.command({type:"SAVE_NOTE",pinId:r.pinId,text:"A note",baseRevision:0,lifecycleRevision:r.lifecycleRevision,generation:r.generation})).ok,true);
  assert.equal((await h.state()).references[r.pinId].tags.length,2);
});
test("global Merge deduplicates assignments; Undo is atomic and cannot overwrite later changes",async()=>{
  const h=await library();
  const a=await h.command({type:"CREATE_TAG",name:"Lighting",pinIds:["123456789"]});
  const b=await h.command({type:"CREATE_TAG",name:"Mood",pinIds:["123456789","987654321"]});
  const merged=await h.command({type:"MERGE_TAG",tagId:a.tagId,targetTagId:b.tagId,bases:{[a.tagId]:0}});
  assert.equal(merged.ok,true);
  assert.deepEqual(Array.from((await h.state()).references["123456789"].tags),[b.tagId]);
  assert.equal((await h.command({type:"UNDO_TAG_CHANGE",receiptId:merged.receiptId})).ok,true);
  assert.equal(Object.keys((await h.state()).tags).length,2);
  const removed=await h.command({type:"DELETE_TAGS",tagIds:[a.tagId],bases:{[a.tagId]:0}});
  await h.command({type:"EDIT_TAG",tagId:b.tagId,name:"Atmosphere",baseRevision:0});
  assert.equal((await h.command({type:"UNDO_TAG_CHANGE",receiptId:removed.receiptId})).reason,"undo-expired-or-stale");
  assert.equal((await h.state()).tags[b.tagId].name,"Atmosphere");
});
test("Permanent Delete allows a fresh Import but rejects a Note write from the deleted generation",async()=>{
  const h=await library();const r=(await h.state()).references["123456789"];
  await h.command({type:"TRASH",pinIds:[r.pinId]});await h.command({type:"PERMANENT_DELETE",pinIds:[r.pinId]});
  // A subsequent Import uses the same real worker public lifecycle.
  const cmd=c=>h.message({type:"pinref:importCommand",windowId:7,command:c});
  const {session}=await cmd({type:"START",tabId:41});await h.scan(session,"OBSERVE_BATCH",[{pinId:r.pinId}]);
  await cmd({type:"STOP_REVIEW",sessionId:session.sessionId});await cmd({type:"SELECT_ALL_NEW",sessionId:session.sessionId});await cmd({type:"IMPORT_SELECTED",sessionId:session.sessionId});
  assert.notEqual((await h.state()).references[r.pinId].generation,r.generation);
  assert.equal((await h.command({type:"SAVE_NOTE",pinId:r.pinId,text:"Deleted Note",baseRevision:0,lifecycleRevision:0,generation:r.generation})).reason,"stale-reference");
  assert.equal((await h.state()).references[r.pinId].note,"");
});
test("failed Library writes leave committed data authoritative and can be retried",async()=>{
  const h=await library();const original=h.chrome.storage.local.set;
  h.chrome.storage.local.set=async()=>{throw new Error("disk full");};
  assert.equal((await h.command({type:"CREATE_TAG",name:"Retry me",pinIds:["123456789"]})).ok,false);
  assert.equal(Object.keys((await h.state()).tags).length,0);
  h.chrome.storage.local.set=original;
  assert.equal((await h.command({type:"CREATE_TAG",name:"Retry me",pinIds:["123456789"]})).ok,true);
});
test("Side Panel cannot perform Dashboard-owned lifecycle or global delete operations",async()=>{
  const h=await library();const tag=await h.command({type:"CREATE_TAG",name:"Keep me"});
  for(const c of [{type:"TRASH",pinIds:["123456789"]},{type:"DELETE_TAGS",tagIds:[tag.tagId],bases:{[tag.tagId]:0}}])assert.equal((await h.message({type:"pinref:libraryCommand",command:c},{url:h.url("sidepanel/index.html")})).reason,"unavailable-command");
});

test("stale Create-and-assign cannot attach a Tag after Trash and Restore",async()=>{
  const h=await library();const r=(await h.state()).references["123456789"];
  const c={type:"CREATE_TAG",name:"Stale",pinIds:[r.pinId],bases:{[r.pinId]:{generation:r.generation,lifecycleRevision:r.lifecycleRevision}}};
  await h.command({type:"TRASH",pinIds:[r.pinId]});await h.command({type:"RESTORE",pinIds:[r.pinId]});
  assert.equal((await h.command(c)).reason,"stale-reference");assert.equal(Object.keys((await h.state()).tags).length,0);
});
test("preselected Dashboard Merge links can read and mutate Library; Side Panel dismissal is rejected",async()=>{
  const h=await library();const sender={url:h.url("dashboard/index.html?merge=source&target=target")};
  assert.equal((await h.message({type:"pinref:getDashboardState"},sender)).ok,true);
  assert.equal((await h.message({type:"pinref:libraryCommand",command:{type:"CREATE_TAG",name:"Via Dashboard"}},sender)).ok,true);
  assert.equal((await h.message({type:"pinref:libraryCommand",command:{type:"DISMISS_ATTEMPT",attemptId:"missing"}},{url:h.url("sidepanel/index.html")})).ok,false);
});
test("a Reference Name is optional, trimmed, bounded and rejected across Trash",async()=>{
  const h=await library();const r=(await h.state()).references["123456789"];
  const name=value=>({type:"SAVE_NAME",pinId:r.pinId,name:value,lifecycleRevision:r.lifecycleRevision,generation:r.generation});
  assert.equal((await h.command(name("  Warm window light  "))).ok,true);
  assert.equal((await h.state()).references[r.pinId].name,"Warm window light");
  assert.equal((await h.command(name("x".repeat(121)))).reason,"invalid-name");
  assert.equal((await h.command(name(""))).ok,true);
  assert.equal((await h.state()).references[r.pinId].name,"");
  assert.equal((await h.command({type:"TRASH",pinIds:[r.pinId]})).ok,true);
  assert.equal((await h.command(name("After Trash"))).reason,"reference-not-active");
});
