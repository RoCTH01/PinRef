const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PINREF_BROWSER,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:700,height:600}});
    await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><style>body{height:2000px}a,[role=listitem]{display:block;min-height:70px}</style><h1>Saved Pins</h1><div role="list"><div role="listitem"><a href="/pin/123456789/">One</a></div><div role="listitem"><a href="/pin/title--987654321/">Two</a></div><div role="listitem">No identity</div></div><h2>Recommendations</h2><div role="list"><a href="/pin/999999999/">Outside collection</a></div>'}));
    await page.goto("https://www.pinterest.com/example/_pins/");
    await page.evaluate(()=>{
      window.events=[];window.allowed=true;
      window.chrome={runtime:{onMessage:{addListener(fn){window.receive=fn;}},sendMessage:async(message)=>{window.events.push(message);return {ok:window.allowed,continueScan:window.allowed};}}};
    });
    await page.addScriptTag({path:path.resolve(__dirname,"../extension/content/import-scanner.js")});
    await page.evaluate(()=>window.receive({type:"pinref:startImportScan",sessionId:"fixture",surface:{surfaceKey:location.href}},{},()=>{}));
    await page.waitForFunction(()=>window.events.some(e=>e.eventType==="OBSERVE_BATCH"));
    const batch=await page.evaluate(()=>window.events.find(e=>e.eventType==="OBSERVE_BATCH"));
    assert.deepEqual(batch.observations.map(c=>c.pinId).sort(),["123456789","987654321"]);
    assert.equal(batch.skippedIdentity,1);
    assert.equal(batch.skippedMembership,1);
    await page.evaluate(()=>{window.allowed=false;});
    await page.waitForFunction(()=>window.events.filter(e=>e.eventType==="HEARTBEAT").length>=4);
    const count=await page.evaluate(()=>window.events.length);
    await page.waitForTimeout(750);
    assert.equal(await page.evaluate(()=>window.events.length),count);
    console.log("PASS: trusted collection only, slugged identity, skipped identity, scanner stops when coordinator rejects heartbeat");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
