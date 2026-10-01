# PinRef Dashboard Throwaway Prototype

> Design revision (2026-09-30): ADR-0004 moves all Import interaction to the Pinterest Side Panel. This Dashboard remains the visual reference for Library layout and shared components, but candidate review is now adapted to the Side Panel instead of becoming a Dashboard destination. Existing prototype behavior is historical evidence, not validation of the revised Import ownership.

Question: can the existing Dashboard keep incomplete Capture Attempts outside the Library, surface identity-known recovery in Needs Attention, and preserve the established Inspector behavior for committed References?

This is disposable prototype code. It uses simulated in-memory attempts to validate Dashboard responsibilities; the connected extension prototype owns real `chrome.storage.local` state.

Run from the repository root:

```sh
python3 -m http.server 4173 --directory prototype/pinref-dashboard
```

Open `http://localhost:4173/`.

The earlier A/B/C comparison has concluded. The Contact Sheet direction is the only remaining version.

- There is no separate selection toolbar. Selecting multiple Pins turns the same Inspector into a multi-selection surface.
- The left library sidebar is restored from the earlier A direction. It pushes the gallery on wide screens and becomes an overlay drawer below 900 px.
- The shell now follows the Codex desktop app's three-region hierarchy: Tags navigation on the left, Gallery in the center, and a contained Inspector card on the right. The sidebar toggle is a compact active-state control in the shell's top-left corner, aligned on the same 34 px header row as the plain PinRef wordmark; the title has no disclosure arrow and the control no longer floats on the sidebar boundary.
- Multi-selection inspection uses stacked thumbnails, tag intersection, inline tag removal, tag addition, and note previews.
- Multi-selection notes use a horizontally scrollable rail; hover/focus previews a complete note and click pins it.
- Notes are editable in both Floating and Docked Inspectors. Multi-selection edits apply to the currently previewed or pinned Pin, and changes remain in the prototype's in-memory record state.
- Inspector has only two modes: Floating and Docked. Floating shows the compact selection summary; Docking is the single path to detailed metadata, so there is no separate Quick Inspect / Full details navigation state. Selecting another Pin preserves the current placement. Floating disappears when selection is cleared; Docked persists as an empty placeholder until another Pin is selected.
- The Inspector title bar now behaves like a quiet utility header: label and selection count on the left, compact Dock or Undock and Close actions on the right. `Clear selection` remains a low-emphasis action at the end of the content.
- The Inspector gives the Note editor most of the flexible vertical space. The `Clear selection` footer is reduced to a thin divided row so it does not compete with editing.
- The gallery remains image-only. Pin metadata is reserved for Search and the Inspector instead of repeating below every image.
- The sticky top area is split into a centered search row and a compact gallery toolbar. Search is centered inside the Gallery's actual available width, recalculating around both the Tags sidebar and a Docked Inspector, so the surfaces never overlap. The Docked Inspector now shares the Search row's 14 px top alignment and extends nearly the full window height for a more balanced three-column silhouette. Sorting and the mutually exclusive Masonry (dense row-first packing) and Waterfall (balanced vertical columns) modes live together in the second row.
- Sidebar tags have their own filter and scroll region. The heading shows the total tag count; entering multi-select replaces that same fixed-height heading with selection actions, so the search and list do not move. Hover reveals controls for rename, marker color, and confirmed removal; checkboxes support Shift ranges and rows can be dragged to reorder.
- A placeholder coffee donation entry and the two-state Light/Dark control sit below a divider in a flat, low-emphasis sidebar footer.
- Floating and Docked Inspect use the same editable tag chips: `×` removes a tag and `＋` adds one.
- The Floating Inspector and the add-tag picker use their entire title bars as drag surfaces; controls inside those title bars remain ordinary click targets. Their positions are kept within the viewport, and drag-only behavior is never required to access an action.
- The add-tag picker is rendered at viewport level and positioned from its `＋` trigger with collision detection. It can escape both floating and docked Inspector bounds and flips above the trigger when there is not enough room below. A compact live status row shows the currently applied intersection and confirms every addition in place; already-applied tags are disabled and marked `✓ Added`.
- The search navigation stays visible while the gallery scrolls, and its suggestion list closes on outside click.
- Below 900 px, the Inspector becomes a smaller translucent, background-blurred bottom sheet and Inspector dragging is disabled; the Add tags popover remains movable within the viewport.

Focus the main search bar for tag recommendations. Use card checkboxes to build a multi-selection and inspect its shared metadata. All state—including tags changed during the demo, panel position, selection, search, and theme—is in-memory only and resets on reload.

## Save-confirmation walkthrough

1. Choose **Needs Attention** in the existing left sidebar.
2. Confirm that `Save not confirmed` and `Couldn't save to PinRef` attempts are not counted or rendered as Library cards.
3. **Check again** keeps an unconfirmed attempt in place when no reliable evidence is available.
4. **Retry** on the local-write failure creates one committed Reference and removes the attempt; it does not require another Pinterest Save.
5. **Dismiss** removes only the attempt. It does not change Pinterest and never deletes a Reference.
6. Return to **All Pins** and confirm the existing Gallery/Inspector behavior remains intact. Search is limited to committed Tags and Notes; Board is not stored or searchable.

The state-transition evidence and full scenario matrix live in `../pinterest-site-integration/SAVE-CONFIRMATION-SCENARIOS.md`.
