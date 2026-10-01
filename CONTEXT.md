# PinRef

PinRef adds a local personal metadata layer to Pinterest references while Pinterest remains responsible for discovery and its own Save state.

## Language

**Capture Attempt**:
A temporary, retryable attempt initiated by Pinterest's native Save action. It does not become a Reference or count toward the Library until Pinterest Save is confirmed for the same Pin and the PinRef local write commits successfully.
_Avoid_: Pending reference, saved reference

**Reference**:
A PinRef library item created either from a confirmed Capture Attempt or an explicit Bootstrap Import, after its local data commits successfully.
_Avoid_: Capture attempt, Pinterest Save

**Library**:
The collection of committed References available for management and retrieval in PinRef. Capture Attempts that need attention are presented separately and are not Library items.
_Avoid_: Capture queue, Pinterest saves

**Needs Attention**:
The Dashboard page for identity-known Capture Attempts that are unconfirmed or whose local write failed. It excludes committed References, unidentified Pinterest content, and general notifications.
_Avoid_: Unknown content, Library, Trash, notification center

**Inspector**:
PinRef's single detail and working surface. Its content follows where the user is: on Pinterest it shows This Pin (the Context Pin's Tags and Note) or Import for the active tab; on Dashboard it shows the selected References with full Library management.
_Avoid_: Side Panel (Chrome's container that can host the Inspector), detail mode, This Pin panel

**Inspector Placement**:
Where the Inspector opens: Docked, hosted in the browser's Side Panel, or Floating, over the Dashboard. On Pinterest the Inspector is always Docked. Closing the Inspector keeps its placement, so the next open returns to Docked or Floating as before; a Floating Inspector never coexists with an open Side Panel.
_Avoid_: Inspector mode, dock state

**Context Pin**:
The identifiable Pin currently established by an explicit route, close-up, or native Save action in one Pinterest tab. It is per-tab, ephemeral, and may or may not have a committed Reference.
_Avoid_: Current reference, hovered Pin, globally active Pin

**Reference Name**:
An optional, user-editable label for a Reference. When it is empty, PinRef shows the Pin ID ("Pin 123…") instead. It is PinRef metadata and never changes the Pin's title on Pinterest.
_Avoid_: Title, Pin title, caption

**Pinterest Link Status**:
The observed Pinterest Save state of a Context Pin (Saved, Not saved, Unavailable, Unknown), used only to explain the next step when the Pin is Not in PinRef. PinRef does not show or refresh it for References (ADR-0015), and it never changes PinRef membership.
_Avoid_: Sync status, Reference status, saved state

**Bootstrap Import**:
An explicit, optional Inspector flow on Pinterest for scanning the active Pinterest Saved or Board surface and selecting pre-existing saves to add to PinRef. It may be repeated as Import from Pinterest, reports completeness only for that scan session, and is not account-wide sync, automatic capture, Board persistence, or ongoing mirroring.
_Avoid_: Sync, full sync, background import, automatic migration

**Import Surface**:
The Pinterest Saved Pins collection or one Board currently open in the active tab and eligible for Bootstrap Import. An individual Pin page is a Context Pin surface, not an Import Surface.
_Avoid_: Current Pin, Pinterest account, all Boards

**Import Session**:
A resumable record of one Bootstrap Import surface, its observed candidates, temporary Board grouping, and item results. It is not part of the Library or Needs Attention, and its Board context is deleted when the session completes or is dismissed.
_Avoid_: Sync job, Capture Attempt, Library batch

**No Note**:
The single semantic state in which a Reference has no meaningful Note content. PinRef does not distinguish never-written, cleared, empty, or whitespace-only Notes.
_Avoid_: Empty Note record, deleted Note

**Trashed Reference**:
A Reference removed from the active Library but retained with its committed personal metadata until Restore or Permanent Delete. Its state is independent of Pinterest Save and availability.
_Avoid_: Deleted Pin, unavailable Pin, archived Pinterest save

**Tag**:
A reusable, independently managed vocabulary item with stable identity, a unique normalized name, marker color, and Library order. A Tag may exist without being assigned to a Reference.
_Avoid_: Tag string, label setting

**Tag Assignment**:
The relationship connecting one Tag to one Reference. Assignment and removal do not create, rename, merge, or globally delete the Tag entity.
_Avoid_: Tag, tag text

**Tag Query**:
Text entered while searching for a Tag to assign. It is not a Tag until the user chooses an existing option or confirms Create new.
_Avoid_: Draft Tag, renamed Tag

**PinRef Library Status**:
Whether an identifiable Pin is not in PinRef, represented by an active Reference, or represented by a Trashed Reference. It is independent of Pinterest Link Status.
_Avoid_: Membership, saved state, collection status

**Local-first Library**:
The shared PinRef data owned by one browser profile and used by Pinterest tabs, the Inspector, and Dashboard without requiring an account. Local commit does not imply cloud or cross-device synchronization.
_Avoid_: Cloud library, Pinterest mirror, synced account
