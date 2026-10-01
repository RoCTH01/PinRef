# Pinterest Save confirmation prototype evidence

Question: can PinRef distinguish native Pinterest Save success, cancellation, failure, and unconfirmed completion for the same Pin while keeping every Capture Attempt bound to its origin tab and Pin?

This document records prototype evidence. Simulated transitions validate PinRef's state model; they do not prove that Pinterest exposes the corresponding production signal.

## Real-site evidence captured

On 2026-09-29, a passive Brave check on a Traditional Chinese `ca.pinterest.com/pin/<id>/` detail page observed all of the following at once: an exact route Pin ID, `選擇要儲存這個 Pin 的圖版：fashion`, an exact unsaved `儲存` toggle, and the prototype Side Panel resolving the same route Pin after an extension/page reload. The Pin already had a committed PinRef Reference while Pinterest showed the unsaved control, supporting the non-destructive separation of PinRef Library Status from Pinterest Link Status.

This pass did not mutate Pinterest Save state. Feed/detail success, picker completion/cancel, explicit failure, locale variants, and multi-tab real-site timing therefore remain required active checks; the table below does not promote them above their current classification.

## Observation classification

| Observation | Classification | What it proves | Boundary |
|---|---|---|---|
| Chrome `tabId` attached by the extension runtime | Reliable | Which tab emitted click/evidence and which Context Pin may be shown | Valid only while that tab exists; persisted origin IDs become historical after close/restart |
| Numeric Pin ID from an exact `/pin/<id>/` route or a unique event-local Pin link | Conditionally reliable | Identity of the clicked/detail Pin | Pinterest DOM/URL contract is undocumented; ambiguous or missing identity must stop capture |
| Exact native Save label on the event composed path | Conditionally reliable | User intent to start Save for the resolved Pin | A click is not completion; locale/A-B variants require real-site coverage |
| The same clicked control changes to exact Saved state | Conditionally reliable | Positive completion candidate for the same attempt | Control replacement, portal UI, navigation, locale, or delayed rendering can lose the signal |
| Pinterest error text in an assertive live region | Conditionally reliable | Explicit failure candidate | Copy and accessibility markup are undocumented and require locale testing |
| Board picker disappearance or route change | Heuristic-only | The interaction ended or evidence was lost | Cannot distinguish Save, cancel, outside-click, navigation, or DOM replacement; never promote to success |
| Six-second observation timeout | Reliable | PinRef lacks sufficient completion evidence | Says nothing about Pinterest's actual outcome; maps to `Save not confirmed` |
| Exact Cancel/Close text in picker chrome | Heuristic-only | A cancellation candidate | Text and target are not stable enough to make a destructive/product assertion |
| Network request interception | Unavailable in this prototype | — | Not implemented; private endpoints/auth payloads would not be an acceptable assumed contract |
| `chrome.storage.local` commit resolution | Reliable | Local Reference write committed in this browser profile | Does not imply cloud durability or cross-device sync |
| Existing Reference lookup by Pin ID | Reliable | Duplicate local capture is an idempotent no-op | Depends on already-established Pin identity |

## Scenario matrix

| Scenario / operation | Observed or simulated signal | Pin identity | Resulting Capture state | Confidence | Principal failure mode |
|---|---|---|---|---|---|
| Feed Save, no picker | Event-local exact Save control; same control becomes Saved | Unique Pin link within clicked card | `Saving on Pinterest` → `Saving to PinRef` → Reference | Conditionally reliable | Recycled card DOM or replaced control loses same-control evidence |
| Feed Save opens picker | Save intent is bound before portal; final evidence must retain source Pin | Source Pin captured from event-local card | Pending until same-Pin confirmation; otherwise `Save not confirmed` | Conditionally reliable for identity; outcome unavailable without stable completion | Portal has no source Pin link and may replace the initiating control |
| Pin detail / close-up Save | Exact route Pin outranks stale metadata | Route Pin ID | Confirmed path or `Save not confirmed` | Conditionally reliable | SPA route and canonical metadata can temporarily disagree |
| Board picker completion | Prototype control simulates an explicit same-Pin completion; real DOM observation remains to verify | Immutable source Pin on attempt | `Saving to PinRef` then commit | State transition reliable; Pinterest signal unverified | A generic Saved control may belong to another Pin |
| Board picker cancel | Prototype cancellation event; real picker close is only a heuristic | Immutable source Pin | Diagnostic `cancelled`; no Reference; user-visible Needs Attention | Simulated reliable; real observation heuristic-only | Outside click, Escape, DOM removal, or Save can look identical |
| Pinterest shows failure | Assertive error text candidate or prototype failure control | Attempt Pin only | `Pinterest Save failed`; no Reference | Conditionally reliable on real site | Localized/copy-changed error or unrelated page alert |
| SPA navigation during Save | Route change does not mutate attempt identity | Original Pin on attempt; new route may establish a different Context Pin | Original attempt completes only with origin-tab + original-Pin evidence; otherwise unconfirmed | Reliable state binding | Completion evidence disappears during route teardown |
| Save then immediately switch Pin | Attempt remains keyed by attempt ID, origin tab, and Pin | Original Pin | Background attempt changes; Side Panel follows new Context Pin | Reliable state rule | A page-wide Saved signal cannot be attributed and must be ignored |
| Save then switch tab | Runtime sender `tabId`; active tab owns Side Panel | Per-tab Pin IDs | Background completion updates shared data only | Reliable | Broadcast storage updates formerly selected background content; foreground guard now blocks it |
| Two tabs Save different Pins | Two attempt IDs with distinct origin tab + Pin pairs | Pair-scoped | Independent transitions | Reliable state rule | Cross-tab evidence is rejected and recorded as `IGNORED_TAB_MISMATCH` |
| Background attempt succeeds/fails | Persisted attempt changes; active-tab gate on panel publishing | Original Pin | Shared Library/Needs Attention updates, Context Pin unchanged | Reliable state rule | UI that reacts to storage without checking active tab |
| Side Panel close/reopen | Worker reads active Pinterest tab, stored References and attempts | Active tab's Context Pin | Same primary state restored | Reliable within browser profile | Content state is unavailable until reconnect; panel must not fall back to last background tab |
| Content script reconnect | `pinref:ping`, reinjection, stored attempt reload | Persisted attempt Pin | In-flight Pinterest observation becomes `Save not confirmed` if evidence was lost | Reliable conservative fallback | The original ephemeral DOM control cannot be reconstructed |
| Service-worker restart | Schema-v3 attempts restored from local storage | Persisted Pin and origin tab | Pinterest-pending → unconfirmed; local-pending → local-write-failed | Reliable conservative fallback | A private Pinterest completion that was never observed remains unknowable |
| Origin tab closes | `tabs.onRemoved` and persisted attempt | Persisted Pin | Pending attempt → `Save not confirmed` | Reliable loss-of-evidence signal | Cannot infer whether Pinterest eventually committed remotely |
| Pin identity unavailable | Save intent observed but no exact route/unique event-local Pin | None | Identity unavailable; no attempt, no Reference, no anonymous Needs Attention item | Reliable no-write policy | Pinterest may have saved successfully, but PinRef cannot safely attach data |
| Duplicate Save | Confirmed attempt plus existing local Reference for same Pin | Exact Pin ID | Idempotent no-op; attempt removed | Reliable after identity | Must not refresh preview, timestamps, Tags, Note, or selection |
| Pinterest success, local write fails | Prototype failure flag after confirmed Pinterest transition | Exact Pin ID | `Couldn't save to PinRef` in Needs Attention | Reliable simulated state | Actual quota/I/O failure modes still need browser testing |
| Retry local write | Original operation/attempt, no second Pinterest Save | Same persisted Pin | Reference commit; attempt removed | Reliable state/storage behavior | Retry must first reconcile whether the atomic local transaction already committed |

## Transition traces

1. Feed, direct success: `native Save click` → `CAPTURE_STARTED` → `same-control Saved` → `PINTEREST_CONFIRMED` → `LOCAL_COMMIT_SUCCEEDED` → Reference.
2. Feed with picker: `source control` → `CAPTURE_STARTED(source Pin)` → picker portal → matching completion if observed; otherwise `TIMEOUT` → `Save not confirmed`.
3. Detail success: `route Pin` → `CAPTURE_STARTED` → same-Pin confirmation → local commit → Reference.
4. Picker completion: `source Pin retained` → explicit completion simulation → local commit → Reference.
5. Picker cancel: `CAPTURE_STARTED` → cancellation candidate → diagnostic cancelled / no Reference; without reliable cancel evidence, timeout → unconfirmed.
6. Pinterest failure: `CAPTURE_STARTED` → explicit error candidate → `PINTEREST_FAILED` → no Reference.
7. SPA navigation: `CAPTURE_STARTED(Pin A, tab 41)` → route becomes Pin B → evidence for B rejected → timeout for A → unconfirmed.
8. Immediate Pin/tab switch: `CAPTURE_STARTED(A)` → foreground Context becomes B → background A transition updates only A.
9. Concurrent tabs: `start(A, tab 41)` + `start(B, tab 57)` → independent evidence → independent results; cross-pair events rejected.
10. Background success/failure: foreground B remains selected while attempt A commits or enters Needs Attention.
11. Panel reopen: close panel → shared state changes → reopen → query active tab → render that tab plus shared records/attempts.
12. Reconnect/restart: stored in-flight attempt → no recoverable DOM evidence → conservative unconfirmed (or local-write-failed after prior Pinterest confirmation).
13. Tab close: pending origin tab removed → evidence lost → unconfirmed.
14. Identity unavailable: Save click → identity resolution fails → explicit no-write state.
15. Duplicate: confirmed attempt → existing Reference lookup → duplicate no-op → original metadata/timestamps unchanged.
16. Local failure and Retry: confirmed Pinterest → simulated local failure → Needs Attention → Retry same operation → atomic Reference commit.

## Verdict against current ADRs

- Supports ADR 0001: click and completion must remain separate; timeout, navigation, picker dismissal, reconnect, and tab close cannot safely count as success. Local retry can be independent of a second Pinterest Save.
- Supports ADR 0002: tab + Pin binding and an active-tab publish gate prevent background attempts and storage events from replacing Side Panel context.
- Supports ADR 0010: separate Capture, PinRef Library, and Pinterest Link axes are necessary; a single Saved label would be false in several scenarios.
- No ADR change is justified by simulated evidence alone. Real-site testing is still required before treating same-control Saved or accessibility error text as an acceptable production contract.
- If real-site testing cannot find a stable success signal for Feed, detail, and picker variants, ADR 0001's product boundary remains coherent but the automatic native-Save Capture feature is not technically shippable as specified; the ADR should then be superseded rather than weakening confirmation to click intent.
