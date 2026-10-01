# Prototype integration: implementation and verification

Date: 2026-10-01. Target: [complete integration spec](../specs/import-to-library-product-integration.md), not a reduced visual milestone.

## Production ownership

Both surfaces send intent to the extension worker. Import and Library commands share its serialized queue and one local repository. UI code never rewrites a Reference directly in storage. Import owns collection binding and candidate eligibility; Library operations own Tags, Note drafts, Capture commits, preferences and Trash.

Schema 3 retains existing Import Sessions and References. It adds stable Tag entities, per-assignment revisions, Note revisions, Reference lifecycle generations, surface-owned Local Drafts, Capture Attempts and preferences. New generations prevent a delayed edit from attaching deleted metadata to a freshly reimported Pin. Undo is version-guarded and cannot restore old assignments over later mutations.

Native Save evidence stays in the content boundary. A click persists an attempt first; only same-control Saved evidence with matching Pin, tab and document can authorize a local commit. Navigation, lost evidence and timeout do not imply success. Capture and Import deduplicate against the same active Library and Trash.

## Prototype → production

| Prototype source | Production area | Preserved behavior / intentional replacement |
| --- | --- | --- |
| `pinref-dashboard/index.html` Contact Sheet CSS and component hierarchy | `extension/dashboard/contact-sheet.css`, `dashboard.js`, `production.css` | Three regions, image-only Gallery, search/sort, layout switch, sidebar Tags, Inspector, Note rail, picker and responsive drawer/bottom sheet. Real records replace demos. |
| Dashboard theme and visual variables | `extension/library/tokens.css` | Shared dark/light palette, spacing foundations and typography; both surfaces use persisted theme. |
| Prototype Inspector metadata interactions | `extension/library/ui.js`, `extension/library/application.js` | Shared Note editor and Tag command construction; worker-owned field/lifecycle guards replace direct in-memory mutation. |
| `pinterest-site-integration/content.js` native Save context and observation | `extension/content/context-pin.js`, `extension/background.js` | Event-local identity, same-control confirmation, picker source retention, per-tab Context Pin and conservative unconfirmed outcomes. No prototype overlays or debug controls. |
| Integration prototype Side Panel | `extension/sidepanel/context-view.js`, `panel.js` | This Pin alongside Import, Capture recovery, shared metadata editing and unfinished-session discovery. |
| Import hard-gate behavior and existing production lifecycle | `extension/content/import-scanner.js`, `extension/import/*`, worker | Exact source binding, trusted collection boundary, Partial, Resume, permission continuation, commit journal and retry remain authoritative. Dashboard scanning does not return. |

## Automated evidence

Latest results: `npm test` **49 passed**; JavaScript syntax check **25 files passed**; all six browser regression scripts **passed**. The product journey was rerun after the final search/focus and Inspector refinements and passed again. The real unpacked-extension smoke also passed in an isolated Brave profile. The final targeted Standards and Spec rechecks reported no remaining findings among the issues they had raised.

- Worker/repository tests cover Import lifecycle; state migration; Note conflict preservation; independent assignment changes; stale assignment and generation rejection; atomic Tag Merge/Delete/Undo; local-write failure; Capture origin binding; query-parameter Dashboard handoff; and Dashboard-only lifecycle authority.
- `scripts/check-product.cjs` is the principal one-profile browser journey. It runs the production worker and repository behind a simulated Chrome boundary, imports two Pins, assigns Tags, edits Notes, injects a write failure, commits a competing Note, verifies normal Retry preserves the conflict, exercises selection/search/layout and Trash/Restore, then captures through the production Pinterest observer. It also verifies This Pin → Dashboard Note/theme updates, keyboard focus return, and a product Pin whose layout declares no closeup test id and whose thumbnail carousel must not be taken for its preview while every image it is of is still recorded.
- `scripts/check-dashboard-library.cjs` covers the Library management the Dashboard owns alone, against the same production worker: Tag assignment and the common-Tag intersection across a multi-selection, the global Tag editor's rename, colour and order, the rename collision that offers Merge, Undo of a Merge, guarded multi-Tag delete, search across Name, Note and Pin ID, Tag suggestions, the Untagged destination, permanent delete from Trash, Needs Attention resolving a Capture Attempt when its Pin is restored, and the Inspector's image strip for a Pin of several images.
- Existing Side Panel, Dashboard guidance and scanner journeys remain separate regression coverage of the established seams. Screenshots use fixture artwork only; no sample References ship.
- `scripts/check-extension.cjs` loads the actual unpacked extension in an isolated Brave profile and checks worker startup, real local storage, both pages and live theme propagation. It does not automate Chrome's native Side Panel shell or access a signed-in Pinterest account.
- `npm run typecheck` is JavaScript syntax validation, not TypeScript type analysis.

## Review corrections

The two-axis review identified three Standards findings and three Spec findings (one overlapping Merge handoff issue). Fixes add lifecycle bases to Create-and-assign, restrict Capture dismissal to Dashboard, accept authenticated Dashboard query URLs, distinguish ordinary Note Retry from explicit conflict override, and return transient focus to the exact opener. Follow-up checks also corrected the Needs Attention destination and Inspector-versus-sidebar focus target.

Browser iteration additionally caught an old Saved label during new typing, autosave rerenders causing unintended blur retries, click targets disappearing during pointer gestures, and a sidebar Tag control consuming its label's width. These were fixed at the shared editor/render boundary or verified with browser assertions.

## Required real Chrome / Pinterest release gates

These remain **not verified by this implementation run**. Do not treat fixture or unpacked-extension results as a release approval.

| Gate | Required evidence |
| --- | --- |
| Native Side Panel shell | Toolbar click, close/reopen, window focus, action-granted access and no false pause while interacting inside the panel. |
| Permission flow | Real approval, denial and revocation; Start/Resume continuation revalidates the original tab and surface. |
| Native Save variants | Feed and detail, Board picker completion/cancel, failure, localized/A-B controls, replaced/recycled DOM and delayed confirmation. A click or generic Saved signal must never create a Reference. |
| Context isolation | Two tabs saving different Pins, background completion, rapid SPA navigation and Pin close-up changes cannot replace the foreground editor or rebind an Import. |
| Collection boundaries | Saved Pins, public/secret/collaborative Boards, recommendations and lazy loading. False membership or inferred completeness fails the gate. |
| Interruption and recovery | Native Save during scan, confirmed Dashboard navigation, tab/window changes, browser restart, worker suspension and extension reload preserve Partial and pending local commits. |
| Real storage failure | Quota/I/O failure, recovery and unknown completion never show a false Reference success or overwrite metadata. |

No Pinterest Save mutations were performed against a real account. No cloud sync, Board persistence or prototype demo records were added. This workspace has no Git metadata, so no commit or branch diff could be produced; review used the pre-change snapshot at `/tmp/pinref-integration-baseline.F0tNMh`.
