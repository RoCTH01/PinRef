# Import from Pinterest hard-gate evidence

Date: 2026-09-29  
Prototype: `pinterest-site-integration` v0.0.21  
Decision source: [ADR 0004](../../docs/adr/0004-offer-optional-bootstrap-import-for-existing-pinterest-saves.md)

This worksheet records what the throwaway prototype established. It is not a production design or an Import specification.

Design revision, 2026-09-30: ADR-0004 now places the complete Import flow in the Side Panel, using the active Pinterest tab as the source. Dashboard routing results below describe the earlier design and do not validate the revised UX. Revalidate these gates before claiming the Side Panel flow works:

- Extension action opens the Side Panel beside the current Pinterest page.
- Source title, URL, and Saved Pins / Board / individual Pin / unsupported classification match the active page, including SPA close-ups.
- Start binds that exact source; background tabs cannot start or retarget its scan.
- Clicking, scrolling, or focusing controls inside the Side Panel does not falsely interrupt a scan of the same active tab.
- Tab or surface changes, window focus loss, and panel closure preserve Partial; reopening never resumes automatically.
- Resume requires the original tab and surface to be active; retained candidates and review keep the original source label.
- Disclosure, progress, Stop and review, selection, commit, Retry, and Done / Dismiss are usable at 320–360 px panel widths without navigating to Dashboard.

The production `extension/` now implements the revised Side Panel flow. Its lifecycle, simulated Chrome-event, narrow-panel browser-fixture, and scanner-fixture checks are documented in `../../extension/README.md`. These automated checks and unpacked-extension startup checks do not replace the signed-in Chrome/Pinterest gates above; the Dashboard routing evidence below remains historical.

## Verdict

**Proceed to `/to-spec` with Saved root + Board.** A canonical `/pin/<digits>/` link proves Pin identity but not collection membership. The real DOM supplied the missing fail-closed boundary: after returning to the top, trust only the connected `[role="list"]` containing the first visible canonical Pin. If that boundary is unavailable or disconnects, fail the scan instead of broadening it.

The decisive Board run accepted **255** identities from that list, exactly matching Pinterest's displayed 255-Pin count, and excluded **8** canonical Pin identities from the adjacent commerce carousel. The Saved root produced **501** identity-known candidates under the `你儲存的 Pin` list; its separate `圖版建議` list produced no Pin candidates. No reliable end marker was found, so MVP must expose Partial / Stop and review or Unable to confirm, never infer Complete from a plateau.

## Real Chrome / Pinterest observations

- Browser: Brave Private window, Chromium extension runtime, real signed-in `ca.pinterest.com` pages.
- Extension: unpacked PinRef throwaway prototype v0.0.21.
- Board: `https://ca.pinterest.com/roahillust/fashion/`, UI reported 255 Pins.
- Saved Pin root: Pinterest redirected `.../_saved/` to `.../_boards/`; choosing the **Pin** tab opened the actual `.../_pins/` surface.

### Observed live trace

```text
Dashboard Start (activeTab-only)
  -> selected Board tab activated
  -> content-script connection unavailable
  -> permission-required; no Import Session created

Grant Pinterest-only optional host permission
  -> browser prompt: read/change data on pinterest.com
  -> mode optional-host

Start Board scan
  -> SESSION_CREATED ready (tab 1512348708, exact Board surfaceKey)
  -> START_SCAN scanning
  -> repeated OBSERVE_BATCH
  -> tab switch to Dashboard
  -> INTERRUPT paused / tab-switch
  -> 173 identity-keyed candidates persisted

Resume from top
  -> RESUME_FROM_TOP scanning, same sessionId and binding
  -> repeated OBSERVE_BATCH merge by Pin ID
  -> Cancel
  -> INTERRUPT paused / cancelled-by-user
  -> 212 unique candidate keys persisted

Resume from top and allow plateau
  -> repeated OBSERVE_BATCH and auto-scroll
  -> END_UNCONFIRMED
  -> paused / unable-to-confirm-completion
  -> heuristic-only: four-round-scroll-height-and-identity-plateau
  -> 220 candidate keys persisted

Final membership-filter run
  -> seek top and bind first visible canonical Pin's connected role=list
  -> progressive 0.8-viewport OBSERVE_BATCH traversal
  -> 255 trusted-list candidate keys (matches Pinterest's displayed 255)
  -> 8 outside-list commerce Pin identities excluded
  -> END_UNCONFIRMED; no reliable Complete claim
```

The live Board page visibly rendered Pin-bearing modules after the Board list, including “更多與此圖版靈感相關的產品” and “為這個圖版找一些好點子”. Their items also used canonical `/pin/<id>/` links, but none shared the trusted collection list. The filter therefore retained the 255 Board members and rejected the eight observed commerce identities.

## Hard-gate transition results

| Gate | Transition trace | Result | Evidence class |
|---|---|---|---|
| Correct tab + surface binding | `ready -> scanning(tabId + surfaceKey)`, foreign-tab observations -> `IGNORED_TAB_MISMATCH`, surface mismatch -> `paused/navigation` | State model rejects cross-tab/surface events; live session retained exact Board tab and URL. | Proven in real Chrome/Pinterest + prototype |
| `activeTab` sufficiency | Dashboard Start in activeTab-only -> `permission-required`; optional Pinterest host grant -> Start succeeds | `activeTab` is insufficient for Dashboard-owned start/reconnect. Pinterest-only optional host permission is required. | Proven in real Chrome/Pinterest |
| Zero false Pin identity/membership | canonical Pin identity + trusted connected collection list | 255/255 Board members accepted; all 8 observed outside-list commerce Pins excluded. Saved candidates stayed under `你儲存的 Pin`. | Proven in real Chrome/Pinterest |
| Auto-scroll | `START_SCAN -> seek top -> OBSERVE_BATCH*` in 0.8-viewport steps | Traversed the virtualized Board without skipping the middle; reached 255 candidates. | Proven in real Chrome/Pinterest |
| Cancel | `scanning -> INTERRUPT(cancelled-by-user) -> paused`, 212 candidate keys retained | Safe Partial preservation. | Proven in real Chrome/Pinterest |
| Navigation | `scanning + changed surfaceKey -> paused/navigation` | Fail-closed transition is executable. | Proven in prototype; live Chrome event unresolved |
| Tab switch | `scanning -> INTERRUPT(tab-switch) -> paused`, 173 candidates retained | Safe Partial preservation. | Proven in real Chrome/Pinterest |
| Tab close | `scanning -> INTERRUPT(tab-closed) -> paused` | State/store path preserves Partial. | Proven in prototype; real browser event unresolved |
| Permission revocation | `scanning -> INTERRUPT(permission-revoked) -> paused` | State/store path preserves Partial. | Proven in prototype; real browser event unresolved |
| Service-worker restart | startup recovery: persisted `scanning -> paused/service-worker-restart` | State/store round trip preserves candidates. | Proven in prototype; real suspension/restart unresolved |
| Resume from top | `paused -> RESUME_FROM_TOP -> scanning -> OBSERVE_BATCH*`; candidate map keyed by Pin ID | Same live session grew 173 -> 212 unique keys; reducer proves repeated IDs increment `observationCount` rather than duplicate candidates. | Proven in real Chrome/Pinterest + prototype |
| Complete | `scanning -> END_RELIABLE -> ready-to-import -> importing -> DONE -> import-complete` | State exists, but no reliable real end marker was observed; a plateau never emits Complete. | Simulated only |
| Unable to confirm | `scanning -> END_UNCONFIRMED -> paused/unable-to-confirm-completion` | Real Board plateau was correctly not called Complete. | Proven in real Chrome/Pinterest |
| Scan failed | `scanning -> INTERRUPT(scan-failed) -> paused` | Distinct stop reason exists. | Proven in prototype |
| Local-write failure + Retry | `importing -> COMMIT_RESULT(failed) -> import-incomplete -> RETRY_LOCAL -> importing` | Distinct from scan failure and coverage uncertainty; same candidate/session is retried. | Simulated only |
| Saved root viability | `/_saved/ -> /_boards/`; Pin tab -> `/_pins/`; 501 candidates in `role-list:0 / 你儲存的 Pin` | Saved root supports identity-known Partial import; completion remains unconfirmed. | Proven in real Chrome/Pinterest |

## Evidence classification

### Proven in real Chrome/Pinterest

- Dashboard can bind one session to the intended tab and exact Board URL.
- `activeTab` alone does not let Dashboard start/reconnect the Pinterest scanner.
- Pinterest-only optional host permission makes the same flow runnable.
- Auto-scroll, tab-switch stop, Cancel, Partial persistence, same-session resume, and heuristic `Unable to confirm` occurred live.
- The trusted collection list separates Board/Saved candidates from recommendation and commerce modules; missing/lost boundary fails closed.
- Board run: 255 accepted members matching the displayed count; 8 outside-list commerce Pins excluded.
- Saved-root run: 501 candidates under `你儲存的 Pin`; Board suggestions did not enter that scope.
- Current Saved Pin root is `/<account>/_pins/`; `/_saved/` redirects via the profile Boards view.

### Proven in prototype

- Cross-tab events are ignored and traced.
- Surface mismatch, cancel, navigation, tab switch, tab close, permission revocation, scan failure, and worker restart all resolve to explicit paused states.
- Missing or disconnected membership boundaries fail the scan instead of falling back to all canonical Pin links.
- Resume merges by Pin ID; repeated observations do not create duplicate candidate keys.
- Import outcomes keep Complete, coverage uncertainty, scan failure, and local-write failure distinct.
- Import Session and Partial candidates survive storage round trips.

### Simulated only

- Reliable end marker -> Complete.
- Local commit results: imported, duplicate, in Trash, failed, and Retry.
- Real-time permission revocation while scanning.
- Real tab-close and service-worker suspension/restart while scanning.

### Unresolved

- A reliable Complete signal on real Board or Saved Pin root.
- Live navigation, tab close, permission revocation, and service-worker restart coverage.
- Generalization beyond the observed account, locale, and Pinterest DOM variant; CWS fixtures must keep these cases reproducible.

## Product consequence

- **Ship Saved root + Board:** yes — proceed to `/to-spec` with trusted-list-only candidates and Partial / Stop and review as the real MVP result.
- **Ship Board-only:** unnecessary on current evidence; retain it as fallback if Saved-root fixtures later fail.
- **Defer Import:** no — the identity/membership blocker is resolved.

Production must preserve these invariants: optional Pinterest-only permission; one exact bound foreground tab/surface; trusted-list-only candidates; canonical Pin identity; resume from top merged by Pin ID; no Complete without a reliable marker; and Partial preservation for every interruption.
