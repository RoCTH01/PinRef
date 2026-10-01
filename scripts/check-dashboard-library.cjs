const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {createBrowser}=require("./browser-fixture.cjs");

// Dashboard-owned Library management against the real worker, applications and repository.
// Tags carry optimistic-concurrency bases, so these checks confirm the Dashboard builds the
// commands the worker expects rather than only that the worker accepts well-formed ones.
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PINREF_BROWSER,headless:true});
  const h=createBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
  const pages=new Map();
  const notify=()=>{for(const page of pages.keys())if(!page.isClosed())page.evaluate(()=>window.fixtureNotify?.()).catch(()=>{});};
  try {
    await context.route("https://i.pinimg.com/**",route=>route.fulfill({contentType:"image/svg+xml",
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#465955"/></svg>'}));
    await context.exposeBinding("fixtureMessage",async({page},message)=>{
      const result=await h.message(message,{url:h.url(`${pages.get(page)}/index.html`)});
      if(!message.type.startsWith("pinref:get"))setImmediate(notify);
      return structuredClone(result);
    });
    await context.addInitScript(()=>{
      const listeners=[];
      window.fixtureNotify=()=>listeners.forEach(fn=>fn({pinrefState:{}},"local"));
      window.chrome={runtime:{sendMessage:m=>window.fixtureMessage(m),onMessage:{addListener(){}},
        connect:()=>({onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}})},
        windows:{getCurrent:async()=>({id:7})},storage:{onChanged:{addListener:fn=>listeners.push(fn)}}};
    });
    const open=async(query="")=>{
      const page=await context.newPage();
      pages.set(page,"dashboard");
      page.on("pageerror",error=>errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,"../extension/dashboard/index.html")).href+query);
      return page;
    };

    const {session}=await h.command({type:"START",tabId:41});
    await h.scan(session,"OBSERVE_BATCH",[{pinId:"123456789"},{pinId:"987654321"},{pinId:"555555555"}]);
    await h.command({type:"STOP_REVIEW",sessionId:session.sessionId});
    await h.command({type:"SELECT_ALL_NEW",sessionId:session.sessionId});
    await h.command({type:"IMPORT_SELECTED",sessionId:session.sessionId});

    const page=await open();
    const state=async()=>h.message({type:"pinref:getDashboardState"},{url:h.url("dashboard/index.html")});
    const tagNamed=async name=>Object.values((await state()).tags).find(t=>t.name===name);
    // The worker runs in a vm realm, so its arrays are never reference-equal to this realm's.
    const tagsOf=async pinId=>JSON.stringify([...(await state()).references[pinId].tags]);
    const ids=(...values)=>JSON.stringify(values);
    const sidebarTags=()=>page.$$eval(".sidebar-tag-list [data-filter]",items=>items.map(el=>el.querySelector("span:nth-child(2)").textContent));
    const addTag=async name=>{
      await page.getByRole("button",{name:"Add Tag",exact:true}).click();
      await page.getByRole("textbox",{name:"Find or create Tag"}).fill(name);
      const existing=page.locator(".tag-picker-list .tag-option",{hasText:name});
      if(await existing.count())await existing.click();
      else await page.getByRole("button",{name:`Create “${name}” & assign`}).click();
      await page.waitForFunction(label=>[...document.querySelectorAll(".tag-name")].some(el=>el.textContent===label),name);
      await page.getByRole("button",{name:"Done",exact:true}).click();
    };

    // Creating a Tag from the picker assigns it only to the current selection.
    await page.locator('[data-select="123456789"]').click();
    await addTag("Lighting");
    const lighting=await tagNamed("Lighting");
    assert.equal(await tagsOf("123456789"),ids(lighting.tagId));
    assert.equal(await tagsOf("987654321"),ids());

    // A multi-selection shows only the Tags every Reference has, and assigning from the picker
    // applies to all of them in one command.
    await page.locator('[data-toggle-select="987654321"]').click();
    await page.waitForFunction(()=>document.querySelector(".panel-heading small")?.textContent==="2 selected");
    await page.getByRole("heading",{name:"Common Tags"}).waitFor();
    assert.equal(await page.locator(".editable-tag").count(),0,"a Tag only one Reference has is not a common Tag");
    await page.getByRole("button",{name:"Add Tag",exact:true}).click();
    await page.locator(".tag-picker-list .tag-option",{hasText:"Lighting"}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".editable-tag").length===1);
    await page.getByRole("button",{name:"Done",exact:true}).click();
    assert.equal(await tagsOf("987654321"),ids(lighting.tagId));

    // Removing a common Tag from a multi-selection removes it from every selected Reference.
    await page.getByRole("button",{name:"Remove Lighting from selection"}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".editable-tag").length===0);
    assert.equal(await tagsOf("123456789"),ids());
    assert.equal(await tagsOf("987654321"),ids());

    // The global Tag editor renames every assignment at once, and a name already in use is refused
    // with the Merge advice rather than silently creating a duplicate Tag.
    await addTag("Lighting");
    const studies=await tagNamed("Lighting");
    await page.locator('[data-toggle-select="987654321"]').click();
    await page.waitForFunction(()=>document.querySelector(".panel-heading small")?.textContent==="1 selected");
    await addTag("Mood");
    const mood=await tagNamed("Mood");

    await page.getByRole("button",{name:"Manage Tag Lighting",exact:true}).click();
    await page.getByRole("textbox",{name:"Name",exact:true}).fill("Lighting Studies");
    await page.keyboard.press("Enter");
    await page.waitForFunction(()=>[...document.querySelectorAll(".sidebar-tag-list [data-filter] span:nth-child(2)")].some(el=>el.textContent==="Lighting Studies"));
    assert.equal((await state()).tags[studies.tagId].name,"Lighting Studies");
    assert.equal(await tagsOf("123456789"),ids(studies.tagId,mood.tagId),"renaming a Tag never changes its assignments");

    // Colour and order are Tag-wide settings carried by the same optimistic base revision.
    await page.locator("[data-tag-color]").evaluate(el=>{el.value="#ff8800";el.dispatchEvent(new Event("change",{bubbles:true}));});
    await page.waitForFunction(()=>[...document.querySelectorAll(".sidebar-tag-list .tag-dot")].some(el=>el.style.getPropertyValue("--tag-color")==="#ff8800"));
    assert.equal((await state()).tags[studies.tagId].color,"#ff8800");
    assert.equal(JSON.stringify(await sidebarTags()),ids("Lighting Studies","Mood"));
    await page.getByRole("button",{name:"Move down",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector(".sidebar-tag-list [data-filter] span:nth-child(2)")?.textContent==="Mood");
    assert.equal(JSON.stringify(await sidebarTags()),ids("Mood","Lighting Studies"));

    // Renaming onto a name already in use is refused and offers Merge instead, which is the only
    // way to combine two Tags. Merging keeps the target and folds the source's assignments in.
    await page.getByRole("textbox",{name:"Name",exact:true}).fill("Mood");
    await page.keyboard.press("Enter");
    await page.getByText("Name exists — choose Merge or another name").waitFor();
    assert.equal((await state()).tags[studies.tagId].name,"Lighting Studies","a refused rename leaves the Tag untouched");
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Merge into existing Tag",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".sidebar-tag-list [data-filter]").length===1);
    assert.equal((await state()).tags[studies.tagId],undefined);
    assert.equal(await tagsOf("123456789"),ids(mood.tagId));
    assert.equal(await tagsOf("987654321"),ids(mood.tagId),"the merged-away Tag's assignments move to the target");

    // Merge and global delete are the two commands that leave a receipt, so Undo can put back both
    // the Tag and the assignments they removed.
    await page.getByRole("button",{name:"Undo Tag change",exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll(".sidebar-tag-list [data-filter] span:nth-child(2)")].some(el=>el.textContent==="Lighting Studies"));
    assert.equal((await state()).tags[studies.tagId].name,"Lighting Studies");
    assert.equal(await tagsOf("987654321"),ids(studies.tagId),"Undo restores the assignments the merge rewrote");

    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-tag-name]",{state:"detached"});

    // The sidebar deletes a multi-selection of Tags in one guarded command.
    await page.locator(`[data-tag-select="${studies.tagId}"]`).check();
    await page.locator(`[data-tag-select="${mood.tagId}"]`).check();
    await page.getByText("2 Tags selected",{exact:true}).waitFor();
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Delete",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".sidebar-tag-list [data-filter]").length===0);
    assert.equal(Object.keys((await state()).tags).length,0);
    assert.equal(await tagsOf("123456789"),ids());

    // Search spans the three things a Reference carries: its Name, its Note and its Pin ID.
    await page.locator('[data-select="555555555"]').click();
    await page.getByRole("textbox",{name:"Name for Pin 555555555"}).fill("Brass sconce");
    await page.getByRole("textbox",{name:"Note for Pin 555555555"}).fill("warm diffuse glow");
    await page.getByRole("textbox",{name:"Note for Pin 555555555"}).blur();
    await page.waitForFunction(async()=>(await window.fixtureMessage({type:"pinref:getDashboardState"})).references["555555555"].note.text==="warm diffuse glow");
    const visible=()=>page.$$eval("[data-select]",cards=>cards.map(el=>el.dataset.select).sort());
    for(const [query,label] of [["brass","Name"],["diffuse","Note"],["5555","Pin ID"]]) {
      await page.getByRole("combobox",{name:"Search Library"}).fill(query);
      await page.waitForFunction(()=>document.querySelectorAll("[data-select]").length===1);
      assert.equal(JSON.stringify(await visible()),ids("555555555"),`search matches on ${label}`);
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-suggest]").count(),0,"Escape closes the suggestion list");

    // Choosing a Tag suggestion replaces the free-text query with that Tag's filter.
    await page.locator('[data-select="555555555"]').click();
    await addTag("Sconces");
    const sconces=await tagNamed("Sconces");
    await page.getByRole("combobox",{name:"Search Library"}).fill("sconc");
    await page.locator("[data-suggest]",{hasText:"Sconces"}).click();
    await page.waitForFunction(()=>document.querySelector("[data-search]")?.value==="");
    assert.equal(JSON.stringify(await visible()),ids("555555555"));

    // Untagged is the complement of every Tag assignment, not a stored flag.
    await page.locator('[data-destination="untagged"]').click();
    await page.waitForFunction(()=>document.querySelector(".gallery-context strong")?.textContent==="Untagged");
    assert.equal(JSON.stringify(await visible()),ids("123456789","987654321"));

    // Trash holds a Reference with its Tags and Note intact until it is restored or purged.
    await page.locator('[data-select="123456789"]').click();
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:/Move 1 to Trash/}).click();
    await page.locator('[data-destination="trash"]').click();
    await page.waitForFunction(()=>document.querySelectorAll("[data-restore]").length===1);
    assert.equal(Object.keys((await state()).trash).length,1);
    assert.equal((await state()).tags[sconces.tagId].name,"Sconces","trashing a Reference keeps its Tags");

    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Permanent Delete",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll("[data-restore]").length===0);
    assert.equal(Object.keys((await state()).trash).length,0);
    assert.equal(Object.keys((await state()).references).length,2,"a permanent delete never touches the Library");

    assert.deepEqual(errors,[]);
    console.log("PASS: Dashboard Tag picker, global Tag editor, guarded delete, Undo, search and Trash");
  } catch(error) {
    for(const page of pages.keys())if(!page.isClosed())await page.screenshot({path:"/tmp/pinref-dashboard-library.png"});
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
