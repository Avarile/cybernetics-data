# Frontend Redesign: Twenty-style look, same functionality

Status: **designed 2026-10-22 (rev. 2), not started**. Order, files and proof per step are in
`current-implementation-plan.md`.
Branch: cut `feat-twenty-ui` from `feat-db-setup`.
Demo (clickable prototype, light + dark + phone): https://claude.ai/artifact/8hD9igtVKiPGXAgj8HGnHS

> The previous content of this file (Schema Onboarding design) is in git history:
> `git show HEAD:scripts/customized/developments/current-design.md`.

The demo uses the real `data-centre` field names and types (read on 2026-10-22 through the
`cybernetics-data` MCP). Every record in it is invented. Every code path below was read from the
working tree on `feat/updated-graphy`.

---

## 0. The contract: only the UI changes

This is a **visual redesign**. It is done when the app looks like Twenty CRM's tables and
**behaves exactly as it does today**:

1. **Nothing is added.** No new buttons, menus, shortcuts, panels, settings or features.
2. **Nothing is removed.** Every control in §3 still exists, is reachable the same way, and
   does the same thing.
3. **Interaction does not change.** The same click, double-click, right-click, drag, keyboard
   shortcut and touch gesture produce the same result in the same place. Menus keep their items,
   their order and their labels. Containers stay the same kind (a modal stays a modal, a popover
   stays a popover, a tab strip stays a tab strip).
4. **Geometry that controls hit-testing stays put** unless only drawing changes: the row head
   width, the column append width and the frozen-column handle keep their sizes.
5. **No data, API, permission, i18n-key or URL changes.** New i18n strings are not needed,
   because every label already exists.

Anything that would break one of these rules is out of scope, even if Twenty does it. These are
listed in §9 so they are not reopened by accident.

---

## 1. Goal in one paragraph

Every surface of the app takes on Twenty CRM's visual language: quiet neutral chrome, 13px
Inter, 32px rows, hairline grid lines, type icons in tertiary grey, colored tint tags, relation
chips with avatars, soft hover and selection fills, 8px-radius menus with 32px items, and one
bordered work panel on a light page ground. A real light theme returns (today "light" and
"dark" are the same amber palette), and a matching dark theme is designed with it. The canvas
grid, every toolbar control, every menu and the record modal keep their behaviour. Only how they
are drawn changes.

---

## 2. Visual audit (what changes on screen)

| Area | Today | After |
|---|---|---|
| Theme tokens | "Exocortex amber". `:root` and `.dark` hold **identical** dark values; `--radius: 0.125rem` (Tailwind `rounded-md` is 0) | Twenty light under `:root`, Twenty dark under `.dark`; `--radius: 0.5rem` |
| Grid colors | Hard-coded hex in `gridTheme.ts` **and** `use-grid-theme.ts` (amber `#FFB547`, cyan `#4DE8FF`) | Read from the same CSS variables as the DOM (D2) |
| Select tags | 6px radius, solid colors | 4px radius, tint palette (D4) |
| Relation / user cells | Plain pills | Chips with a 14px avatar |
| Primary column | Text | Avatar + text (drawn only; no new click target) |
| Headers | Amber text, triangle menu marker | Tertiary grey icon + name, chevron menu marker in the **same hit region** |
| Toolbar buttons | Ghost buttons; active filter/sort/group use violet/orange/emerald fills | Same buttons, Twenty ghost style; active states keep their own hue (purple/orange/green tints) so they stay distinguishable |
| View tabs | Boxed tabs | Twenty tab style: text tabs with an underline on the active view |
| Record modal | Dense single column | Same modal, same header actions, two-column label/value rows, 8px radius |
| Menus | 2px radius, amber accents | 8px radius, 32px items, neutral hover, blue check |
| Shell | Sidebar flush against content | Sidebar on the page ground; content in one bordered `rounded-lg` card |

---

## 3. Parity inventory (the acceptance checklist)

Each row must behave identically after the redesign. The plan's QA phase walks this list.

### 3.1 Sidebar (`BaseLayout` → `Sidebar`)
| Control | Behaviour kept |
|---|---|
| Base switcher (`BaseSidebarHeaderLeft`) | Dropdown: back to space, switch base ▸ (submenu of bases), version badge |
| Quick action (`QuickAction`, search icon, ⌘K) | Command dialog: resources grouped by Table / Dashboard / App / Automation, then Theme (Light / Dark / System). It does not search records, and it still won't |
| Collapse (`ChevronsLeft`, ⌘B), resize handle | Same widths (min/max from `toggle-side-bar/constant`) |
| Page router (`BasePageRouter`) | "Graph" link; "More" menu with Trash (needs `base|delete`) and Design (needs `base|update`) |
| Node tree (`BaseNodeTree`) | Folders expand/collapse, drag to reorder and nest, rename, per-node ⋯ menu, star (pin) button on hover (shown always when pinned), add-resource "+" on folders, "Create" at the bottom |
| Footer (`SideBarFooter`) | User menu, Settings dialog, Notifications |
| Mobile | `SheetWrapper` / `HoverWrapper` behaviour unchanged |

### 3.2 Table header (`TableHeader`)
| Control | Behaviour kept |
|---|---|
| `TableInfo` | Table icon + name, double-click rename, emoji icon picker |
| `ExpandViewList`, `ViewList` tabs | Click switches view; drag reorders; active tab's menu: Rename, Duplicate, Delete, Lock / Unlock view; pinned views |
| `AddView` | Menu: Grid, Form, Kanban, Gallery, Calendar, Add plugin view |
| Right actions | Collaborators avatars, Invite (primary button → `ShareBasePopover`), AI chat toggle, Help, Show in graph, ⋯ (`BaseNodeMore`). On touch these collapse into the ⋯ sheet, as now |
| Locked view tip | Same banner |
| Template mode | Copy link + `PublicOperateButton` |

### 3.3 Grid tool bar (`GridToolBar`)
| Control | Behaviour kept |
|---|---|
| "+ Add record" | Opens `CreateRecordModal` (a form modal, then Create) |
| Hide fields (`HideFields`) | Popover with search, per-field toggles, Show all / Hide all; clicking a field scrolls to it and highlights it; label "N hidden fields" when active |
| Filter (`ViewFilter`) | Condition builder: Add condition, Add condition group (nesting limit), per-row field / operator / value, and/or; label "Filter by …" when active; warning icon for invalid conditions; share-view notice |
| Sort (`Sort`) | Rows of field + direction ("first → last" / "last → first"), Add another sort, "Automatically sort records" switch; label "Sort by N fields" |
| Group (`Group`) | Rows of field + order, Add subgroup; label "Group by N fields" |
| Row height (`RowHeight`) | Short / Medium / Tall / Extra tall, field-name display lines |
| Search (`SearchButton`) | Expanding input, field scope, match count with ↑ ↓ pagination, highlights |
| Undo / Redo | Same buttons, ⌘Z / ⇧⌘Z / ⌘Y |
| Share (`SharePopover`), Personal view (`PersonalViewSwitch`) | Same popovers and toggle; fold into ⋯ under `@md/toolbar` as now |
| Other view types | Kanban / Gallery / Calendar / Form tool bars keep their own controls |

### 3.4 Grid (canvas, `GridViewBaseInner` + `packages/sdk/src/components/grid`)
| Interaction | Behaviour kept |
|---|---|
| Row head (70px) | Drag handle (needs `view|update`), checkbox, expand icon (opens record modal), comment count badge. All drawn at all times (`rowIndexVisible={false}`) |
| All-checkbox | Top-left; selects all |
| Column header click | Desktop: selects the column. Touch: opens the header menu |
| Header menu marker | Opens `FieldMenu` (Edit field, Duplicate, Generate, Download all files, Insert left / right, Filter / Sort / Group by this field, Freeze up to this field, Hide, Delete) |
| Header double-click | Opens field settings |
| Primary lock icon, description icon | Same click regions and tooltips |
| Column drag, resize, freeze handle | Unchanged |
| Cell click / double-click / typing / Enter | Select / edit / edit with that character / edit |
| Range selection | Drag, Shift+click, copy, paste, fill handle, delete |
| Right-click | `RecordMenu` on cells/rows (Insert N above / below, Copy cells, Copy record URL, View record history, Add comment, Add to Chat, Duplicate selected, Delete record(s)); `FieldMenu` on headers; `GroupHeaderMenu` on group rows (expand / collapse this group, all groups) |
| Group rows | Click toggles collapse |
| Append row ("+") | Adds a record (with prefill from filters, as today); per group when grouped |
| Append column ("+") | Opens create-field |
| Statistic row | Shows "Summary" on hover when unset; click opens `StatisticMenu` with the same functions (Count, Empty, Filled, Unique, Max, Min, Sum, Average, Checked, Unchecked, Percent …, Earliest / Latest date, Date range, Total attachment size) |
| Collaborator cursors, search highlights, comment counts, loading cells | Same behaviour, new colors |

### 3.5 Record modal (`ExpandRecord`, `ExpandRecordHeader`, `RecordEditor`)
| Control | Behaviour kept |
|---|---|
| Container | `Modal` on desktop, `Drawer` on touch (the unused `Panel.tsx` stays unused) |
| Header | ↑ ↓ previous / next record, title, "Record from {table}", Copy record URL, history toggle, comment toggle, ⋯ (Duplicate record, Delete record), close |
| Body | Field editors in view order; "Show N hidden fields" toggle; computed fields read-only |
| Side areas | Record history and comments open inside the modal, as now |

---

## 4. Decisions

**D1. Keep the canvas grid and change only how it is drawn.** Every look in the demo can be
drawn on canvas. The demo is DOM only because it is a throwaway prototype. Draw functions change;
hit regions (`RegionType`), handlers and coordinate math do not.

**D2. One token source.** CSS custom properties in `global.shadcn.css` are the only place a color
is defined. `useGridTheme` builds `IGridTheme` from them at runtime (`getComputedStyle` when the
resolved theme changes) instead of holding hex. Canvas cannot evaluate `color-mix`, so tag tints
and fills are computed by a small pure util `mixColor(a, b, t)`, which is unit-tested.

**D3. Light becomes light; amber is deleted** (§10.1). `:root` gets Twenty light and `.dark` gets Twenty dark. The
`ThemeProvider` config, the `?theme=` override and the theme items in Quick action are untouched.
Only the colors behind them change, plus the `themeColor` meta (`#ffffff` / `#171717`).

**D4. Tag palette: 10 hues × 3 intensities.** Stored colors (50 `Colors` values) do not change.
They map at draw time:

| Stored shade | Intensity | Background | Text |
|---|---|---|---|
| `Light2`, `Light1` | outline | transparent, 1px border = hue 42% over surface | hue 62% over foreground |
| `Bright`, base | soft | hue 13% over surface | hue 62% over foreground |
| `Dark1` | strong | hue 30% over surface | hue 42% over foreground, weight 500 |

This keeps the user's distinct pairs distinct: `urgent = redDark1` vs `important = redBright`,
and `finished_reviewing = greenLight1` vs `finished_validating = green`. Hue bases (same in both
themes): blue `#0090ff`, cyan `#00a2c7`, gray `#8d8d8d`, green `#30a46c`, orange `#f76b15`,
pink `#d6409f`, purple `#8e4ec6`, red `#e5484d`, teal `#12a594`, yellow `#e2a336`. The color
picker in field settings shows the same 50 swatches drawn through this mapping.

**D5. Toolbar active colors keep their meaning.** Filter, Sort and Group each have a distinct
active fill today. They keep distinct fills from the hue set (purple, orange, green tints) and
keep the "Filter by …" / "Sort by N fields" text.

**D6. Field names are shown as stored** (`assigned_to` stays `assigned_to`).

**D7. Icons stay `@teable/icons`**, 16px, in `--foreground-tertiary` for headers and
`--muted-foreground` elsewhere.

---

## 5. Tokens

Values are HSL triplets (shadcn convention: `hsl(var(--x))`). Hex is shown for reading.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | `#ffffff` | `#171717` | work panel, cells, popovers, modal |
| `--background-secondary` *(new)* | `#fafafa` | `#121212` | page ground, sidebar, group rows, row hover |
| `--accent` | `#f1f1f1` | `#222222` | hover fills, header hover, active tab bg on touch |
| `--secondary` | `#ebebeb` | `#2a2a2a` | pressed, `ToolBarButton` active |
| `--foreground` | `#333333` | `#ebebeb` | primary text |
| `--muted-foreground` | `#666666` | `#b3b3b3` | secondary text, sidebar items |
| `--foreground-tertiary` *(new)* | `#999999` | `#818181` | header labels, placeholders, counts, "Summary" |
| `--foreground-light` *(new)* | `#b3b3b3` | `#5e5e5e` | drag grips, disabled |
| `--border` | `#ebebeb` | `#262626` | panel border, header bottom, menus |
| `--border-light` *(new)* | `#f1f1f1` | `#1f1f1f` | grid lines |
| `--border-high` | `#d6d6d6` | `#333333` | checkboxes, scrollbars |
| `--primary` / `--ring` | `#1961ed` | `#4a86f7` | active cell, selection, focus, Invite button |
| `--selection` *(new)* | primary 7% over bg | same rule | selected rows / ranges |
| `--destructive` | `#e5484d` | `#e5484d` | delete items, comment badge |
| `--success` / `--warning` | `#30a46c` / `#f76b15` | `#3dd68c` / `#f76b15` | status only |
| `--radius` | `0.5rem` | | Tailwind `lg` 8px, `md` 6px, `sm` 4px |

- **Type:** Inter Variable (already loaded). 13px body, 12px small, 11px uppercase section labels
  (`letter-spacing: .04em`), 18px modal title. Weights 400 / 500 / 600. Tabular figures in
  number, currency and statistic cells.
- **Heights:** row 32 (short row height; Medium / Tall / Extra tall unchanged), column header 32,
  statistic row 32, group header 36, table header 44, tool bar 40, sidebar item 28, menu item 32,
  tag / chip 20, avatar 14.
- **Shadows:** `--shadow-1: 0 0 4px rgb(0 0 0/.08), 0 2px 4px rgb(0 0 0/.04)`;
  `--shadow-2: 0 0 4px rgb(0 0 0/.08), 0 8px 24px rgb(0 0 0/.10)`; dark mode alpha .4 / .5.

---

## 6. Component specs (visual only)

### 6.1 Shell
Grid `sidebar | 1fr`, gap 8, outer padding 10/16. The sidebar is transparent on
`--background-secondary`. Content sits in one card: `bg-background border rounded-lg
overflow-hidden`. Sidebar rows are 28px, radius 4, `--muted-foreground` icon + text; the active
row uses `bg-accent text-foreground font-medium`. Folders get a 1px guide line for children. The
star and "+" buttons keep their hover-reveal behaviour.

### 6.2 Table header and view tabs
44px. `TableInfo` in `--foreground` 500. View tabs become text tabs: icon + name in
`--muted-foreground`, active tab in `--foreground` with a 1px underline, hover `bg-accent`. The
right actions are 24px ghost icon buttons, and Invite is the one solid `--primary` button.

### 6.3 Tool bar
40px with a top border. "+ Add record" is an outline button. The other controls are 24px ghost
buttons (icon + label at `@2xl/toolbar`); the separators are 1px × 16px `--border`. The filter,
sort and group active fills follow D5. Popovers (hide fields, filter builder, sort, group, row height,
share) use the menu style in §6.6; the filter builder's rows are 32px inputs with radius 4.

### 6.4 Grid
| Part | Spec |
|---|---|
| Lines | Horizontal and vertical `--border-light`; header bottom and statistic top `--border` |
| Row head (70px, unchanged) | Drag grip in `--foreground-light`, checkbox 14px radius 3 (`--border-high` stroke, `--primary` fill when checked), expand icon in `--foreground-tertiary`; hovering a control darkens it to `--foreground` |
| Header | Primary lock sprite + type icon + name, all tertiary; name weight 500; menu marker drawn as a 12px chevron in the existing `ColumnHeaderMenu` region; hover fill `--accent`; selected column fill `--selection` |
| Primary cell | Avatar 14 (square with initial; round with initials when the primary is a person name in a user/contact table) + name. Drawn only |
| Select | Tags per D4, height 20, padding 6, radius 4 |
| Relation / user | Chips: `foreground 5%` fill, radius 4, avatar + name |
| Checkbox | 14px box, radius 3, `--primary` when checked |
| Numbers / currency / auto number | Tabular figures; auto number tertiary |
| Dates | Existing formatting; created / modified time in `--muted-foreground` |
| Long text | First line, `--muted-foreground` |
| Hover | Row fill `--background-secondary` |
| Selection | Rows and ranges `--selection`; active cell 1px `--primary` border; fill handle 5px `--primary` square |
| Editors | Same editors; container 1px `--primary` border, radius 4, shadow-2 |
| Group row (36px) | Chevron, value drawn as its tag (select) or text, count tertiary; fill `--background-secondary` |
| Append row | "+" in tertiary, row hover `--background-secondary` |
| Append column (100px, unchanged) | "+" icon centred, tertiary |
| Statistic row (32px) | Unset: "Summary" on hover (existing text). Set: function label tertiary + value 500 |
| Frozen edge | 1px `--border` plus a soft 6px shadow while scrolled |
| Collaborators / search | Collaborator colors unchanged; search hits yellow tint, current hit stronger |

### 6.5 Record modal
Radius 8, `--background`, shadow-2, max width as today. Header 48px: ↑ ↓ ghost buttons, 18px
title (600) with "Record from {table}" in tertiary underneath, the right-hand icon buttons as ghost 24px,
close ×. Body: two-column rows (label 34% with type icon in tertiary, editor on the right); the
"Show N hidden fields" toggle is a tertiary text button with a chevron. The history and comment
side areas are separated by a 1px `--border`.

### 6.6 Menus, popovers, dialogs (ui-lib)
`DropdownMenu`, `Popover`, `Command`, `ContextMenu`, `Select`, `Dialog`, `Sheet`: radius 8, 1px
`--border`, shadow-2, 4px inner padding; items 32px, radius 4, 16px icon, hover `--accent`,
check at the right in `--primary`; search rows sit on top with a bottom border; group labels are
11px uppercase tertiary; destructive items use `--destructive`. **Items, order and labels are
untouched.**

### 6.7 Other views and pages
Kanban stacks on `--background-secondary` with a tag + count header; cards are `--background`,
1px border, radius 8, field rows following §6.4. Gallery, Calendar, Form and List take the tokens
and the card style. Space home, base cards, settings, admin, share and template pages take the
tokens and shell, with no layout or control changes.

---

## 7. `GRID_DEFAULT` changes (drawing only)

| Key | Now | New | Why it is safe |
|---|---|---|---|
| `columnStatisticHeight` | 40 | 32 | the region still spans the whole row |
| `groupHeaderHeight` | 48 | 36 | collapse region is the whole row |
| select `OPTION_RADIUS` | 6 | 4 | drawing |
| select `OPTION_PADDING_HORIZONTAL` | 8 | 6 | drawing (editor hit areas measured from text) |

Unchanged on purpose: `rowHeadWidth` 70, `columnAppendBtnWidth` 100, `columnHeadMenuSize`
12, `columnFreezeHandlerWidth`, `rowHeight` 32 and the row-height levels.

---

## 8. Accessibility and theming rules
- Text contrast is at least 4.5:1 on `--background` in both themes. Tertiary (`#999`, 2.8:1) is used
  only for labels that always sit next to an icon or a value.
- Focus rings stay visible (2px `--ring` at 55%).
- No component sets a literal color. A grep for `#[0-9a-fA-F]{6}` in `apps/nextjs-app/src` and
  `packages/sdk/src/components` returns only token files, color utils and specs.
- The hard-coded toolbar fills (`bg-violet-100 dark:bg-[#241A31]` etc.) move to tokens.

## 9. Ruled out by the contract (do not reopen)
These were in rev. 1 of this design and are withdrawn because they change behaviour:
a view picker dropdown in place of tabs; one Options menu instead of separate tool bar buttons;
a filter/sort chips row with Reset / Update view; draft (unsaved) view edits; selection actions
in the table header; an "Open" button inside the primary cell; moving the expand control out of
the row head; a record side panel as the default; record search in ⌘K; a Favorites section in the
sidebar; reordering `FieldMenu` items; humanized field names.

## 10. Decisions taken (2026-10-22)
1. **The amber palette is removed.** It is not kept as an extra theme. It lives in exactly three
   files: `packages/ui-lib/src/shadcn/global.shadcn.css` (the "Exocortex amber" `:root` and
   `.dark` blocks), `packages/sdk/src/components/grid/configs/gridTheme.ts` and
   `packages/sdk/src/components/grid-enhancements/hooks/use-grid-theme.ts`. All three are
   rewritten in Phases 1–2, and the greps in the plan's Phase 2 proof and step 8.7 must come back empty. Git history keeps it.
2. **Primary-cell avatars are kept** (design §6.4). They are drawn only: no new hit region, the
   click / double-click / edit behaviour of the primary cell is unchanged, and the editor text
   aligns with the text start after the avatar.
