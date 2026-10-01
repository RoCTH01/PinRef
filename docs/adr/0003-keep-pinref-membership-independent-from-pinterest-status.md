# Keep PinRef membership independent from Pinterest status

PinRef is a linked but non-destructive library rather than a mirror of Pinterest. Pinterest owns its Save and Pin availability state, while PinRef owns Reference membership, Tags, Note, Trash, Restore, and permanent deletion; Pinterest Unsave, deletion, privacy changes, or an unknown external state never delete a PinRef Reference or its personal metadata.

PinRef may reconcile Pinterest Link Status when reliable evidence is available, but failed checks remain unknown rather than implying Unsave or deletion. MVP may reconcile opportunistically when a Pin is visited or manually reloaded and does not promise a complete background mirror of the user's Pinterest saved collection.

For an identifiable Context Pin without a Reference, the Side Panel retains the primary state `Not in PinRef` and explains the observed Pinterest status. `Not saved` directs the user to Pinterest's native Save, `Saved` explains how to open the containing Board or Saved Pins and start collection Import in the Side Panel, and `Unknown` offers status rechecking. A Pin page does not identify its containing Board reliably; the Side Panel never guesses that Board or directly or indirectly preselects the current Pin for import.

Reliable evidence that a Pin cannot be accessed sets Pinterest Link Status to `Unavailable`; network, authentication, permission, or recognition failures remain `Unknown`. Both preserve the Reference, last-known preview, Tags, and Note, and both may recover on a later check. MVP does not Relink a Reference to a different Pin identity; users may retain it or move it to PinRef Trash.

Revised on 2026-10-01 (ADR-0015): PinRef no longer shows, checks, or reconciles Pinterest Link Status for References. A Reference exists only after a confirmed Save or an Import from the user's own saves. Membership stays independent of Pinterest. The Not in PinRef guidance for a Context Pin still uses its observed Pinterest Save state.
