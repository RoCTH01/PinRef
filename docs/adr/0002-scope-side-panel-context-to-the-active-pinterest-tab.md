# Scope Side Panel context to the active Pinterest tab

The Side Panel shows only the Context Pin belonging to the active Pinterest tab. Pin detail or close-up identity takes precedence, a native Save on a feed may establish context, and pages without one unambiguous Pin clear the context; hover, background observation, storage events, and background tabs never select content in the foreground panel.

Each Pinterest tab therefore owns ephemeral Context Pin state while every surface shares the persistent Library. Background tabs may complete captures and update shared data, but those updates cannot replace the Pin currently shown for editing.

The Side Panel's Pin context view uses six mutually exclusive primary states: No Context Pin, Not in PinRef, Capture pending, Needs attention, Reference available, and Identity unavailable. A page without an unambiguous Context Pin never retains the previous Pin's editor. Context Pin state is ephemeral; Capture Attempts, References, and unfinished Import Sessions persist independently.

The collection Import view defined in ADR-0004 is separate from the Pin context editor. Its source is explicitly bound at Start and does not follow later Context Pin changes. Opening a Pin detail or close-up during a scan pauses that scan; the panel must never silently replace the session's source with the new Pin.

Revised on 2026-10-01: "Side Panel" here means the Docked Inspector on Pinterest. On the Dashboard tab the Docked Inspector shows the Dashboard selection instead (ADR-0013).
