# Model Tags as entities and assignments

Tags are independent entities with stable identity, unique normalized names, marker color, and Library order; Tag Assignments relate Tags to References. Unassigned Tags may remain in the vocabulary, and assigning or unassigning a Tag never implicitly deletes the entity.

Dashboard owns complete Tag catalog management and Inspector surfaces edit assignments. This replaces the prototype's derived string catalog and separate color or order settings, preventing orphan settings and giving Create, Rename, Reorder, Merge, and Global Delete one coherent lifecycle.

Within its assignment flow, the Side Panel may atomically Create and assign a missing Tag, but it has no standalone creation control. A Rename that normalizes to an existing name is blocked and may offer a separate, explicit Merge flow; Rename never silently becomes Merge.

Typed text begins as a Tag Query that offers existing Tag options and Create new. Choosing an existing option assigns that entity; confirming Create new atomically creates and assigns a new entity. Once committed, editing either kind of Tag is a Global Rename across every assignment, including from the Side Panel, and the UI must name the action globally and show its affected Reference count; changing only the current Reference is a Replace Assignment operation instead.

Global Rename is intentionally low-friction because assignments reference stable Tag IDs rather than names. It requires no confirmation: the editor shows a local rename draft immediately, then autosaves after a short idle period and flushes on Enter or blur; other surfaces receive only the committed name. A duplicate normalized name still stops the rename and offers a separate explicit Merge instead of merging automatically.

Merge is an explicit Dashboard-only identity operation. A Side Panel rename collision preserves the draft and opens a preselected source-to-target preview; on commit, the target keeps its ID, name, color, and order, source assignments move atomically to the target with duplicates collapsed, and the source entity is removed. Failure leaves both Tags and all assignments unchanged.

A Tag with zero assignments remains a valid vocabulary entity with its name, color, and order. Only an explicit Dashboard Global Delete removes Tags: it previews affected Reference counts and atomically deletes the selected entities and their assignments without deleting References, Notes, or Pinterest data; Side Panel never exposes this command.

Successful Merge and Global Delete create a short-lived, version-guarded operation receipt for Dashboard Undo. Undo atomically restores the original Tag IDs, metadata, and exact pre-operation assignments; if later mutations make that restoration unsafe, PinRef preserves current committed data and explains that automatic Undo is no longer available rather than overwriting newer work.

Revised on 2026-10-01: "Side Panel" here means the Inspector on Pinterest. On Dashboard the Inspector has full Tag management (ADR-0013).
