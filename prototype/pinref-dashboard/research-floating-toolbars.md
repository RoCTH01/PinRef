# Floating contextual toolbar and inspector research

Primary-source research for PinRef's selection toolbar, tag picker, and Quick Inspect panel.

## Executive decision

Do not make both surfaces unconstrained floating windows. The strongest combined pattern is:

- **Selection toolbar:** predictable bottom-center contextual bar by default; movable only as an escape hatch, with safe-zone snapping and a `Move to…` menu.
- **Quick Inspect:** a nonmodal utility panel that can float on wide screens, dock to the right, collapse, close, and reset; use a sheet/drawer instead of free positioning in compact layouts.
- **Tag picker:** an anchored editable combobox with a vertical recommendation list; it belongs to the selection toolbar and moves with it, but is not independently draggable.
- **Conflict rule:** the toolbar, picker, Quick Inspect, and full Inspector must never compete as four simultaneous layers. Show one transient popup at a time and prevent the two persistent surfaces from overlapping by default.

## Audit of the current prototype

| Current behavior | UX risk | Recommended change |
| --- | --- | --- |
| Both Selection Toolbar and Quick Inspect use free-form pixel dragging. | Users can create inconsistent layouts, overlap the two surfaces, or strand them after a window resize. Dragging also lacks a simple-pointer alternative. | Keep free drag on wide screens, add safe-zone snapping, `Move to…`, docking, clamping, and Reset. Disable arbitrary coordinates in compact mode. |
| Selection Toolbar defaults to a centered bottom capsule but includes drag, count, status, Tag, Remove, Reset, and Clear in one 460 px row. | The row becomes dense quickly, especially with localization or zoom; destructive and layout actions compete with frequent content actions. | Keep count + `Add tag` + `Add to view` visible. Move layout commands to an overflow; isolate `Remove` visually or put it in overflow. |
| Tag picker expands upward but presents recommendations as a horizontally scrolling chip row. | Horizontal scrolling hides available choices and does not behave like a conventional searchable recommendation list. | Use a vertical combobox/listbox with sections such as Recommended, Recent, and Create tag; keep one vertical scrollbar. |
| Quick Inspect is always a floating card with Reset and Close, while Full Inspector opens separately. | Users can end up with two inspector surfaces and unclear ownership of details. | Treat Quick Inspect as the collapsed/summary state of one inspector model. Opening full details should replace or dock/expand it, not create a competing persistent layer. |
| Drag state is kept only in memory and Reset returns to the default. | Reload loses deliberate customization, but raw coordinates would be unsafe to persist across differently sized browser windows. | Persist semantic state (`float`, `dock-right`, `collapsed`) and safe zone per width class; clamp any offset and retain a visible Reset layout command. |

The audit references the prototype implementation as it existed on 2026-09-25. It is a design review only; the prototype UI was not changed by this research task.

## Recommended PinRef pattern

### 1. Selection toolbar: compact, contextual, and semi-constrained

- Show it only while one or more items are selected. Keep the always-visible row to a selection count, `Add tag`, one or two other high-frequency actions, an overflow menu, and clear-selection/close. Fluent says a toolbar should contain frequent actions for the current view or task, should not wrap, and should move excess actions to an overflow menu. Destructive actions should be separated from other actions. [Fluent Toolbar](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage)
- Give it a predictable default location near the lower center of the gallery, but above browser/app chrome. A floating component should not cover essential content; Fluent and Apple both explicitly advise positioning transient surfaces so their relationship is clear while avoiding important information. [Fluent Popover](https://fluent2.microsoft.design/components/web/react/core/popover/usage), [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/)
- Let users move it, but snap it to a small set of safe zones: bottom-center, bottom-left, and bottom-right. Free placement remains possible on wide screens, but the next launch should restore the chosen safe-zone or clamped coordinates. This is a PinRef inference from Adobe's mature workspace model: panels are moved by their title bar/tab, dock zones are previewed during the drag, layouts are remembered, and a reset command restores the saved/default layout. [Adobe Move panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html), [Adobe Save custom workspaces](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/save-custom-workspaces.html), [Adobe Restore workspaces](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/restore-workspaces.html)
- Use a dedicated drag strip/handle, not the whole toolbar. This prevents normal button presses and text selection from accidentally moving the window. Adobe uses the tab/title bar as the panel drag surface and supports Escape to cancel a move. [Adobe Move panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)

### 2. Tag picker: anchored combobox that expands away from the toolbar

- `Add tag` should open one anchored popup, not expand the toolbar's horizontal row. Open above a bottom-anchored toolbar and flip below only when there is not enough room. Keep the trigger visible and avoid covering the selected cards when practical. Apple says a popover should point to its trigger and ideally not cover the trigger or essential content. [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/)
- Use an editable combobox with a scrollable listbox: typing filters suggestions; Down/Up moves through options; Enter applies a tag; Escape closes without changing the prior input and returns focus to the input/trigger. Expose `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and the active option. [WAI-ARIA Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- Constrain height and scroll only vertically. Fluent recommends limiting popover dimensions so the main UI stays visible and using one-axis scrolling for overflow. [Fluent Popover](https://fluent2.microsoft.design/components/web/react/core/popover/usage)
- Keep the picker open for multiple tag additions; close on Escape, explicit Done, or outside click. Apple explicitly recommends that a multiple-selection popover remain open until explicitly dismissed or clicked outside. [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/)
- Never stack a second popover over it. Close or replace the current popup if another transient menu is opened. Both Apple and Fluent advise against nested/multiple popovers because they obscure context and complicate interaction. [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/), [Fluent Popover](https://fluent2.microsoft.design/components/web/react/core/popover/usage)

### 3. Quick Inspect: movable panel, with dock and collapse states

- Treat Quick Inspect as a nonmodal panel, not a tooltip or ordinary popover: it contains persistent, interactive content and users need to continue interacting with the gallery. Apple notes that a macOS popover can detach into a persistent panel with minimal visual change; Adobe's panels can float, dock, stack, resize, and collapse. [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/), [Adobe Stack floating panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html), [Adobe Collapse/expand panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html)
- Default it to the lower-right safe zone on wide screens. Support `Dock right`, `Float`, `Collapse`, `Close`, and `Reset position`. When docked, it should resize the gallery instead of covering it. Adobe uses highlighted edge drop zones and adjusts surrounding panel groups when docking. [Adobe Adjust panels](https://helpx.adobe.com/lu_en/bridge/desktop/workspaces-and-panels/adjust-panels.html)
- Use the title bar as the drag target and keep collapse/close controls separate. Provide an explicit collapse control even if double-clicking the title bar also works; Adobe offers both tab/title-bar interactions and visible collapse controls. [Adobe Stack floating panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html), [Adobe Collapse/expand panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html)
- Consider a `Lock layout` option after the prototype phase, especially for pen/stylus users. Photoshop exposes a workspace lock to prevent accidental panel movement. [Adobe Move panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)

### 4. Responsive behavior

- On wide windows, allow floating and docking. On narrow windows or high zoom, automatically change the selection toolbar to a bottom-edge bar and Quick Inspect to a dismissible bottom sheet or full-height drawer. Apple advises against popovers in compact views and recommends a sheet/full-screen presentation instead. [Apple Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/)
- Do not preserve raw pixel coordinates across width classes. Store layout by mode (`wide` and `compact`) and clamp restored coordinates to the current viewport/safe area. WCAG's reflow guidance warns that fixed/sticky toolbars can make smaller or zoomed views unusable and strongly suggests static positioning or user-toggleable display at smaller sizes. [WCAG 2.2 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow)
- At 320 CSS px equivalent width, the controls and content still need to be usable without lost functionality. Persistent editing toolbars are an allowed two-dimensional-layout exception, but their panels/dialogs should still be resizable to fit the narrow viewport. [WCAG 2.2 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow)

### 5. Keyboard and accessibility requirements

- If the selection surface contains three or more controls, expose it as a labeled `role="toolbar"`. Use a single Tab stop with Left/Right Arrow navigation, Home/End as optional shortcuts, and restore focus to the last-used control when users return. [WAI-ARIA Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- Dragging cannot be the only repositioning method. Add a pointer- and keyboard-operable `Move to` menu with safe-zone choices (`Bottom center`, `Bottom left`, `Bottom right`, `Dock right`, `Reset`). WCAG 2.5.7 requires a single-pointer alternative to drag, and keyboard requirements apply independently. [WCAG 2.2 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)
- Escape should cancel an active drag, close the tag picker, or collapse/dismiss the focused floating surface at the appropriate layer; focus should return to the opening control or selected gallery item. This follows WAI-ARIA combobox/menu/dialog focus conventions. [WAI-ARIA Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), [WAI-ARIA Menu Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- Ensure floating surfaces never entirely cover the item holding keyboard focus. If a user-opened panel can obscure it, supply a direct dismiss/collapse command that does not require advancing focus. [WCAG 2.2 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)
- Interactive targets must be at least 24 by 24 CSS px or have enough spacing to satisfy WCAG 2.5.8; for touch-capable layouts, aim for the more forgiving 44 by 44 pt hit region Apple recommends. Visual icons can remain smaller inside those hit regions. [WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [Apple Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- Icon-only drag, reset, collapse, close, and overflow buttons need accessible names and brief tooltips. Fluent explicitly requires tooltips plus `aria-label` for icon-only toolbar actions. [Fluent Toolbar](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage)

## Concrete recommendation for the next PinRef prototype

1. **Selection toolbar:** a 48–56 px high bottom-center capsule, maximum width around 480 px; `drag handle | selected count | Add tag | Add to view | More | clear`. Put `Remove` inside More or visually separate it as destructive.
2. **Tag picker:** a 280–360 px wide anchored combobox popup that opens upward, with a maximum height around 280–320 px and one vertical scrollbar. Preserve focus and selection while adding multiple tags.
3. **Quick Inspect:** a 300–360 px wide floating card with a clear title bar; `dock/float`, `collapse`, `close`, and overflow actions. Snap to edges and show a dock preview during drag.
4. **Collision policy:** the two surfaces must not overlap each other by default. If a drag would overlap the selection toolbar, snap Quick Inspect to another safe zone or keep at least 12–16 px separation.
5. **Compact mode:** selection actions become an edge-attached bottom bar; Quick Inspect becomes a bottom sheet/drawer. No arbitrary free-floating coordinates in compact mode.
6. **Persistence:** remember panel mode and safe zone per width class, not only raw coordinates. Clamp on restore and provide `Reset layout` in the panel overflow menu.
7. **Accessible movement:** include `Move to…` and `Reset position`; dragging remains a convenience, never the sole control.

The numerical dimensions in the concrete recommendation are product-specific synthesis, not mandates from the cited design systems. Validate them in the PinRef prototype at common extension-window widths and at 200–400% browser zoom.
