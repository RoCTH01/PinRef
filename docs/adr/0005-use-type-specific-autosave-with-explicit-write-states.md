# Use type-specific autosave with explicit write states

Tag assignments commit as discrete Add or Remove operations after the user chooses a Tag, while Note editing updates a Local Draft and commits after a short idle period. Blur, Context Pin changes, panel closure, and Dashboard selection changes request an immediate Note flush; neither a Tag search query nor an uncommitted Note draft is shared as Reference data.

Side Panel and Dashboard use the same mutation feedback: Editing, Saving, Saved, and Save failed. Only a confirmed commit may display Saved; failed Tag operations preserve a retryable intent while restoring committed assignment state, and failed Notes preserve the Local Draft for Retry or Discard.

Navigation and selection changes never block Pinterest or carry a Local Draft to a new Context Pin. PinRef requests an immediate flush, follows the new context, and keeps any pending or failed draft attached to its original Reference with an Unsaved changes indicator until commit or explicit discard; uncommitted drafts do not enter search.

Clearing all meaningful Note content uses the same mutation path and commits the semantic state No Note. Until that commit succeeds, the empty editor remains a Local Draft over the previous committed Note; MVP does not add a separate Clear Note command or distinguish never-written from cleared Notes.

Revised on 2026-10-01: for Notes, Local Draft, Unsaved changes and Discard are superseded by ADR-0014; Notes autosave and the user never manages a draft. Tag assignment behavior is unchanged.
