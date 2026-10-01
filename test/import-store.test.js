const test = require("node:test");
const assert = require("node:assert/strict");

const { STORAGE_KEY, createChromeRepository } = require("../extension/import/store.js");

function fakeStorage() {
  const values = {};
  return {
    values,
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(next) { Object.assign(values, structuredClone(next)); }
  };
}

test("local Reference commit is idempotent by operation and never persists Board context", async () => {
  const storage = fakeStorage();
  const repository = createChromeRepository(storage);
  const input = {
    operationId: "import:session-1:111111111111",
    candidate: {
      pinId: "111111111111",
      previewUrl: "https://i.pinimg.com/a.jpg",
      boardContext: "must not persist"
    },
    importedAt: "2026-09-30T05:00:00.000Z"
  };

  const first = await repository.commitReference(input);
  const second = await repository.commitReference({ ...input, importedAt: "2026-09-30T06:00:00.000Z" });

  assert.equal(first.status, "imported");
  assert.deepEqual(second.record, first.record);
  assert.equal(second.record.addedToPinRefAt, "2026-09-30T05:00:00.000Z");
  assert.equal("boardContext" in second.record, false);
  assert.equal(Object.keys(storage.values[STORAGE_KEY].references).length, 1);
});

test("active duplicates and Trash remain non-destructive import outcomes", async () => {
  const storage = fakeStorage();
  storage.values[STORAGE_KEY] = {
    version: 1,
    references: { "222222222222": { pinId: "222222222222" } },
    trash: { "333333333333": { pinId: "333333333333" } },
    importSessions: {},
    operations: {}
  };
  const repository = createChromeRepository(storage);

  assert.deepEqual(await repository.getReferenceStates(["111111111111", "222222222222", "333333333333"]), {
    "111111111111": null,
    "222222222222": "active",
    "333333333333": "trash"
  });
  assert.equal((await repository.commitReference({ operationId: "duplicate", candidate: { pinId: "222222222222" }, importedAt: "now" })).status, "duplicate");
  assert.equal((await repository.commitReference({ operationId: "trash", candidate: { pinId: "333333333333" }, importedAt: "now" })).status, "in-trash");
  assert.ok(storage.values[STORAGE_KEY].trash["333333333333"]);
});

test("sessions saved by the Dashboard implementation open as results, not an endless importing state",async()=>{
  const storage=fakeStorage();
  storage.values[STORAGE_KEY]={version:1,importSessions:{old:{sessionId:"old",status:"importing",updatedAt:"2026-09-30T05:00:00Z",candidates:{"123456789":{pinId:"123456789",result:"imported"}},completionEvidence:{confidence:"reliable"}}}};
  const session=await createChromeRepository(storage).getSession("old");
  assert.equal(session.status,"results");
  assert.equal(session.importStartedAt,"2026-09-30T05:00:00Z");
  assert.equal(session.scanComplete,true);
});

test("version 2 migration preserves Library, Trash, session and string Tags with stable IDs",async()=>{
  const storage=fakeStorage();
  storage.values[STORAGE_KEY]={version:2,references:{"123456789":{pinId:"123456789",note:"Keep this",tags:["Lighting"],addedToPinRefAt:"2026-09-30T00:00:00Z"}},trash:{"987654321":{pinId:"987654321",tags:["lighting"]}},importSessions:{unfinished:{sessionId:"unfinished",status:"paused",candidates:{}}}};
  const repo=createChromeRepository(storage);const before=await repo.readState();
  assert.equal(before.version,3);assert.equal(Object.keys(before.tags).length,1);
  assert.equal(before.references["123456789"].tags[0],before.trash["987654321"].tags[0]);
  await repo.updateState(state=>{state.preferences.theme="light";return {ok:true};});
  const after=await repo.readState();
  assert.equal(after.references["123456789"].note,"Keep this");
  assert.equal(after.references["123456789"].generation,before.references["123456789"].generation);
  assert.equal(after.importSessions.unfinished.status,"paused");assert.equal(after.preferences.theme,"light");
});
