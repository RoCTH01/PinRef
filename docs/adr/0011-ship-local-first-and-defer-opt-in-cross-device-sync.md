# Ship local-first and defer opt-in cross-device sync

MVP uses one Local-first Library shared by Pinterest tabs, Side Panel, and Dashboard in the same browser profile, with no account requirement or claim that reinstalling, clearing profile data, or using another device will restore it. `Changes saved` means a confirmed local commit and is never labeled Syncing or treated as cloud durability.

Stable identities, revisions, operation IDs, and timestamps prepare the model for future opt-in cross-device sync without committing MVP to an account or cloud backend. References, PinRef Library Status, Tags, Tag Assignments, Notes, and Trash are future sync candidates; Local Drafts, Capture Attempts, Import sessions, Pinterest Link Status, and transient UI state require separate later decisions.

Revised on 2026-10-01: Local Draft no longer exists as a domain concept (ADR-0014).
