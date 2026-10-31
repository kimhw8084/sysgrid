# SysGrid Table and Rack Interaction Standard

This is the shared design and behavior contract for every operational grid, semantic HTML table, and rack elevation. Domain workflows can add actions, but do not change the shared visual or interaction grammar.

## Surface scenarios

| Surface | Use it for | Selection and bulk | Activation and menu | Zebra |
| --- | --- | --- | --- | --- |
| Operational registry grid | Asset, service, network, monitoring, external, vendor, and other editable record collections | Checkboxes and row selection only when the workspace has supported bulk actions; show selected count and clear action | Identity action opens details; a wired double-click opens the same detail. Where row actions exist, right-click and keyboard context-menu key open that same menu | Yes, subtle zebra by default for row tracking |
| Read-only detail or report table | Record facts, outcome measurements, immutable history, and audit previews | No selection or bulk controls | No row activation unless the whole row is explicitly a record link; browser copy remains available | No under six rows; subtle zebra for six or more |
| Import preview table | Validated rows and field-mapping results before a commit | Selection only when it means choosing import rows; never imply persisted records | Row actions are preview or correction actions only; commit stays in the import footer | Yes for six or more preview rows |
| Rack elevation | A physical U-space map | No table row selection. Unit selection, device selection, and rack planning are separate states | U number offers the unit action; occupied device opens details. Use native buttons and a concise title tooltip | Never; slot fills carry equipment state |

## Layout and type

- Operational grids use a 42px minimum header, 40px minimum desktop row, 12px body type, and 11px medium-weight column labels. Density controls may add space but cannot compress records below the readable minimum.
- Give checkbox, favorite, and watch utility columns 64px so their controls and labels remain legible; compact unlabeled change markers may use 52px.
- Detail tables use 12px body type and 9px × 12px cell padding. Compact modifiers use 11px and 6px × 9px padding.
- Record names and prose align left. Status, selection, and icon actions align centrally. Numeric values and dates with numeric significance align right and use tabular numerals.
- Use a quiet horizontal divider between records. Do not draw a box around every cell. Keep one subtle boundary at the grid surface and a divider at pinned utility or action columns only.
- Keep the header visible while the table body scrolls. Show a horizontal scrollbar only when the columns actually overflow. Preserve configured column order and width.

## Color and status

| Meaning | Dark palette | Light palette | Rule |
| --- | --- | --- | --- |
| Base | Carbon row `#161616`, raised header `#292929` | White row `#FFFFFF`, gray header `#F3F5F8` | Surfaces stay neutral; no tinted page background |
| Divider | Gray `#454545` | Gray `#CBD3DE` | Hairline contrast; no full cell boxes |
| Zebra | 4% neutral mix | `#F1F4F8` | Helps track long rows without overpowering content |
| Hover | 9% blue mix | `#E8F0FF` | Transient interaction only |
| Selected | 17% blue mix | `#DCE8FF` | Keep selected state visible after pointer leaves |
| Success | Pale green ink on dark | Dark green ink on a pale green surface | Include the state word |
| Warning | Pale amber ink on dark | Dark amber ink on a pale amber surface | Include the state word |
| Failure / retired | Pale red ink on dark | Dark red ink on a pale red surface | Include the state word |
| Info / focus | Bright blue on dark | Dark blue on pale blue | Blue is the interaction and brand accent |
| Reservation | Pale violet on dark | Dark violet on pale violet | Label the reservation explicitly |

State colors never carry meaning alone. A status badge includes readable text; rack equipment includes a status dot, a state fill, and a separate type label. Customer or site colors identify the site only; they do not replace health or lifecycle status. Aim for at least 4.5:1 contrast for text and 3:1 for focus and non-text state boundaries.

## Input and action behavior

- Clicking a data cell does not unexpectedly navigate, edit, or submit. It selects only when selection is supported. Buttons, links, checkboxes, and inputs inside rows retain their own action.
- Ctrl/Command-click toggles individual selection. Shift-click selects the visible range when that workspace supports range selection. Changing tenant or record scope clears selection.
- Double-click is an optional shortcut for opening the same detail surface as the identity action. It never toggles themes, submits a mutation, or opens an unrelated modal.
- Right-click opens the same row-action menu that is available from the visible row-action button. The Context Menu key and Shift+F10 open it at the focused row. Surfaces without row actions retain the browser context menu.
- Bulk commands appear only for supported, selected records. Show the target count, preview affected records, and require confirmation for destructive operations. A failed request preserves selection and explains recovery.
- Sort uses the header control and exposes its state. Filters remain named and clearable. Resize handles and keyboard focus are visible. Copyable values remain text-selectable.
- Show delayed tooltips only for clipped values, with a safe viewport position. Use accessible labels for icon-only controls; do not make a tooltip the only way to identify an action.
- Loading, confirmed empty, filtered empty, and query error are separate states. A failed fetch must not look like a legitimate empty table.

## Rack-specific encoding

- U positions are fixed-height spatial slots; keep the descending U coordinate, physical device blocks, free slots, and power units intact.
- State owns the slot fill and left edge. Active, maintenance, retired, offline, standby, reservation, selected, changed, and free slots have distinct readable treatments in both themes.
- Device type owns a separate labeled badge: PHY, VM, STO, NET, or SRV. The badge hue identifies type; it never overrides the state fill.
- Site color remains a narrow top signature bar. Search match, selected device, live connection, and plan difference use separate outlines or markers and do not animate continuously.
- U selection and device detail are real keyboard buttons with accessible names. Hover and focus reveal the same concise affordance as pointer users see.

## Ownership and rollout

`OperationalGridMatrix` and the shared grid CSS own operational-grid behavior. `sg-data-table` owns native table surfaces. Rack elevation owns its spatial state palette. New tables use these surfaces and tokens instead of one-off borders, row fills, or arbitrary type colors. The Settings → Standards reference mirrors this contract for contributors and operators.
