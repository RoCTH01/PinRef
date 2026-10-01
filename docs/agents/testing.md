# Writing tests against the worker

The suites run the production worker and repository behind a simulated Chrome
boundary. That realism is what makes the coverage worth having, and it is also
where every trap below comes from. Read this before adding a test, not after it
goes green.

## A green test proves nothing until you have seen it red

An assertion that cannot fail is worse than no assertion: it reports safety it
never checked. After a test passes, break the code it covers and confirm that
**that specific assertion** is the one that fails. Breaking the code and seeing
*some* test go red is not the same check.

Two ways an assertion quietly dies, both observed in this repo:

- **Another mechanism covers for it.** A `BEGIN_CAPTURE` guard rejecting a Pin
  already in the Library looked tested, but `normalizeState` pruned the Attempt
  anyway, so the state assertion passed with the guard deleted. The guard's real
  job is telling the content script to stop watching Pinterest, so the live
  assertion is on `started.ok === false`.
- **The fixture never reaches the branch.** A rule picking the largest image was
  untestable while the fixture happened to list the main image first. Ordering
  the thumbnail strip *before* it in the DOM is what made the rule load-bearing.

## The fixture is a Chrome stub, not Chrome

`scripts/browser-fixture.cjs` implements only what the worker calls.

- **Arrays cross a vm realm**, so they are never reference-equal to this realm's.
  `assert.deepEqual` on worker state fails with two identical-looking arrays.
  Compare `JSON.stringify([...value])`.
- **Commands take two channels.** `h.command` sends `pinref:importCommand`.
  Library commands (`TRASH`, `RESTORE`, `PERMANENT_DELETE`, Tag and Note writes)
  go through `pinref:libraryCommand` with `{url: h.url("dashboard/index.html")}`.
- **`chrome.tabs.sendMessage` is one function serving several message types.**
  Adding a type means extending it, and a second `sendMessage` key silently
  overwrites the first.
- **A Context Pin needs a snapshot.** Set `chrome.tabs.snapshots` for the tab id
  and put the tab on a matching `/pin/<id>` URL; the worker drops a snapshot
  whose URL disagrees with the tab's.

## Browser checks

- **Changing worker state leaves the page stale.** After `h.message`, call
  `notify()` or the page keeps rendering what it last read.
- **Rendering is async.** `waitForFunction` on the DOM you expect, rather than
  asserting straight after the click.
- **Locators collide across surfaces.** A Tag name appears in both the sidebar
  and the Tag picker; `.summary-art` appears in both Inspectors. Scope to
  `.tag-picker-list`, `.inspector-panel` or `.context-card`.
- **The Side Panel follows the active tab**, so it will not show a Pin the tab is
  not on. Inspector UI that needs a prepared Reference belongs in
  `check-dashboard-library.cjs`, where the Dashboard shows any Reference.
- `scripts/check-extension.cjs` is not in `test:browser` and cannot run:
  branded Chrome ignores `--load-extension`.

## Commands

- **A command that may have nothing to do must return `{ok: true, persist: false}`.**
  Persisting bumps the Library revision, which fires `chrome.storage.onChanged`,
  which re-renders, which runs the command again. `TOUCH_REFERENCES` and
  `RECORD_PIN_IMAGES` both depend on this.
- **The allow-list in `background.js` is a trust boundary.** A command absent
  from it can be sent only by the worker. `RECORD_PIN_IMAGES` is kept out
  deliberately, so a page cannot write images into a Reference.
