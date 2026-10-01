# PinRef Pinterest Site Integration — Throwaway Prototype

> Design revision (2026-09-30): ADR-0004 now assigns first-use and repeated Import to the Side Panel, bound to the active Pinterest collection. The Dashboard-owned Import lab described below records the earlier prototype and has not yet been migrated. Its identity, trusted collection, Partial, and Resume evidence remains useful; its UI ownership and return-to-Dashboard behavior are no longer the production target. The Side Panel flow still needs validation for panel interaction versus foreground loss, panel closure, active-tab source labels, and Pin-page versus collection classification.

Questions: can PinRef confirm the outcome of Pinterest's native Save for the same Pin, and can a Dashboard-owned Import Session safely scan a bound Pinterest Saved/Board surface without false collection membership?

This is disposable Manifest V3 prototype code, not the production Extension architecture. It uses `chrome.storage.local` only to validate shared real data across the three surfaces. It has no cloud sync, production migrations, backup/export, complete tag management, production error handling, or Chrome Web Store packaging.

## Run

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable **Developer mode**.
3. Reload the existing PinRef prototype, or choose **Load unpacked** and select:

   ```text
   /Users/robbychen/Dev/pinref/prototype/pinterest-site-integration
   ```

4. Reload a real Pinterest page so the worker can inject the newest content build after an explicit user action or Pinterest-only optional permission grant. The Side Panel action itself is restored for already-open Pinterest tabs when the extension worker starts.
5. Use Pinterest's own **Save / 儲存** button on a feed card or Pin detail. PinRef creates a Capture Attempt; it does not create a Reference from the click alone.
6. The toolbar extension action uses the browser's native open/close behavior. The `×` in PinRef's own header also closes the panel on browsers that implement `sidePanel.close()`.
7. Choose **Dashboard** in the Side Panel header to open the Extension Dashboard in a new tab. Opening or activating Dashboard closes the Side Panel in that browser window; returning to Pinterest does not reopen it automatically.
8. Use **↻** in the Side Panel or **Reload metadata** in Dashboard to re-observe the preview from an already-open Pinterest page. Dashboard reload applies to the current selection.

References, identity-known Capture Attempts, Tags, and Notes persist in `chrome.storage.local` across Side Panel, Dashboard, Pinterest tabs, and service-worker restarts. Removing the unpacked extension can remove this prototype data.

## Import hard-gate result

Open **Import lab** in Dashboard to inspect the Dashboard-owned session, permission mode, eligible Pinterest surfaces, candidates, and state transition trace. The lab uses the existing Dashboard visual language and shared local store; simulated commit controls are labelled and are not Pinterest/Chrome evidence.

The 2026-09-29 live pass answers the detour question: **proceed to `/to-spec` with Saved root + Board.** `activeTab` was insufficient and Pinterest-only optional host permission was required. Tab binding, progressive auto-scroll, Cancel, tab-switch Partial preservation, resume merge, and `Unable to confirm` ran successfully in real Brave/Pinterest.

Canonical Pin identity alone was too broad because the Board appended recommendation and commerce modules with valid `/pin/<id>/` links. The validated fix is fail-closed membership: after returning to the top, trust only the connected `[role="list"]` containing the first visible canonical Pin. The final Board run accepted 255 identities from that list, exactly matching Pinterest's displayed 255-Pin count, and excluded eight commerce-carousel identities outside it. Missing or disconnected boundaries fail the scan.

Pinterest redirected the presumed `/_saved/` route to `/_boards/`; the actual Saved Pin tab was `/<account>/_pins/`. Its scan produced 501 identity-known candidates under the `你儲存的 Pin` list while the separate Board-suggestion list contributed none. Neither surface exposed a reliable end marker, so a plateau remains Partial / `Unable to confirm completion`, never Complete.

See [IMPORT-HARD-GATE-SCENARIOS.md](IMPORT-HARD-GATE-SCENARIOS.md) for per-gate traces, evidence classification, unresolved live lifecycle coverage, and the explicit Saved root + Board decision.

## Save-confirmation walkthrough

1. Open the Side Panel before using Pinterest Save. Its Prototype state section shows the active tab, Context Pin, shared References, attempts, evidence, and trace.
2. Click Pinterest's native Save. The panel should show `Saving on Pinterest`; Library count must not increase.
3. If the same clicked control becomes an exact Saved state, the prototype treats that as conditionally reliable confirmation and attempts the local write. If no usable evidence arrives in six seconds, the attempt becomes `Save not confirmed`.
4. Expand **Prototype outcome controls** on a pending attempt to replay confirmed success, Pinterest failure, picker cancellation, timeout, or confirmed Pinterest + failed local write. These buttons validate PinRef logic only; they are not evidence about Pinterest.
5. For `Couldn't save to PinRef`, choose **Retry local write**. It commits the original attempt without requiring Pinterest Unsave → Save.
6. Start attempts in two Pinterest tabs, then switch between them. The panel must always show the active tab's Context Pin; background completion may change shared data but must not select its Pin.
7. Reload the extension to simulate worker restart. In-flight Pinterest attempts conservatively become unconfirmed; attempts that had reached local commit become local-write-failed. Close an origin tab to validate the same no-false-success boundary.
8. Use [SAVE-CONFIRMATION-SCENARIOS.md](SAVE-CONFIRMATION-SCENARIOS.md) as the scenario matrix and real-site observation worksheet.

## Prototype structure

- `content.js`: Pinterest native-Save observation plus the bound Import scanner. Import extracts canonical Pin identity only inside a trusted connected collection list, scrolls progressively, and fails closed if that boundary is unavailable or lost.
- `pinref-store.js`: the prototype's normalized `chrome.storage.local` library, Capture Attempts, and persistent Import Sessions.
- `service-worker.js`: per-tab active-Pin state, persistent coordination, Side Panel synchronization, Dashboard opening, optional Pinterest permission, and one active Import scan.
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js`: the browser-native companion UI for preview, Pin reference, Tags, Note, saved time, original link, and full debug state.
- `dashboard.html`, `dashboard.css`, `dashboard.js`: the full winning Contact Sheet Dashboard prototype moved into the Extension, including Tags navigation and management, image-only gallery, search, sorting, Masonry/Waterfall layouts, multi-selection, Floating/Docked Inspector, editable notes/tags, movable add-tag picker, theme control, and responsive drawer/bottom-sheet behavior.
- `manifest.json`: MV3 `sidePanel`, `storage`, prototype-only `tabs`/`scripting`, `activeTab`, and Pinterest-only `optional_host_permissions`. There is no static Pinterest content script, so the permission experiment is not a false positive.

## Interaction rules under test

- Pinterest's own unsaved **Save / 儲存** action is the only add-to-PinRef trigger on the site.
- PinRef observes the click without preventing, stopping, replacing, or visually covering Pinterest's control.
- Native Save sets that Pin as the tab's Context Pin and creates only a Capture Attempt. A Reference appears only after same-Pin confirmation and local commit.
- Clicking a Pinterest control already labelled **Saved / 已儲存** is ignored; it never removes the local PinRef record.
- Opening a Pin detail route updates the active Pin without automatically opening a closed panel.
- An unsaved Pin detail appears in Side Panel as **Waiting for Pinterest Save**. Side Panel offers no direct add button.
- The current route Pin ID outranks potentially stale canonical/Open Graph metadata during SPA navigation.
- A detail preview must come from a link associated with that same Pin. `og:image` is accepted only when canonical or Open Graph identity also matches the active Pin; an unrelated page-wide image is never used as fallback.
- Pinterest Pin detail main images are not necessarily wrapped by their Pin permalink. On detail routes, PinRef anchors preview discovery to the visible semantic “Share this Pin” control and walks only its closeup container ancestry; this captures the unlinked main image without falling back to an unrelated page-wide or Related Pin image.
- A closeup may place a non-`pinimg.com` cutout overlay above the real image. Preview discovery skips invalid overlay URLs and continues to the first valid Pinterest image instead of failing on the top candidate.
- Direct Pin routes also have a bounded geometry fallback: when the share-control ancestry is narrower than the two-column closeup, PinRef selects the largest visible safe `i.pinimg.com` image. This fallback is never used on feeds.
- PinRef detects the board-selector control only to retain the source Pin while Pinterest's picker is open. It deliberately discards the selected board name.
- Side Panel and Dashboard Tags/Note edits update the same persistent Reference created only after confirmation and local commit.
- Side Panel and Dashboard share one manual preview reload path. It searches open Pinterest tabs for the target Pin and persists only an improved preview.
- Dashboard never seeds example records. Its gallery contains only Pins actually saved from Pinterest.
- Side Panel availability is configured per tab from the full URL; there is no global-disable/tab-enable startup race. Every `https://*.pinterest.com/*` route is eligible, not only Home. This includes Search, Board, profile, Related Pins, Pin detail routes, and Pinterest modal/SPA states. Existing tabs are reconfigured when the worker starts, switching to a non-Pinterest tab closes the tab-specific panel, and returning to Pinterest makes it available again.
- Dashboard is a full-page workspace, so its ready signal and tab-activation lifecycle both request closure of the browser-owned Side Panel. The user must explicitly reopen the panel after returning to Pinterest.
- The browser owns panel placement and page resizing. PinRef no longer injects a right rail, bottom sheet, launcher, or Pinterest body-width override.

## Deliberate shortcuts

- Active Pin and current DOM observations remain per-tab transient state; saved records are persistent local data.
- The local store has one prototype schema and normalization path, but no production migration, conflict history, backup, or recovery design.
- The content script uses a static `https://*.pinterest.com/*` match for fast testing.
- The worker temporarily uses the broad `tabs` permission to make Side Panel scoping and extension-reload recovery deterministic. Production should revisit whether equivalent lifecycle behavior can be achieved with a narrower permission model.
- Tags are stored as normalized arrays but edited through comma-separated fields; full tag CRUD remains out of scope.
- Pinterest board mapping is outside this prototype and the planned local record schema. Existing prototype `boardContext` values are removed by the version-3 local-store migration, which also introduces persistent Capture Attempts.
- This throwaway build observes a same-control Saved transition and explicit error live-region text as conditionally reliable candidates. Board-picker disappearance, route change, and timeout never count as success. Real-site coverage is still required before choosing a production signal contract.
- Reload does not silently create or navigate background tabs. If the target Pin is not currently visible in an open Pinterest tab, the UI asks the user to open it and retry.
- Chrome documents Side Panel support for MV3 Chrome 114+ and programmatic opening from user interaction in Chrome 116+. Brave compatibility must be established by this prototype rather than assumed.
- The toolbar toggle uses `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. The in-panel close button uses `sidePanel.close()`, which Chrome documents for Chrome 141+; older Chromium/Brave builds retain the browser-owned close control.
- The Side Panel API does not expose panel width control. Width belongs to the browser and user; PinRef can only make its contents responsive. For this prototype, evaluate the Inspector at a manually resized width of approximately 320–360 px.
- Do not apply a CSS `max-width` as a width workaround: it would only create unused space inside the browser-owned panel and would not return space to Pinterest.

## Earlier injected-Sidebar findings

- The injected 360 px and 300 px rails covered Pinterest controls on some Pin-detail layouts.
- Reserving width by modifying Pinterest's page layout introduced an unacceptable private-layout dependency.
- Those approaches are removed from the current code. They remain rejected evidence, not dormant fallback behavior.

## Rejected Pin overlay direction

- The PinRef `+ / ✓` overlay duplicated Pinterest's existing Save action and introduced unstable placement work across card variants.
- The current experiment removes overlay injection and tests whether Pinterest Save is a sufficient, lower-interference product trigger.
- This is still prototype evidence: relying on undocumented button semantics and click intent may be too fragile for production.

## Verification checklist

- [ ] The unpacked extension loads without manifest or service-worker errors in the target browser.
- [x] Automated regression: worker startup configures already-open Pinterest tabs and never races a global disable against tab-specific enablement.
- [x] Automated regression: only exact unsaved Pinterest labels (`Save`, `儲存`, `保存`) qualify; board selectors, Saved state, and legacy PinRef controls do not.
- [x] Automated regression: the scan lifecycle no longer injects the legacy PinRef overlay.
- [ ] Native Pinterest Save on Home, Search, Board, Related, and Pin detail creates an attempt first, then the correct Reference only after same-Pin confirmation and local commit.
- [ ] An already-open Side Panel updates after Pinterest Save; a closed panel stays closed.
- [ ] Unsaved Pin detail shows the waiting state and has no direct add-to-PinRef button.
- [x] The toolbar action opens the Side Panel on Pinterest in Brave (observed 2026-09-25); re-test native close toggling after reload.
- [ ] The in-panel `×` closes the Side Panel in the installed Brave version, or shows the explicit compatibility fallback.
- [x] Pinterest is resized by the browser rather than covered by PinRef UI (observed 2026-09-25).
- [ ] Manually resize the Side Panel to 320–360 px and confirm the PinRef UI remains usable.
- [ ] Preview and active Pin stay correct through feed → detail → back.
- [ ] Side Panel reload refreshes the current Pin preview without changing Tags or Note.
- [ ] Dashboard reload refreshes every selected Pin that is currently visible in an open Pinterest tab and clearly reports misses.
- [x] Automated regression: the current route ID beats stale SPA metadata, and a stale `og:image` cannot become the current Pin preview.
- [x] Automated regression: an unlinked image in the active Pin closeup is accepted before stale metadata (added after real-site observation on 2026-09-25).
- [x] Automated regression: an invalid cutout-overlay candidate cannot hide the valid `i.pinimg.com` preview behind it.
- [x] Automated regression: direct Pin reload chooses the largest visible safe Pinterest image rather than an invalid overlay, a smaller Related Pin, or a larger offscreen image.
- [x] Real-site diagnosis: Pinterest's board picker is a portal; PinRef retains only the source Pin across that UI boundary and does not store the board choice (observed in Brave on 2026-09-25).
- [ ] Tags and Note can be typed continuously without losing focus and remain isolated per Pin.
- [ ] The Side Panel **Dashboard** button opens the Extension Dashboard.
- [ ] Opening Dashboard and switching back to an existing Dashboard tab both close the Side Panel in the same browser window.
- [ ] A Pin saved on Pinterest appears in Dashboard without seeded/mock records.
- [ ] Tags and Note edited in Side Panel update Dashboard, and Dashboard edits update Side Panel and Pinterest tab state.
- [ ] Saved records survive closing/reopening the panel, Dashboard, and browser service-worker suspension.
- [ ] Dashboard search, tag filtering, real-image gallery, single selection, and multi-selection use only stored records.
- [ ] SPA navigation and infinite scroll keep native-Save attribution and panel state aligned.
- [ ] Closing the Side Panel leaves Pinterest Save observation intact.
- [ ] Switching from Pinterest to Dashboard or any other site closes the Side Panel; the toolbar cannot open it outside Pinterest.
- [ ] Home, Search, Board, profile, Related Pins, and Pin detail pages can each open the Side Panel.
- [ ] Returning to any initialized Pinterest page makes the Side Panel available without enabling it on unrelated sites.
- [ ] Brave behavior matches Chrome closely enough for the product direction, or the incompatibility is recorded.

Real-site passive observation on 2026-09-29 in Brave confirmed a localized `ca.pinterest.com/pin/<id>/` detail route, a Traditional Chinese board-selector label, an exact unsaved `儲存` control, and correct Side Panel route identity after extension/page reload. The same Pin already had a local Reference while Pinterest displayed the unsaved control, which also supports keeping PinRef Library Status independent from Pinterest Link Status. No active Save mutation was used for this passive pass, so success/failure/cancel coverage remains open.

## Save-confirmation verdict

The state model supports the current product decisions: click is intent only, attempts survive worker/panel lifecycle, local Retry is idempotent, and background events cannot select Side Panel content. The prototype cannot yet prove a Pinterest success/cancel/failure contract across Feed, detail, picker, locale, and A/B variants. Until that real-site pass succeeds, missed or ambiguous evidence resolves to `Save not confirmed`, never a Reference. See [SAVE-CONFIRMATION-SCENARIOS.md](SAVE-CONFIRMATION-SCENARIOS.md) for the matrix, traces, classifications, and ADR verdict.
