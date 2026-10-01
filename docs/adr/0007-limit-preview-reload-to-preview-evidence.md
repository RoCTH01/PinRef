# Limit Preview Reload to preview evidence

Reload Preview updates only preview URL, rendition evidence, preview availability, and the preview check time for the same Pin identity. It never changes identity, added time, Tags, Note, Local Draft, PinRef membership, Pinterest Link Status, Boards, or UI preferences; an identity mismatch stops the operation instead of silently relinking or merging References.

The previous preview remains visible while loading and after failure. Pinterest status reconciliation is a separate command and outcome, and committed preview changes propagate without rerendering or defocusing metadata editors.

Revised on 2026-10-01: Local Draft no longer exists as a domain concept (ADR-0014).
