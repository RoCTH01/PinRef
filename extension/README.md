# PinRef production extension

Load this `extension/` directory as an unpacked extension, then reload Pinterest. Chrome 142+ is required for the native Side Panel close event; Chromium derivatives must expose the same API. The extension action opens PinRef's Side Panel on Pinterest and on other pages.

## Import

1. Open `https://www.pinterest.com/<account>/_pins/` or one concrete Board. `_boards/`, Home, Search, and individual `/pin/<id>/` pages cannot start collection Import.
2. Click PinRef in the extension toolbar. Check the current source type and URL before choosing **Start scan**. If access is unavailable, the panel requests Pinterest-only access from that Start action; approval continues the requested scan.
3. Keep the original tab and page open. You may interact with the panel; switching tabs, opening a Pin, leaving the browser window, or closing the panel preserves a Partial session.
4. Choose **Stop & review**, or review when scanning ends. Select individual candidates or **Select all new**, then **Import selected**. Existing References and In Trash are not selectable.
5. A Partial review may Resume from the original active tab before local import begins, keeping its selections. Closing that original tab prevents Resume even if a new tab opens the same URL; retained candidates remain reviewable.
6. Confirmed writes continue after panel closure. Reopening reconciles pending writes using the original operation IDs. Retry failed items; Done removes session data after confirmation, and Dismiss never rolls back committed References.

## This Pin and Library

The panel follows the active page rather than manual mode tabs: This Pin on Pinterest Home or an individual Pin, Import on Saved Pins or a concrete Board, and an idle guide elsewhere (ADR-0012). An unfinished Import Session stays discoverable and keeps its original source when Pinterest navigation changes. Native Save starts a Capture Attempt, not a Reference. A same-control Saved transition must retain the same Pin, tab and document before the local commit. Unconfirmed attempts remain recoverable in Needs Attention. Save during a scan pauses that Import as Partial. Dashboard navigation during scanning asks first.

Dashboard now uses the Contact Sheet prototype: image-only Gallery, Tag sidebar, search over committed Tags and Notes, newest/oldest sorting, Masonry/Waterfall, and one Floating/Docked Inspector. Click a card to inspect it; use its selection checkbox, Shift range, or Cmd/Ctrl-click for multiple References. The Inspector edits common Tag assignments; its Note rail edits only the explicitly selected Note. Below 900 px, navigation becomes a drawer and Inspector becomes a bottom sheet. Theme is shared across both surfaces; layout preferences persist, Gallery selection does not.

Tags have stable identities with global rename/color, ordering, explicit Merge, global deletion and short-lived guarded Undo. Note drafts autosave, remain attached to their Reference after context changes, and offer retry/discard/conflict recovery. Trash, Restore, Permanent Delete and Capture dismissal live in Dashboard. All local mutations use the worker's shared serialized command queue; lifecycle and field revisions reject stale edits.

Preview Reload and Pinterest status checks use the same identifiable Pin in an already-open Pinterest tab. They do not navigate silently or infer failure from a missing DOM signal. Failed preview checks keep the prior image; unknown Pinterest status does not delete Library data.

Dashboard does not select Import sources or execute Import commands. Storage schema 3 preserves existing References, Trash and unfinished Import Sessions and migrates legacy Tag names to stable identities. Prototype storage remains separate and is not imported as real data.

## Verification

- `npm test`: Import lifecycle, storage migration and Library/worker integration, including concurrency, guarded Tag Undo, lifecycle generations and Capture binding.
- `npm run typecheck`: JavaScript syntax validation (not TypeScript type analysis).
- `npm run test:browser`: requires Playwright and a Chromium browser. Optionally set `PINREF_BROWSER` to its executable. Uses local fixtures and real Import application/store modules; scanner network requests are intercepted. No Pinterest account is used.
- `node scripts/check-extension.cjs`: isolated unpacked-extension smoke with real runtime/storage. Requires the same browser/Playwright setup and an executable supporting unpacked extensions.

The one-profile product journey uses the production worker, applications and repository across Import, Dashboard, metadata editing, failed Note writes with concurrent edits, Trash/Restore, native Save, This Pin and shared theme. Browser coverage also checks 320/360 px Import, 390 px Dashboard, focus, source mismatch, Resume selection, Duplicate/Trash exclusion, Done and trusted collection boundaries. See [integration verification](../docs/verification/prototype-integration.md) for the prototype mapping and release gates.

Still validate on signed-in Chrome/Pinterest: native panel opening/closing, real permission dialogs, Save success/failure/cancel and Board-picker variants, per-tab Context Pin, Saved Pins and Board DOM/SPA variants, secret/collaborative Boards, interruption and restart. Fixture success and unpacked Brave smoke do not establish these real-site guarantees; the build is not release-validated until that matrix passes.
