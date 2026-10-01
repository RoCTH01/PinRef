# Separate user-visible status axes

PinRef does not use one ambiguous Saved or Failed state. Every surface composes independent axes for PinRef Library Status (`Not in PinRef`, `In PinRef`, `In Trash`), Capture, Pinterest Link Status, metadata mutation, and Import session state, so Pinterest ownership, PinRef ownership, and write completion cannot be mistaken for one another.

Pending feedback uses an active verb and no success mark; success appears only after commit and is brief; failures persist until resolved or dismissed; unknown states remain neutral; conflicts preserve both values; and background success updates data without unsolicited toast. Side Panel and Dashboard use the same labels, icon meanings, color semantics, and accessible live feedback while keeping their different responsibilities.

After a tab, panel, Dashboard, or worker resumes, PinRef reconciles revisions rather than replacing the whole view. Clean fields patch silently, dirty fields retain their Local Draft, same-field changes become Updated elsewhere, and operations with unknown completion reconcile by operation ID before retrying; when freshness cannot be established, the UI says `May be out of date` and offers a local-state Refresh without confusing it with Reload Preview.

Revised on 2026-10-01: Local Draft and same-field Updated elsewhere no longer apply to Notes (ADR-0014).
