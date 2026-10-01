# Use a PinRef-only Trash lifecycle

Removing an active Reference moves it to Trash without changing Pinterest. Trash preserves committed Tags, Note, added time, preview evidence, and last-known Pinterest Link Status; Restore returns the same Reference to the Library, while Permanent Delete is available only from Trash and irreversibly removes PinRef-owned data.

Trashed References do not participate in the active Library count, search, Tag counts, filters, or normal Inspector selection. Pinterest Unsave, deletion, privacy changes, and status-check failures never move a Reference to Trash, and a failed Trash, Restore, or Permanent Delete operation leaves the previous state authoritative across all surfaces.

The Side Panel has no Trash, Restore, or Permanent Delete commands; it shows a trashed Context Pin read-only and links to Dashboard management. Moving a Reference to Trash first attempts to flush pending edits, then requires the user to Retry, explicitly discard unsaved changes, or Cancel if drafts remain; lifecycle revisions reject any stale write that arrives after Trash or Permanent Delete commits.

Trash does not expire automatically. MVP provides both per-Reference Permanent Delete and Empty Trash with explicit item counts, partial-failure reporting, and a clear statement that Pinterest is unaffected; successful permanent deletion has no recovery path.

Permanent Delete does not retain a blocking tombstone. A later confirmed Pinterest Save or explicit Import may create a new Reference for the same Pin with a new added time, empty Tags, and No Note; none of the permanently deleted metadata, drafts, preview history, or revisions is restored.

Revised on 2026-10-01: "Side Panel" here means the Docked Inspector on Pinterest. On Dashboard the Inspector, Docked or Floating, has full Trash commands (ADR-0013). Unsaved Note text is handled per ADR-0014.
