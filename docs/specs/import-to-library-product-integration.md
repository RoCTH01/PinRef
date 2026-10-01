# Integrate the PinRef prototypes into one production Side Panel and Dashboard

> Revised on 2026-10-01: Inspector placement and Dashboard hosting follow ADR-0013, and Notes follow ADR-0014. Where this spec mentions a Side Panel, read the Docked Inspector on Pinterest; Local Draft, Updated elsewhere and Note conflict stories are superseded; the Dashboard has no in-page Docked layout. The Side Panel exists only on Pinterest and the Dashboard; the idle guide applies to unsupported Pinterest pages, and the action elsewhere opens the Dashboard (ADR-0012). Preview Reload and Pinterest status checks are removed (ADR-0015); References gain an optional Reference Name.

## Problem Statement

PinRef can scan a Pinterest Saved Pins collection or Board in its Side Panel, review candidates, and commit selected References to the local Library. After Import, the production Dashboard shows a basic image list, while the Dashboard prototype demonstrates a full Contact Sheet, search, Tags, Note editing, multi-selection, Inspector, Needs Attention, and Trash. The Pinterest integration prototype also demonstrates Context Pin and native-Save Capture behavior. Today these remain disconnected experiences: a person cannot use the complete prototype interactions with the same committed References and recovery state in production.

The prototypes include in-memory records, fixed counts, simulated outcomes, and earlier Dashboard-owned Import behavior. Those shortcuts do not define the production data model or current Import ownership. The integration must preserve proven tab binding, trusted collection boundaries, Partial, Resume, and local commits while implementing the complete user-facing prototype experience against real Local-first Library state.

## Solution

Make the Side Panel and Dashboard one PinRef product with the Docked Inspector's visual language and a shared Local-first Library. The Side Panel automatically shows This Pin, Import, or an idle guide from the active page rather than manual mode tabs. This Pin shows the active tab's Context Pin, native-Save Capture state, PinRef Library Status, Pinterest Link Status, Tags, Note, and recovery actions. Import keeps the complete Bootstrap Import lifecycle beside its bound Pinterest Import Surface. The Dashboard implements the Contact Sheet prototype's Library, search, Tag management, multi-selection, editable Inspector, Needs Attention, and Trash with real state and durable operations.

Restore the prototype's three-region Contact Sheet, responsive drawer and bottom sheet, Floating/Docked Inspector, search placement, Masonry/Waterfall modes, and interaction hierarchy at high fidelity. Implement the Tag entity, Tag Assignment, Local Draft, Capture Attempt, revision, Trash, and status contracts defined by the existing product decisions and ADRs. An Import result offers View Library, which opens All Pins sorted by actual PinRef-added time without automatically selecting References. The Dashboard guides users back to Pinterest for another Import but does not scan or select an Import Surface.

This is the complete integration target rather than a limited visual milestone. Implementation may be organized internally, but acceptance requires the complete user-facing flow and the real Chrome/Pinterest evidence gates listed below.

## User Stories

1. As a Pinterest user, I want the extension action to open the Side Panel beside my current page, so that I can see which page would be scanned.
2. As a Pinterest user, I want Saved Pins, a concrete Board, an individual Pin, and unsupported pages to have distinct states, so that I know when collection Import is available.
3. As a Pinterest user, I want the Side Panel to show the current Import Surface and its URL without using a browser tab notification title as the Board name, so that I do not mistake notification counts for Pin counts.
4. As a Pinterest user, I want a clear next step on an unsupported Pinterest page, so that I can open a Saved Pins collection or a concrete Board before starting.
5. As a Pinterest user, I want scanning to begin only after I choose Start scan, so that opening the panel never scrolls or reads a collection unexpectedly.
6. As a Pinterest user, I want an explanation of data handling before my first scan, so that I understand local storage, scrolling, temporary Board context, and revocable access.
7. As a Pinterest user, I want the access request to appear only if Start or Resume needs it, so that the permission control does not look like a prerequisite on every page.
8. As a Pinterest user, I want successful permission approval to continue my requested scan, so that I do not need to press Start or Resume twice.
9. As a Pinterest user, I want a denied permission request to leave the session and source intact, so that I can retry without losing work.
10. As a Pinterest user, I want an active scan to show observed candidate progress and a reminder to keep the source page unchanged, so that I understand the scanner's behavior.
11. As a Pinterest user, I want Stop & review to preserve the observed Pins and mark the scan Partial, so that I can act without a false completeness claim.
12. As a Pinterest user, I want interrupted or unconfirmed scans to retain their original source and candidates, so that I can review or Resume when the original tab is available.
13. As a Pinterest user, I want the review summary to label its observed candidate count Total, so that it is clear what that number represents.
14. As a Pinterest user, I want new candidates unselected by default, so that Import is an explicit decision.
15. As a Pinterest user, I want Select all new and Deselect all new alongside individual selection, so that I can quickly change my choice.
16. As a Pinterest user, I want Duplicate and In Trash candidates visibly classified and unavailable for selection, so that I cannot create another Reference or silently restore a Trashed Reference.
17. As a Pinterest user, I want a scan with no new candidates to say that there is nothing to add and offer a clear way to finish, so that I am not left facing a disabled Import button.
18. As a Pinterest user, I want the Import results screen to summarize committed References without keeping their images in the selection list, so that completed work looks complete.
19. As a Pinterest user, I want unselected candidates and failed writes to have separate follow-up actions, so that I can review remaining candidates or retry failures without repeating successful writes.
20. As a Pinterest user, I want Partial scan evidence shown separately from imported and failed write counts, so that I do not mistake an incomplete scan for a failed Import.
21. As a Pinterest user, I want Done or Dismiss to remove only the temporary Import Session, so that committed References remain in my Library.
22. As a Pinterest user, I want View Library after a successful Import, so that I can inspect the References I just added when I choose.
23. As a Library user, I want committed References shown as an image-only Contact Sheet, so that I can browse visually without repeated captions.
24. As a Library user, I want sorting placed in the prototype's Gallery toolbar, so that I can find recently imported References quickly.
25. As a Library user, I want sorting by actual PinRef import time, so that Recently added reflects local commits rather than an invented Pinterest save time.
26. As a Library user, I want to select one or multiple References in the Gallery, so that I can inspect the current selection in one consistent place.
27. As a Library user, I want a Floating or Docked Inspector whose placement survives changing the selected Reference, so that I can keep my preferred workspace arrangement.
28. As a Library user, I want the Inspector to show the committed fields PinRef actually knows, including preview, identity, Tags, Note, added time, status, and original link, so that I can inspect and edit a Reference without inferred Board metadata.
29. As a Library user, I want an empty Docked Inspector to remain a useful placeholder and a cleared Floating Inspector to close, so that each placement behaves as expected.
30. As a Library user, I want the navigation sidebar, Gallery, and Inspector to adapt to a narrow window using the prototype's drawer and bottom sheet pattern, so that I can still navigate and inspect Pins.
31. As a keyboard user, I want visible focus, named controls, and focus returned after transient surfaces close, so that I can complete Import and Library inspection without a mouse.
32. As a user with multiple Pinterest tabs, I want an Import Session to remain bound to its original tab and collection while Dashboard selection stays independent, so that a tab change never retargets my scan or selects the wrong Reference.
33. As a user reopening PinRef, I want committed References and unfinished Import Sessions restored from the same local browser profile, so that closing the panel does not erase completed or reviewable work.
34. As a Pinterest user, I want the Side Panel to follow the active page without mode tabs, so that the task and source are immediately clear.
35. As a Pinterest user, I want Import on Saved Pins or a Board, This Pin on Pinterest Home or an individual Pin, and guidance elsewhere, so that the panel fits the current page.
36. As a Pinterest user, I want the active tab to determine Context Pin state, so that background tabs and stale metadata cannot select the wrong Pin in my panel.
37. As a Pinterest user, I want page navigation to show the new page's task without changing an Import Session's selection or source, so that I can return to a review safely.
38. As a Pinterest user, I want unfinished Import Sessions discoverable in every Side Panel state, so that page changes do not hide work that needs review.
39. As a Pinterest user, I want a native Pinterest Save to create a Capture Attempt first, so that a click or ambiguous outcome is never presented as a committed Reference.
40. As a Pinterest user, I want Save not confirmed and local-write failure to offer appropriate recovery, so that I can resolve the original attempt without repeating Pinterest Save.
41. As a Pinterest user, I want an active Import scan to pause as Partial when I invoke Pinterest Save, so that the Capture Attempt receives attention without claiming the scan remained reliable.
42. As a Pinterest user, I want the same Pin reached by Capture and Import to resolve to one Reference, so that I never see duplicate Library entries.
43. As a Pinterest user, I want opening Dashboard during a scan to warn that the scan will pause, so that I knowingly preserve a Partial Import Session.
44. As a Library user, I want All Pins to show real References only, so that prototype examples, Import candidates, and Capture Attempts do not inflate the Library.
45. As a Library user, I want search to use committed Tag names and Notes, so that I can retrieve References without depending on Pinterest Board data.
46. As a Library user, I want real recently-added and untagged views, so that sidebar counts and filters match committed data.
47. As a Library user, I want one Inspector for single and multi-selection, so that shared Tags and Note previews stay in one place.
48. As a Library user, I want multi-selection Note editing to target only the active previewed or pinned Reference, so that other Notes are never overwritten as a batch.
49. As a Library user, I want Tag creation, assignment, rename, reorder, merge, and deletion to use stable Tag identities, so that edits are reflected consistently across Side Panel and Dashboard.
50. As a Library user, I want Note drafts and Tag writes to show their actual saving or failure states, so that I can retry or resolve conflicts without losing text.
51. As a Library user, I want Preview Reload and Pinterest status checks to affect only their respective evidence fields, so that my Tags, Note, Pin identity, and Library membership remain intact.
52. As a Library user, I want Needs Attention to hold identity-known Capture Attempts outside All Pins, so that I can retry or dismiss them without confusing them with References.
53. As a Library user, I want Trash, Restore, and Permanent Delete to affect PinRef only, so that Pinterest Save state is never changed by Library management.
54. As a Library user, I want the same Light/Dark theme on Side Panel and Dashboard, so that moving between them feels continuous.
55. As a Library user, I want Masonry/Waterfall and Floating/Docked preferences restored when reopening Dashboard, so that the workspace keeps my chosen layout.
56. As a Library user, I want a new Dashboard opening to begin without a stale Gallery selection, so that I choose which References to inspect.
57. As a Library user, I want changing search or Tag filters to clear Gallery selection, so that hidden References cannot receive a surprise bulk action.
58. As a Library user, I want sorting and layout changes to preserve selection, so that I can reorganize the view without losing my current work.
59. As a user of a compact window, I want the sidebar and Inspector to use the prototype's drawer and bottom sheet patterns, so that all actions remain reachable.
60. As a user, I want only real features and counts in the finished interface, so that no demo controls, simulated Save results, or placeholder destinations mislead me.

## Implementation Decisions

- The Side Panel automatically shows Import on Saved Pins or a Board, This Pin on Pinterest Home or an individual Pin, and an idle guide elsewhere. Explicitly choosing an unfinished Import Session opens its review without rebinding it; navigation to a different page returns to that page's state while retaining the session and selection. A native Save may temporarily prioritize This Pin. This follows ADR-0002, ADR-0004, and ADR-0012.
- The Side Panel owns Start, permission continuation, scanning, review, local Import, retry, results, Context Pin inspection, metadata editing, and Capture status. Dashboard owns committed Library management, Needs Attention, and Trash. View Library is explicit navigation to All Pins, sorted by actual PinRef added time, with no automatic selection. This follows ADR-0004.
- The selected Import Surface is the active Saved Pins collection or one concrete Board. Starting binds the exact tab and surface. A Context Pin is not an Import Surface. Session review retains the original source when the active page changes. This follows ADR-0002 and ADR-0004.
- The existing scanner, Import application, local repository, and worker coordination remain the authority for Pin identity, trusted collection membership, interruption, deduplication, writes, and recovery. UI components consume their state and issue existing commands; visual integration does not create a second Import state machine.
- A browser tab title is not used as a Board name or count. Use verified source information when available; otherwise show the surface type and URL. A Pinterest-displayed Pin count, if later read, must be labeled as a page claim and kept separate from observed candidates and committed References.
- Permission is requested from the explicit Start or Resume path only when the initial scan attempt reports insufficient access. Approval continues that same request after revalidating the original tab and surface. Revocation lives in secondary settings. Denial starts no scan.
- The review stage labels observed candidates Total, keeps no selection by default, and provides Select all new, Deselect all new, and individual selection. Duplicate and In Trash remain visible but unselectable. A zero-new outcome offers Done when allowed by session rules, or Dismiss for an unfinished Partial session.
- The results stage leads with local commit outcomes. Already imported images and checkboxes are absent from the selection list; failed items expose Retry and unselected new items expose Review remaining. Scan completeness belongs in source and scan details, not the success heading. The same status vocabulary and accessible feedback are shared across surfaces in accordance with ADR-0010.
- The Contact Sheet prototype supplies the three-region hierarchy, image-only Gallery, centered search, sorting, Masonry/Waterfall, Sidebar Tag interactions, shared Floating/Docked Inspector, add-Tag picker, keyboard and responsive patterns. Its in-memory records and simulated Capture Attempts are replaced by production state. Historical Dashboard Import controls do not return.
- The Dashboard reads committed References from the Local-first Library. It implements search over committed Tags and Notes, real counts, Tag management, Inspector editing, Needs Attention, and Trash. It adds no Board field to References and does not infer Pinterest save time. Stable Tag entities and assignments, Local Drafts, autosave feedback, field-level revisions, and operation receipts follow the existing product decisions and ADRs.
- A native Save creates a Capture Attempt and requires reliable same-Pin success evidence plus local commit before becoming a Reference. Ambiguous results remain Save not confirmed. During an active Import scan, native Save pauses the scan as Partial and prioritizes Capture status in the Side Panel. Capture and Import commit paths must deduplicate by Pin identity and preserve metadata of any existing Reference.
- Opening Dashboard from the Side Panel during an active scan requires a warning that the scan will pause. User confirmation then opens Dashboard and retains a Partial Import Session for later Resume on the original tab and surface.
- Changing Dashboard search or Tag filters clears Gallery selection after flushing or safely retaining any Local Draft for its original Reference. Sorting and Masonry/Waterfall changes preserve selection. Waterfall reserves a stable content width across Sidebar open/close and restores scroll after image sizing, preventing vertical Pin relocation. Gallery selection is not restored after Dashboard reopens. Layout preferences and Light/Dark theme are stored across openings; theme is shared across both surfaces.
- A shared visual foundation supplies tokens, typography, spacing, buttons, focus, status, and empty-state treatments to Side Panel and Dashboard. Browser-owned Side Panel width is respected. Theme meaning and status colors remain consistent in both surfaces.
- Every user-facing prototype destination and control in scope must be backed by real product behavior before being shown. Fixed counts, sample records, debug state, simulated Save outcome controls, and placeholder donation do not ship. Dragging has a keyboard-accessible alternative, and local storage operations drive truthful pending, success, failure, conflict, and stale feedback.
- Preserve Import Session and Reference storage compatibility with existing local data. New Tag, Capture Attempt, Local Draft, revision, and Trash structures require explicit, tested migrations that do not clear committed References or unfinished sessions.
- Complete integration is one acceptance target. Internal implementation order may follow dependencies, but a read-only Inspector or visual-only Contact Sheet does not complete this spec.

## Testing Decisions

- Test what a person can observe: which surface can start, what selection and results display, which References are committed, and how the Library responds. Do not assert incidental DOM nesting, private helper names, or prototype demo data.
- Use one principal high-level seam: an automated browser journey with a simulated Chrome/Pinterest boundary and the production application and local repository. It exercises native Save Capture, Side Panel This Pin and Import, committed Library state, Dashboard Contact Sheet and Inspector, edits, recovery, and Trash across the same browser profile. Extend the existing Side Panel and Dashboard browser fixture style rather than building a parallel prototype-only harness.
- At that seam, cover permission approval and denial, all-Duplicate or In Trash, Partial, no candidate, mixed success and failure with Retry, Review remaining, Done or Dismiss, new Board after completion, and source change during permission request. Reuse existing Import lifecycle integration tests for tab binding, interruption, rescan merge, recovery, and deduplication.
- Exercise Dashboard behavior at desktop and compact widths: real counts, search, Tags, sort, Masonry/Waterfall, single and multiple selection, editable Floating and Docked Inspector, add-Tag picker, Needs Attention, Trash, drawer and bottom sheet, empty Library, keyboard focus, and no horizontal overflow. Verify filter changes clear selection while sort and layout changes retain it.
- Exercise cross-surface editing with a Local Draft and concurrent committed changes. Verify Tag identity and assignment integrity, Note retry and conflict resolution, Preview Reload boundaries, Pinterest Link Status changes, and worker restart recovery. Reuse the existing Import lifecycle and storage tests as prior art for durability and idempotency.
- Check the boundary from Dashboard back to Import: guidance opens Pinterest, does not execute an Import command, and does not infer a Board from a single Pin.
- Keep a real Chrome/Pinterest release matrix for native Side Panel opening, permission dialogs, same-Pin Save success, failure and cancellation, SPA navigation, Board picker, feed and detail variants, per-tab Context Pin isolation, Board and Saved Pins DOM variants, secret and collaborative Boards, interruption, browser restart, and reliable end-of-surface evidence. Wrong Pin identity, a false Reference success, or cross-tab routing fails the release gate. Fixture passing alone does not establish these guarantees.

## Out of Scope

- Moving Import review or source selection into Dashboard, automatically scanning on panel open, or automatically navigating to Dashboard after scan or commit.
- Persistent Pinterest Board ownership, Board search, account-wide sync, cross-device synchronization, Pinterest mutation, or an Add action for an arbitrary Context Pin.
- Shipping prototype demo records, prototype-only debug controls, simulated Capture Attempt states, or unreleased navigation destinations as production functionality.
- Claiming reliable scan completeness from a scroll plateau, deriving Pin identity from an image URL, or claiming that browser fixture tests replace real Chrome/Pinterest validation.

## Further Notes

- Source references: the Dashboard Contact Sheet prototype and its README; the Pinterest site integration prototype and its Import and Save hard-gate scenarios; the product decisions document; ADR-0001, ADR-0002, ADR-0004 through ADR-0012.
- The current production extension already has a Side Panel Import lifecycle, candidate review, local commit, a simple Dashboard Library, and fixture-based browser tests. The remaining work includes full Dashboard functionality and the production Context Pin, Capture, metadata, and recovery pipelines demonstrated or decided around the prototypes.
- This issue records the complete confirmed product target. The production extension currently implements only the Import and simple Library portions; its README distinguishes those current behaviors from this target.
