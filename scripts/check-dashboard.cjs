const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
// Requires Playwright; PINREF_BROWSER may point to a Chromium executable.
(async () => {
  const browser = await chromium.launch({ executablePath:process.env.PINREF_BROWSER, headless:true });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000} });
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.chrome={runtime:{sendMessage:async message=>{if(message.type!=="pinref:getDashboardState")throw new Error("Dashboard attempted Import");return {ok:true,references:{}};}},storage:{onChanged:{addListener(){}}}};
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,"../extension/dashboard/index.html")).href);
    await page.getByRole("heading",{name:"Your local Library is empty"}).waitFor();
    await page.locator('.sidebar-item[data-destination="import-guide"]').click();
    await page.getByRole("heading",{name:"Import beside the collection you want"}).waitFor();
    assert.equal(await page.locator("select, [data-action=START]").count(),0);
    await page.setViewportSize({width:390,height:844});
    await page.locator("[data-open]").click();
    await page.waitForFunction(()=>document.querySelector("#main-content").inert);
    assert.equal(await page.locator("#main-content").evaluate(el=>el.inert),true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-open]").evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const layoutPage=await browser.newPage({viewport:{width:1440,height:1000}});
    layoutPage.on("pageerror",error=>errors.push(error.message));
    await layoutPage.addInitScript(()=>{
      const references={};
      for(let index=0;index<28;index++){
        const pinId=String(100000+index);
        references[pinId]={pinId,previewUrl:`https://i.pinimg.com/fixture/${index}.svg`,tags:[],note:"",addedToPinRefAt:new Date(Date.UTC(2026,8,30,0,index)).toISOString()};
      }
      window.chrome={runtime:{sendMessage:async()=>({ok:true,references,preferences:{theme:"dark",galleryMode:"waterfall",inspectorMode:"docked"}})},storage:{onChanged:{addListener(){}}}};
    });
    await layoutPage.route("https://i.pinimg.com/**",route=>{
      const index=Number(route.request().url().match(/\/(\d+)\.svg$/)?.[1]||0);
      const height=210+(index%5)*100;
      return route.fulfill({contentType:"image/svg+xml",body:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${height}"><rect width="400" height="${height}" fill="#7e9aa2"/></svg>`});
    });
    await layoutPage.goto(pathToFileURL(path.resolve(__dirname,"../extension/dashboard/index.html")).href);
    await layoutPage.locator(".ref-card img").first().waitFor();
    await layoutPage.waitForFunction(()=>[...document.querySelectorAll(".ref-card img")].every(image=>image.complete));
    await layoutPage.locator("#main-content").evaluate(el=>{el.scrollTop=280;});
    await layoutPage.waitForTimeout(250);
    const geometry=()=>layoutPage.evaluate(()=>({width:document.querySelector(".contact-sheet").getBoundingClientRect().width,top:Object.fromEntries([...document.querySelectorAll(".ref-card")].map(card=>[card.dataset.card,Math.round(card.getBoundingClientRect().top)]))}));
    const before=await geometry();
    await layoutPage.locator("[data-open]").click();
    await layoutPage.waitForTimeout(350);
    const closed=await geometry();
    assert.ok(Math.abs(before.width-closed.width)<2,"Waterfall width should not change when sidebar closes");
    assert.ok(Object.keys(before.top).every(id=>Math.abs(before.top[id]-closed.top[id])<5),`Pins should keep their vertical positions when sidebar closes: ${JSON.stringify({before:before.top,closed:closed.top})}`);
    await layoutPage.locator("[data-open]").click();
    await layoutPage.waitForTimeout(350);
    const reopened=await geometry();
    assert.ok(Object.keys(before.top).every(id=>Math.abs(before.top[id]-reopened.top[id])<5),"Pins should keep their vertical positions when sidebar reopens");
    await layoutPage.screenshot({path:"/tmp/pinref-dashboard-waterfall.png"});

    // Recently used orders by use, and pins that order on arrival so selecting a Reference cannot
    // reorder the Gallery under the pointer.
    const usePage=await browser.newPage({viewport:{width:1440,height:1000}});
    usePage.on("pageerror",error=>errors.push(error.message));
    await usePage.addInitScript(()=>{
      const at=minute=>new Date(Date.UTC(2026,8,30,0,minute)).toISOString();
      // Added oldest-to-newest, but used in the opposite order, so the two sorts cannot agree.
      const references={
        "100001":{pinId:"100001",previewUrl:null,tags:[],note:"",addedToPinRefAt:at(1),lastUsedAt:at(30)},
        "100002":{pinId:"100002",previewUrl:null,tags:[],note:"",addedToPinRefAt:at(2),lastUsedAt:at(20)},
        "100003":{pinId:"100003",previewUrl:null,tags:[],note:"",addedToPinRefAt:at(3),lastUsedAt:at(10)}
      };
      window.pinrefCommands=[];
      window.chrome={runtime:{sendMessage:async message=>{
        if(message.type==="pinref:libraryCommand"){
          window.pinrefCommands.push(message.command);
          // The worker really does move use forward, so an unpinned sort would reorder the Gallery here.
          if(message.command.type==="TOUCH_REFERENCES")message.command.pinIds.forEach(id=>{references[id].lastUsedAt=at(59);});
          return {ok:true};
        }
        return {ok:true,references,preferences:{theme:"dark",galleryMode:"masonry",inspectorMode:"floating"}};
      }},storage:{onChanged:{addListener(){}}},windows:{getCurrent:async()=>({id:7})}};
    });
    await usePage.goto(pathToFileURL(path.resolve(__dirname,"../extension/dashboard/index.html")).href);
    await usePage.locator(".ref-card").first().waitFor();
    const order=()=>usePage.$$eval(".ref-card",cards=>cards.map(card=>card.dataset.card));
    assert.deepEqual(await order(),["100003","100002","100001"],"All Pins sorts by when a Reference was added");
    await usePage.locator('.sidebar-item[data-destination="recent"]').click();
    await usePage.waitForFunction(()=>document.querySelector(".gallery-context strong")?.textContent==="Recently used");
    assert.deepEqual(await order(),["100001","100002","100003"],"Recently used sorts by when a Reference was last used");
    await usePage.locator('[data-select="100003"]').click();
    await usePage.locator(".inspector-panel").waitFor();
    await usePage.waitForFunction(()=>window.pinrefCommands.some(c=>c.type==="TOUCH_REFERENCES"));
    assert.deepEqual(await usePage.evaluate(()=>window.pinrefCommands.find(c=>c.type==="TOUCH_REFERENCES").pinIds),["100003"],"selecting a Reference records use");
    assert.deepEqual(await order(),["100001","100002","100003"],"the order stays pinned while Recently used is open");
    await usePage.locator('.sidebar-item[data-destination="library"]').click();
    await usePage.waitForFunction(()=>document.querySelector(".gallery-context strong")?.textContent==="All Pins");
    await usePage.locator('.sidebar-item[data-destination="recent"]').click();
    await usePage.waitForFunction(()=>document.querySelector(".gallery-context strong")?.textContent==="Recently used");
    assert.deepEqual(await order(),["100003","100001","100002"],"leaving and returning re-reads use from the Library, so the touched Reference moves to the front");

    assert.deepEqual(errors,[]);
    console.log("PASS: Dashboard guidance, mobile drawer/focus, Waterfall position continuity, Recently used order, no Import execution");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
