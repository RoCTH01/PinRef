# Autosave Notes without user-visible drafts

Date: 2026-10-01

Editing a Note saves it: the user never manages a draft. The Inspector shows only the write state (Saving, Saved, Save failed with Retry). Text that has not yet committed stays in the editor until it commits or the user retries, but it is an implementation detail rather than a domain concept, and is never shared, searched, or presented as Saved.

When the same Note is edited on two surfaces, the last committed write wins and other surfaces receive the committed value. This supersedes ADR-0005's Local Draft model for Notes (Unsaved changes indicators, Discard) and ADR-0006's Note conflict flow (Updated elsewhere, Use my draft, Use latest, Copy draft). Field-level merging for different fields and Tag Assignment operations in ADR-0006 is unchanged; Tag Global Rename autosave in ADR-0009 is unchanged.

Considered: keeping drafts and explicit conflict resolution. Rejected because a single-user, local-first library rarely sees true concurrent Note edits, and draft and conflict states added more user-facing concepts than the risk justified.
