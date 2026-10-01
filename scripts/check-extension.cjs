const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const path=require("node:path");
const fs=require("node:fs");
const os=require("node:os");

// Isolated unpacked-extension smoke: real Chrome runtime/storage, no Pinterest account.
(async()=>{
  const extension=path.resolve(__dirname,"../extension");
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"pinref-extension-check-"));
  const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.PINREF_BROWSER,headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const errors=[];
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
    const workerUrl=new URL(worker.url());
    const origin=`${workerUrl.protocol}//${workerUrl.host}`;
    const dashboard=await context.newPage();dashboard.on("pageerror",error=>errors.push(error.message));
    await dashboard.goto(`${origin}/dashboard/index.html`);
    await dashboard.getByRole("heading",{name:"Your local Library is empty"}).waitFor();
    dashboard.once("dialog",dialog=>dialog.accept("Smoke Tag"));
    await dashboard.getByRole("button",{name:"Create Tag",exact:true}).click();
    await dashboard.getByRole("button",{name:"Manage Tag Smoke Tag",exact:true}).waitFor({state:"attached"});
    const panel=await context.newPage();panel.on("pageerror",error=>errors.push(error.message));
    await panel.goto(`${origin}/sidepanel/index.html`);
    await panel.getByRole("heading",{name:"No Context Pin",exact:true}).waitFor();
    await dashboard.locator("button[data-theme]").click();
    await panel.waitForFunction(()=>document.documentElement.dataset.theme==="light");
    assert.equal(await worker.evaluate(async()=>Object.keys((await chrome.storage.local.get("pinrefState")).pinrefState.tags).length),1);
    assert.deepEqual(errors,[]);
    console.log(`PASS: unpacked extension worker, real storage, Dashboard and Side Panel; isolated profile ${profile}`);
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
