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
    assert.deepEqual(errors,[]);
    console.log("PASS: Dashboard guidance, mobile drawer/focus, Waterfall position continuity, no Import execution");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
