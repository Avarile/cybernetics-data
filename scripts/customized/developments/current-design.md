# Agent cockpit: base and table scope, table search, record reader

Design for `current-goal.md` (Features 1–3), 2026-10-31, branch `feat/agent-cockpit` (after 52996c24).
Frontend in `apps/nextjs-app/src/features/app/blocks/agent/` (one folder, layers as today), backend in
`apps/nestjs-backend/src/features/agent/`, contracts in `packages/openapi/src/agent/`.

Every choice the goal leaves open has a default in §15. They are marked **(D#)** where they are used.

---

## 1. Summary

| Today | After |
| --- | --- |
| Stage knobs top-right: OVERVIEW · BOARD · CONSTELLATION, then BUNDLE · TREE | BUNDLE and TREE stacked under the readout, top-left. The other three buttons are gone. |
| A search can be drawn as a BOARD (lanes of cards) | No board. The board components and their key bindings are deleted. |
| ASK THE AGENT is a chat: suggestions, `/clear`, `/skills`, transcript, plans | A command line. `/base <name>`, `/table <name>`, and plain text, which is a search. It has no suggestions and no other commands. The transcript becomes a short log. **(D1)** |
| Overview cycles 4 fixed datasets (WORK, KNOWLEDGE, PEOPLE, FINANCE) | The overview cycles through every table of the current base, 60 s each. |
| THREAD dropdown | BASE dropdown with the current base and a ★ to make a base the default |
| DATASET menu | TABLE menu: the tables of the current base, with the countdown and pause |
| Rail: ASK · TYPES (branches) · RECENTLY UPDATED (feed) | Rail: ASK · TYPES (unchanged) · SEARCH RESULTS |
| — | Clicking a result highlights it on the chart (forcing it onto the chart if needed, 10 at most) and opens a centre modal with the record as Markdown. A record over 500 characters also gets an agent summary, which is spoken when voice is on. |

## 2. The goal, requirement by requirement

| # | Requirement (goal text) | Where |
| --- | --- | --- |
| F1.1 | Move OVERVIEW BOARD CONSTELLATION BUNDLE TREE to the left, under the Overview component, buttons stacked | §4.1 |
| F1.2 | Remove the OVERVIEW, BOARD and CONSTELLATION buttons | §4.1 |
| F1.3 | Remove the BOARD components entirely | §4.2, §13 |
| F2a.a | Remove the suggested questions | §6.1 |
| F2a.b1 | `/base <basename>` autocompletes the bases (`/base dat` → only `data-centre`) | §6.2, §6.3 |
| F2a.b2 | `/table <tablename>` autocompletes the tables of the current base | §6.2, §6.3 |
| F2a.b3 | Plain text is a query, run after 3 s idle (non-empty) or on Enter/Send | §6.4 |
| F2a.b3 | The query is the table page's Search | §7.1 |
| F2a.b3 | Results are highlighted on the chart and listed in a new Search Results panel | §7.3, §7.4 |
| F2a.b3 | Click a result: highlight it, forcing it onto the chart and dropping non-results (10 result items at most) | §7.3 |
| F2a.b3 | Click a result: centre modal with the record as Markdown; over 500 chars → agent summary; voice on → summary spoken | §8 |
| F2b | TYPES unchanged | §9.3 |
| F2c | RECENTLY UPDATED replaced by Search Results | §7.4 |
| F3.1 | THREAD dropdown → the current base; it follows `/base` | §5.1 |
| F3.2 | An icon sets a base as the default, whose tables rotate every 60 s | §5.2, §5.3 |

## 3. Target layout

```text
┌─ BASE [data-centre ★ ▾]  TABLE [KNOWLEDGES ▾] ▬▬▬▬▭ NEXT TASKS · 0:42 ⏸ ─────── MONO|CYBER · LIVE · 12:04Z · ⏻ ─┐
│ KNOWLEDGES                                                                            ┌ ASK THE AGENT  CLEAR ⤢ ┐
│ KNOWLEDGE_TYPE → KNOWLEDGES                                                           │ ▸ BASE data-centre     │
│ OVERVIEW · UPDATED 04:12Z                                                             │ ▸ QUERY "deploy" · 12  │
│ 238 RECORDS                                                                           │ ┌ /base dat ─────────┐ │
│ TYPES 14 · ENTRIES 238 · …                    constellation (full-bleed)              │ │ data-centre  ★     │ │
│ ┌────────┐                                                                            │ └────────────────────┘ │
│ │ BUNDLE │  ← stacked knobs (F1)                                                      │ [ input ...    ] [↑]   │
│ ├────────┤                                                                            │ VOICE ◯  ⚙             │
│ │ TREE   │                                                                            ├ TYPES  HOVER TO LIGHT ─┤
│ └────────┘                                                                            │ …unchanged…            │
│ (pinned node detail, when one is pinned)                                              ├ SEARCH RESULTS 12    ✕ ┤
│                                                                                       │ ● Deploy K3s  OFF CHART│
│ legend                                                                                │ ● Deploy notes …       │
└───────────────────────────────────────────────────────────────────────────────────────┴────────────────────────┘
                      ┌──────────── record modal (centre, over the stage) ────────────┐
                      │ KNOWLEDGES · Deploy K3s                      OPEN IN TABLE  ✕ │
                      │ AGENT SUMMARY  (only when the record is over 500 chars)      │
                      │ RECORD (Markdown)                                             │
                      └───────────────────────────────────────────────────────────────┘
```

Below 1180 px the deck stacks as it does today: the totals sit above a boxed chart and the rail goes
below it. The knobs stay under the readout.

---

## 4. Feature 1: the stage knobs and the board

### 4.1 Knobs

- `StageKnobs` (`ui/stage/StageHead.tsx`) becomes `LayoutKnobs`: two buttons, BUNDLE and TREE, in
  a vertical group (`role="group"`, `aria-label="Layout"`). They keep `aria-pressed` and
  `store.setLayout`.
- `StageDeck` drops the `knobs` slot of the top-right corner (`d.ovTr`). It renders a new `layout`
  slot inside the top-left column (`d.ovTl`), after the readout and the `aside`.
- `deck.module.css`: `.ovTr` is removed and `.layoutKnobs` is added
  (`display:flex; flex-direction:column; gap:4px; align-items:stretch; width:max-content`).
  `useStageFrame` already measures the readout's ref to keep the chart clear of it. The ref moves
  to a wrapper that holds the readout and the knobs, so the frame keeps clear of both.
- The OVERVIEW, BOARD and CONSTELLATION buttons are deleted. There is one stage now: the table
  overview with its search highlight (§7), so nothing is left to switch between.

### 4.2 Board

These are deleted: `ui/stage/SearchBoard.tsx`, `TableLane.tsx`, `RecordCard.tsx`; the board branch
of `StageContainer` (`board=` and `SearchBoard`), `StageDeck`'s `board` slot and `.boardArea`
styles; `toLane`; the `[`/`]` lane movement (`moveLane`); `V` (`switchView`); the `view` state
(`ICockpitView`, `setView`); and the board's i18n keys. `model/search-board.ts` serves the agent's
search stage, which leaves with the chat (§13, **D1**).

### 4.3 Keys after F1–F3

| Key | Does |
| --- | --- |
| `/` | focus the composer |
| `T` | bundle ↔ tree |
| `0` | reset zoom |
| `[` `]` | previous / next actor on the chart (pinned) |
| `1`–`9` | that table of the TABLE menu, held |
| `P` | pause / resume the rotation |
| `F` | browser full screen |
| `Esc` | in order: close the record modal → close the suggestions → unpin → clear the search → resume the rotation. It never turns the cockpit off. |
| `Ctrl/⌘ J` | cockpit on/off (unchanged) |

`V`, the lanes and `Mod+Shift+O` (new conversation) are removed.

---

## 5. Feature 3: base and table scope

### 5.1 BASE menu (replaces THREAD)

`ui/shell/BaseMenu.tsx`, built like `ThreadMenu` (Popover, search box, list):

- Button: `BASE` label, base name in bold, a small line saying `DEFAULT` or `<n> TABLES`, and a
  caret. Next to it sits a ★ icon button (lucide `Star`). It is filled when the current base is the
  default and outlined otherwise. A click makes the current base the default (§5.2). It is disabled
  while that request runs.
- List: every base the admin can open except the Agent space's bases (the same rule as
  `SchemaCatalog.dataBase`), grouped by space and filtered by the search box. Each row has its own ★.
  Picking a row is the same as `/base <name>` (§6.5).
- It updates whenever the base changes, from the menu or from `/base`.

### 5.2 Default base

- The default is `agent_setup.data_base_id`, the field the overview and the agent's searches
  already use (`GetOverview`, `plan-search`). Setting it from the cockpit calls `PUT
  /api/agent/cockpit/default-base`, which runs `store.updateProfile(defaultProfile.id, {
  dataBaseId })`. **(D5)**
- When nothing is set, the default is the base the catalog picks today (`catalog.dataBase(null)`:
  the base with the most recipe tables). Without one, it is the first listed base.
- The cockpit opens on the current base kept in the browser (§11.2). If that base is gone or was
  never set, it opens on the default base. The default base's tables rotate every 60 s. Any other
  current base rotates the same way **(D6)**. Being the default decides where the cockpit starts.

### 5.3 TABLE menu and rotation (replaces DATASET)

- `ui/shell/DatasetMenu.tsx` → `TableMenu.tsx`. It keeps the same listbox, keys and `DatasetNote`
  (progress line, `NEXT <TABLE> · m:ss`, ⏸/▶). The four datasets are replaced by the tables of the
  current base in table order. `1`–`9` pick the first nine. A table that cannot be drawn is listed
  with the reason and cannot be picked (today's `failed`).
- The cycle (`model/overview/cycle.ts`) is generalised from `IOverviewDatasetId` to table ids
  (`string`), with `DATASET_MS` still 60 000. The holds are `pointer | pin | picked | paused | hidden`
  plus two new ones:
  - `search`: a search is active. The rotation must not move the table out from under its results
    (§7.2).
  - `typing`: the composer holds plain text that has not been sent, so the table does not change
    before the idle search runs.
- `/table <name>` and a pick from the menu both set `tableId` in the scope, send the cycle a `pick`
  (held), and move the stage to that table. Resume (▶, `P`, `Esc`) clears `tableId` and lets the
  rotation go on.
- `/base` (or the BASE menu) clears the table, the search and the pins, then restarts the cycle with
  the new base's tables (`available` event, index 0).
- Excluded from the rotation and from `/table`: system tables (`systemTable` in
  `domain/search/schema.ts`). A table whose overview fails or has nothing to draw leaves the loop
  but stays in the menu with the reason. `/table` can still pick it, and the stage then explains why
  it is empty.

---

## 6. Feature 2a: the ask panel

### 6.1 What goes

`ui/ask/Suggestions.tsx`, the skills picker and `/clear` / `/new` (`model/skills.ts`,
`useAgentSkills`), the transcript with its plan, tool, approval and clarify cards, and the lens
knobs. Under **D1** the chat goes too (§13). The panel keeps its title `ASK THE AGENT`, the ⤢ enlarge
button, voice, and the composer. `NEW` becomes `CLEAR`, which clears the log, the search and the
selection. It keeps the base and the table.

### 6.2 Command grammar (`model/commands.ts`, pure)

```ts
type IParsed =
  | { kind: 'empty' }
  | { kind: 'command-name'; partial: string }         // "/", "/ba"
  | { kind: 'base'; arg: string }                      // "/base", "/base dat"
  | { kind: 'table'; arg: string }                     // "/table fin"
  | { kind: 'unknown-command'; name: string }          // "/foo …"
  | { kind: 'query'; text: string };                   // anything not starting with "/"

parseInput(raw: string): IParsed
```

- The command name is the text after `/` up to the first space, matched case-insensitively. The
  argument is everything after the first space, trimmed, so table names with spaces work
  (`/table Parent Category`).
- Text that starts with a space before the `/` is a query. To search for text that starts with `/`,
  the admin types a leading space. This is documented in the placeholder hint.
- The placeholder reads `Search <TABLE> · /base · /table`.

### 6.3 Autocomplete

`suggest(parsed, bases, tables): ISuggestion[]`:

| Input | Suggestions |
| --- | --- |
| `/` or `/b`, `/t` | the two commands with a one-line description (`/base <name>: choose the database`, `/table <name>: choose the table`) |
| `/base` or `/base ` | every base, the default first and marked ★ |
| `/base dat` | bases matching `dat` (rule below) |
| `/table …` | tables of the current base, same rule |
| `/foo` | none, and the line under the input says `UNKNOWN COMMAND · /base, /table` |
| plain text | none |

Matching rule **(D10)**, case-insensitive, with `-`, `_` and spaces kept as typed:

1. Names that **start with** the argument, in list order.
2. Only when step 1 finds nothing: names with a word (split on `-`, `_`, space or a camelCase
   boundary) that starts with the argument.

With the dev server's bases (`data-centre`, `demo_database`, `primary_database_2`): `/base` → all
three; `/base d` → `data-centre`, `demo_database`; `/base dat` → `data-centre` only (step 1 has a
match, so the `database` words in the other two are not considered); `/base centre` → `data-centre`
(step 2). This exact case is a unit test.

Keyboard in the list: `↑`/`↓` move, `Tab` completes the input to `/base <name>` without applying
it, `Enter` or a click applies the highlighted suggestion, and `Esc` closes the list. With no list
open, `Enter` applies a command whose argument names exactly one base or table (exact
case-insensitive match first, else the single suggestion). Otherwise it shows `NO BASE NAMED "x"`
or `NO TABLE NAMED "x" IN data-centre` under the input and keeps the text.

The list is `role="listbox"` with `aria-activedescendant` on the textarea (combobox pattern), like
today's skills list but keyboard-driven.

### 6.4 Queries: Enter, Send, or 3 s idle

In the composer (`ui/ask/Composer.tsx`, which keeps its voice parts):

- After every change, a single timer is (re)started for `SEARCH_IDLE_MS = 3000`. When it fires, the
  query is submitted if all of these hold: the input parses as `query`, the text is non-empty after
  trimming, it differs from the active query of the current table, and no IME composition is
  running.
- `Enter` (without Shift) or the Send button submits at once and cancels the timer. When the text
  equals the active query, it runs again (a refetch).
- The input is **not cleared** after a query: the admin refines it in place, and the idle timer
  searches again. Commands clear the input once applied **(D11)**.
- Clearing the input does not clear the results. `✕` on the results panel, `CLEAR`, or `Esc` does.
- While the input holds unsent plain text, the cycle holds `typing` (§5.3). Emptying the input or
  submitting releases it.
- Voice: a finished spoken phrase goes through the same parser and submits at once (no idle wait).
  "slash base data centre" is not parsed as a command. Voice is for queries.
- While the request runs, the panel title shows `SEARCHING`. A newer query cancels the older
  request (the react-query key changes; the request carries an `AbortSignal`).

### 6.5 Applying a command

| Command | Effect |
| --- | --- |
| `/base <name>` | `setBase(id)`: the scope's base changes, the table, search, pins and forced records are cleared, the cycle restarts on the new base's tables, the BASE menu shows the base, and the log gets `▸ BASE data-centre`. |
| `/table <name>` | `setTable(id)`: the stage goes to that table, held. A query that is active re-runs on this table (§7.2). The log gets `▸ TABLE tasks`. |

### 6.6 The log (`ui/ask/AskLog.tsx`, replaces `Transcript`)

The log replaces the transcript. It keeps the last 50 entries in the search store (not persisted):
base and table changes, queries with their counts (`▸ QUERY "deploy" · 12 IN KNOWLEDGES`), errors,
default-base changes, and summaries (`▸ SUMMARY · Deploy K3s: …`). The summary text is the same text
that voice speaks, so what was said can be read back. It has `aria-live="polite"` and scrolls to the
newest entry.

---

## 7. Feature 2b: the table search

### 7.1 Same as the table page's Search

The table page's search (`blocks/view/search/SearchButton.tsx` with the SDK `SearchProvider`)
calls `getRecords(tableId, { viewId, search: [value, fieldIds | '' (all fields), hideNotMatchRow] })`
and counts matches with `getSearchCount`. The cockpit runs the same `RecordService` path on the
server (§10.4), with these choices:

- `search = [text, '', true]`: all fields (the page's "global" mode, capped by
  `MAX_SEARCH_FIELD_COUNT` as on the page) and only matching rows.
- Table-wide, with no view (`ignoreViewQuery: true`), in the table's default order **(D3)**.
- `take = 50`, plus `total` from the search count **(D4)**.

### 7.2 Scope: which table is searched

The search runs on **the table on stage**: the `/table` choice, else the table the rotation is on
when the query is submitted **(D2)**. This guarantees the results belong to the chart they light up.
The active query is stored as `{ text, tableId }`. While it is active, the cycle holds `search`.
Changing the table (`/table`, menu, `1`–`9`) re-runs the same text on the new table, because the
query key includes `tableId`. Changing the base clears the query.

### 7.3 Highlight on the chart and the 10 forced records

Overview nodes for records have ids `rec:<recordId>` with `recordId` set, so a result maps to a node
by `recordId`.

- **Highlight.** The results that are on the chart form the `marked` set: a new constellation prop
  that draws a result ring (`.result`, the cyan of `target` in cyberpunk, ink in mono) and always
  shows their labels. When nothing is hovered or pinned, `lit` = `marked`, so the other records dim
  as they do for a trace today (`focusing` class). A hover or pin lights its own trace, and the
  result rings stay visible.
- **Forced set.** `forced: string[]` holds record ids that the chart must draw, newest first,
  `FORCED_MAX = 10`:
  - When results arrive, `forced` = the first 10 results.
  - A click on a result moves it to the front. If that pushes the set over 10, the oldest leaves.
  - Clearing the search empties the set.
- **Getting forced records onto the chart:**
  1. The record was read by the overview but cut by the draw budget. `limitGraph` gets a new `must`
     option: those records, their parent chain and their links are kept first, then the rest of the
     budget is ranked as today. Lower-ranked non-results drop out, which is the "remove some of the
     items not the result" part of the goal. `ILimited.forced` reports how many were forced.
  2. The record was never read (past `OVERVIEW_TABLE_LIMIT` = 1500, or filtered out by a preset's
     `open`/`windowDays` rule). The client asks `POST /api/agent/overview/tables/{tableId}/nodes`
     for the missing ids (at most 10). The server encodes them with the same preset (§10.3), and
     `model/graph/merge.ts` adds them and their parents before `limitGraph`.
- **Readout note.** `RESULTS 12 · 10 ON CHART`, beside `SHOWING n OF m`.

### 7.4 Search Results panel (replaces RECENTLY UPDATED)

`ui/rail/SearchResults.tsx`, in the rail under TYPES on every table:

- Header: `SEARCH RESULTS`, a hint (`12 FOUND · KNOWLEDGES`, `50 OF 312 · KNOWLEDGES`, or
  `SEARCHING…`), and `✕` to clear.
- Rows (buttons, `aria-pressed` for the selected one): a tone dot, using the node's tone when the
  record is on the chart and hollow otherwise; the title (primary field); a snippet with the match
  in `<mark>` (§10.4); the updated time in UTC; and an `OFF CHART` tag when the record is not drawn.
- Hovering a row lights its trace (`setHover('rec:'+id)`), as the TYPES rows do. A click selects it
  (§7.3), pins the node (`overviewPinned`, trace lit, node detail in the HUD), and opens the modal
  (§8).
- Empty states: no query → `TYPE TO SEARCH KNOWLEDGES · /table TO CHANGE`; nothing found →
  `NOTHING MATCHES "x" IN KNOWLEDGES`; error → the reason, with the query kept for a retry.
- When the total is over 50: `SHOWING 50 OF 312 · REFINE THE QUERY`.

---

## 8. Feature 2c: the record modal

### 8.1 Opening

From a result row, or from `OPEN` in the pinned node's detail (`NodeDetail`'s `ASK` becomes `OPEN`;
under **D1** there is no chat to ask). The search store holds `record: { tableId, recordId }`.

`ui/stage/RecordModal.tsx` renders inside the cockpit root (the page beneath is `inert`):
`role="dialog"`, `aria-modal`, labelled by the title. Focus is trapped and returns to the row on
close. `Esc` closes it first (a capture listener, as the enlarged ask panel does). A click on the
backdrop also closes it. Size: `min(860px, 92vw)` × `min(80vh, …)`, scrolling inside.

Layout:

1. Header: `TABLE · title`, `OPEN IN TABLE` (`/base/{baseId}/{tableId}?recordId=…`, which turns the
   cockpit off), and `✕`.
2. **AGENT SUMMARY**, only when `chars > 500`: `SUMMARIZING…` (shimmer), then the text. If the agent
   is not ready: `SUMMARY NEEDS THE AGENT · Admin ▸ Agent`.
3. **RECORD**: the Markdown from the server, rendered with `MessageResponse` (Streamdown, already in
   `components/ai-elements/message.tsx`), styled for the cockpit.

### 8.2 Markdown (server, `domain/cockpit/record-markdown.ts`, pure)

```md
# <primary field value>

`<table>` · updated 2026-10-30 14:02 UTC

| Field | Value |
|---|---|
| Status | In progress |
| Assigned to | Alice, Bob |
| Secret token | •••••• |

## <long text field name>

<its text as is: knowledge entries are already Markdown>
```

- Short values (≤ 120 chars, no newline) go in the table. Long text and rich text fields get a
  section each.
- Bookkeeping fields are left out: autoNumber, created/modified by, buttons (the `recordText` set).
- Attachments list file names only.
- Secret-looking field names (`secretField`) show `••••••`, and the summarizer never sees their values
  **(D8)**.
- `chars` = the length of the record's context text: the title plus every value shown, without the
  Markdown scaffolding. `SUMMARY_MIN_CHARS = 500` lives in `@teable/openapi`, so client and server
  share the threshold.

### 8.3 Summary and voice

- The client calls the summary endpoint only when `chars > SUMMARY_MIN_CHARS` and the agent status
  is `ok`. The server enforces the same threshold (422 otherwise).
- Server (§10.5): it rebuilds the Markdown itself and never takes text from the client. It calls the
  small model (`profile.smallModel || profile.model`, as `TurnJobs` does) through `MODEL_PORT` with
  `generateText`. Prompt: at most 3 sentences and 60 words, plain text for speech, in the record's
  language, no secrets, no Markdown. Input is capped at 12 000 chars. The result is cached 10 min
  by `sha1(markdown)`, so an unchanged record never costs a second call.
- Client cache: the react-query key is `['agent','cockpit','summary', recordId, version]`, where
  `version` is the record's last-modified time from the record endpoint. `staleTime: Infinity`.
- **Voice:** when voice is on and the summary arrives (or is already cached), it is spoken once per
  opening through a new `voice.say(id, text)` (§11.4), with id `summary:<recordId>:<version>`.
  Closing the modal calls `voice.stopSpeech()` and abandons a running summary request. A record of
  500 chars or fewer is not spoken **(D9)**.
- The summary also goes to the log (§6.6).

---

## 9. The table overview (what the stage draws per table)

### 9.1 Endpoint

`GET /api/agent/overview/tables/{tableId}` replaces `GET /api/agent/overview/{dataset}`. It keeps
the guard, the `record|read` check on every call, the 60 s cache per admin and table, and the ETag
without `builtAt`. Shape: §10.2.

### 9.2 Presets

Each table needs a preset (an `IOverviewDataset` from `domain/overview/datasets.ts`), resolved in
this order **(D7)**:

1. **Curated:** the four hand-tuned datasets stay, now keyed by an anchor table:
   `knowledges → knowledge`, `tasks → work`, `contacts → people`, `finance_Transactions → finance`
   (`domain/overview/presets.ts`). That table is drawn exactly as today, together with its other
   tables (types, goals, payees…). The goal requires this for TYPES (§9.3).
2. **Auto:** every other table gets a preset derived from its schema (`domain/overview/auto-preset.ts`,
   pure), using the same resolve and encode code:
   - The table itself is the `item` role, with `orphan` = the table name in capitals and `short` =
     the singular table name in capitals.
   - `hierarchy`: a single-valued self-link (a parent), if there is one.
   - `groupBy`: the first single-valued link to another table, which becomes a `branch` table.
     Without one, the encoder groups by the first single select, preferring names like
     `status|state|stage|type|category`, into synthetic hubs `sel:<fieldId>:<choice>`. This is a
     small addition to `encode.ts`. Without that either, every record hangs off the table hub.
   - `tone`: a status-like select through the shared `toneOf` words, else `fresh` (updated ≤ 7 d,
     ≤ 30 d, older), the knowledge legend.
   - `size`: a select named like `priority|importance`. `money`: a currency or number named like
     `amount|price|total|value|cost`. `date`: `lastModifiedTime`, `updated_at`, then `created_at`.
   - Edges: up to two multi-valued links to other tables, whose tables join as `actor` with
     `prune: true` (drawn only when linked).

### 9.3 Presentation and TYPES

The legend, the vectors panel title, the unit and the tone names move from the client's
`OVERVIEW_ORDER` into the response as `presentation`. A curated preset returns exactly today's
values (`branchTitle: 'TYPES'` for knowledges), and the client still translates them through
`agent.cockpit.rail.branches.<preset>`. TYPES therefore looks and behaves as it does now. An auto
preset returns `branchTitle` = the group field's name in capitals (`STATUS`, `PROJECT`), `unit` =
`RECORDS`, and the tone legend of what it found. `feedTitle` and `verbs` go away with the feed.

---

## 10. Backend

### 10.1 Routes (all `AgentAdminGuard`, prefix `/api`)

| Method · path | Request | Response | Checks |
| --- | --- | --- | --- |
| `GET /agent/cockpit/bases` | — | `{ bases: {id,name,spaceId,spaceName}[], defaultBaseId: string \| null }` | the admin's accessible bases (`BaseService.getAllBaseList`), Agent space and deleted bases left out |
| `GET /agent/cockpit/bases/{baseId}/tables` | — | `{ tables: {id,name}[] }` in table order, system tables left out | `table\|read` on the base |
| `PUT /agent/cockpit/default-base` | `{ baseId }` | `{ defaultBaseId }` | `record\|read` on the base; not in the Agent space |
| `GET /agent/cockpit/tables/{tableId}/search` | `?q=` (1–200 chars) `&take=` (1–50, default 50) | `{ tableId, q, total, results: ISearchResult[] }` | `record\|read` on the table's base |
| `GET /agent/cockpit/tables/{tableId}/records/{recordId}` | — | `{ tableId, tableName, baseId, recordId, title, markdown, chars, version, masked: string[] }` | same |
| `POST /agent/cockpit/tables/{tableId}/records/{recordId}/summary` | — | `{ summary, model, cached }` | same; agent enabled with a model (409 `AGENT_NOT_READY`); `chars > 500` (422) |
| `GET /agent/overview/tables/{tableId}` | — | `IAgentTableOverviewVo` (ETag) | same |
| `POST /agent/overview/tables/{tableId}/nodes` | `{ recordIds: string[1..10] }` | `{ nodes, links }` | same |

```ts
// packages/openapi/src/agent/cockpit.ts (new)
export const SUMMARY_MIN_CHARS = 500;
export const COCKPIT_SEARCH_TAKE = 50;
export const OVERVIEW_FORCED_MAX = 10;
searchResultSchema = z.object({
  recordId: z.string(),
  title: z.string(),
  snippet: z.object({ field: z.string(), text: z.string(), match: z.tuple([z.number(), z.number()]) }).nullable(),
  updatedAt: z.string().nullable(),
});
```

### 10.2 Table overview shape (`packages/openapi/src/agent/overview.ts`, changed)

```ts
agentTableOverviewVoSchema = agentOverviewVoSchema.omit({ dataset: true }).extend({
  tableId: z.string(),
  tableName: z.string(),
  preset: overviewDatasetSchema.nullable(),      // the curated preset used, or null (auto)
  presentation: z.object({
    branchTitle: z.string(),
    unit: z.string(),
    right: z.enum(['pct', 'sum']).optional(),
    toneNames: z.record(searchToneSchema, z.string()),
    legend: z.array(z.tuple([z.string(), z.string()]).rest(z.string())),
  }),
});
```

The old dataset route and its schema are removed in P8, once nothing calls them.

### 10.3 Files

| Layer | File | What |
| --- | --- | --- |
| interface | `agent-cockpit.controller.ts` (new) | the six cockpit routes, Zod pipes, `CustomHttpException` errors |
| interface | `agent-overview.controller.ts` | table route plus nodes route, ETag kept |
| application | `cockpit/list-bases.query.ts`, `list-tables.query.ts`, `set-default-base.command.ts` | scope |
| application | `cockpit/search-table.query.ts` | search (§10.4) |
| application | `cockpit/read-record.query.ts`, `summarize-record.command.ts` | modal (§10.5) |
| application | `overview/get-table-overview.query.ts` (replaces `get-overview.query.ts`), `get-overview-nodes.query.ts` | stage |
| domain | `cockpit/record-markdown.ts`, `cockpit/snippet.ts`, `cockpit/summary-prompt.ts` | pure |
| domain | `overview/presets.ts`, `overview/auto-preset.ts`; `encode.ts` (+ select grouping), `resolve.ts` (+ ids-only query) | pure |
| domain | `ports/cockpit.port.ts` | `ICockpitDataPort { listBases, listTables, search, count, readRecords, fields }` |
| infrastructure | `cockpit/cockpit-data.reader.ts` | `BaseService`, Prisma `tableMeta`, `RecordService.getRecords`, `AggregationService.getSearchCount`, `RecordService.getSnapshotBulkWithPermission`, `PermissionService` |
| shared | `base-graph`: `IBaseGraphTableQuery.recordIds?` (≤ 50) | `GraphRowReader` reads only those ids (`getSnapshotBulkWithPermission`) and ignores `limit` and `filter`. Optional: `/graph` is unchanged when the field is absent. |
| module | `agent.module.ts` | new providers; imports `AggregationModule`, `BaseModule`, `RecordModule` if not already there |

`layers.spec.ts` (backend) keeps passing: interface → application → domain ← infrastructure.

### 10.4 Search details

- `RecordService.getRecords(tableId, { search: [q, '', true], ignoreViewQuery: true, take,
  fieldKeyType: Id, cellFormat: Text, projection: <readable fields> })` and
  `AggregationService.getSearchCount(tableId, { search: [q, '', true], ignoreViewQuery: true })`,
  run in parallel. This is the grid's path, so the matching is the same SQL.
- `title` = the primary field as text. `snippet` (`domain/cockpit/snippet.ts`) = the first readable
  field, in field order, whose text contains `q` case-insensitively, cut to 120 chars around the
  match, with `match` as offsets into `text`. Secret fields are skipped, and `null` when only the
  title matched.
- `updatedAt` = the record's last-modified time.
- Parity test (§14): for the same table and text, the cockpit's ids and order equal those of
  `GET /api/table/{id}/record?search=…&ignoreViewQuery=true`.

### 10.5 Record and summary

- `read-record`: `getSnapshotBulkWithPermission(tableId, [recordId], …, CellFormat.Text)` plus the
  table's fields → `recordMarkdown(fields, record)` → `{ markdown, chars, version, masked }`.
- `summarize-record`: `read-record`, then the threshold check, then the cache lookup, then
  `generateText({ model: smallModel, system: SUMMARY_SYSTEM, prompt: markdown.slice(0, 12_000) })`,
  then the cache write. It runs no tools and keeps no history, so it is a one-shot call. Usage is
  logged as the turn jobs log theirs.
- The cache is an in-memory LRU of 200 entries, 10 min, keyed by `recordId:sha1(markdown)`, as the
  overview's cache is.

### 10.6 Errors

404 for a base or table that is missing, deleted or in the Agent space; 403 without access (the
`PermissionService` message); 400 for a bad `q`, `take` or `recordIds`; 409 `AGENT_NOT_READY`; 422
`RECORD_TOO_SHORT`; 502 when the model call fails, with the provider's message redacted
(`domain/redact.ts`).

---

## 11. Frontend

### 11.1 Folder map (`blocks/agent/`, layers unchanged; `layers.spec.ts` enforces)

| Layer | New | Changed | Deleted |
| --- | --- | --- | --- |
| model | `commands.ts`, `search-results.ts` (rows, forced LRU), `graph/merge.ts`, `overview/presentation.ts` | `graph/limit.ts` (`must`), `overview/cycle.ts` (string ids, holds), `overview/metrics.ts` (auto presets), `panels.ts` (−feed, −search vectors) | `overview/datasets.ts` (→ presentation), `search-board.ts`, `graph/from-board.ts`, `lens.ts`, `metrics.ts`, `transcript.ts`, `skills.ts`, `agent-request.ts` (D1) |
| data | `cockpit-api.ts` (bases, tables, default, search, record, summary, nodes; query keys) | `agent-api.ts` (table overview) | `agent-chat.ts`, `stream-events.ts` (D1) |
| state | `search-store.ts` | `cockpit-store.ts` | `session-store.ts` (D1) |
| hooks | `useScope.ts`, `useTableSearch.ts`, `useRecordModal.ts` | `useOverview.ts` (per table, forced, marked), `useCockpitKeys.ts` | `useStage.ts`, `useSearchBoard.ts`, `useAgentSession.ts` (D1) |
| voice | — | `useVoiceConversation.ts` (`say`, no chat messages) | — |
| ui | `ask/AskLog.tsx`, `ask/CommandList.tsx`, `rail/SearchResults.tsx`, `shell/BaseMenu.tsx`, `shell/TableMenu.tsx`, `stage/RecordModal.tsx`, `theme/modal.module.css` | `ask/Composer.tsx`, `stage/StageDeck.tsx`, `stage/StageHead.tsx` (→ `LayoutKnobs`), `stage/Constellation.tsx` + `constellation-chart.ts` (`marked`), `stage/NodeDetail.tsx` (OPEN), `stage/Readout.tsx` (−search legend, −standby chat text), theme CSS | `stage/SearchBoard.tsx`, `TableLane.tsx`, `RecordCard.tsx`, `ask/Suggestions.tsx`, `Transcript.tsx`, `PlanLegs.tsx`, `ToolStep.tsx`, `ApprovalCard.tsx`, `ClarifyCard.tsx`, `shell/ThreadMenu.tsx`, `shell/DatasetMenu.tsx` |
| containers | — | `AgentCockpit.tsx`, `AskContainer.tsx`, `AnnunciatorContainer.tsx`, `OverviewStage.tsx` (results panel, modal); `StageContainer.tsx` becomes a thin wrapper of `OverviewStage` and may be folded into it | — |

Files stay under 500 lines. `cockpit.module.css` (≈810 lines) loses the board and transcript
rules, which brings it under that.

### 11.2 State

```ts
// state/search-store.ts (new): scope, search, selection, modal, log
interface ISearchState {
  baseId?: string;                  // current base; undefined → default base
  tableId?: string;                 // /table or menu pick; undefined → the rotation's table
  query?: { text: string; tableId: string; nonce: number };   // nonce: Enter on the same text refetches
  forced: string[];                 // record ids drawn for sure, ≤ 10, newest first
  selected?: string;                // the result clicked
  record?: { tableId: string; recordId: string };             // the modal
  log: IAskLogEntry[];              // ≤ 50
  setBase(id: string): void;        // clears table, query, forced, selected, record
  setTable(id?: string): void;
  search(text: string, tableId: string): void;                 // forced reset happens when results land
  clearSearch(): void;
  setForced(ids: string[]): void;
  select(recordId: string): void;   // moves it to the front of forced (LRU, cap 10), selected, record
  closeRecord(): void;
  addLog(entry: Omit<IAskLogEntry, 'id' | 't'>): void;
  clearLog(): void;
}
// persisted per browser: { baseId, tableId } only
```

`cockpit-store.ts` keeps `on`, `palette`, `layout`, `zoomResets`, `cycle`, `overviewPinned`,
`overviewFailed` (keyed by table id), and `open/close/toggle`. It drops `focus`, `view`,
`selectedSearch`, `lens`, `pinned`, `stage` and `draft`, and the session subscription.
`openAgentCockpit({ focus })` from the grid maps `focus.baseId` and `focus.tableId` to the scope:
`setBase`, then `setTable` **(D12)**.

### 11.3 Hooks and data flow

- `useScope()`: queries `bases` (staleTime 60 s) and the `tables` of the current base. It resolves
  `baseId = store.baseId if listed, else defaultBaseId, else the first base`, and drops a persisted
  `tableId` that is no longer listed. It exposes `setDefault` (a mutation that invalidates `bases`
  and logs).
- `useOverview(active)`: `tableId = currentTable(cycle)`, and the query
  `['agent','overview','table', tableId]` (the 60 s rules and prefetch as today). It computes the
  forced ids missing from `vo.nodes` and, if there are any, the nodes query
  `['agent','overview','nodes', tableId, ids]`. Then `merge` → `limitGraph({ must })`. `marked` =
  the results on the chart, and `lit` = the trace, else `marked`. The `available` order = the base's
  tables minus the failed ones.
- `useTableSearch()`: the query `['agent','cockpit','search', tableId, text, nonce]` (enabled while
  `query` is set; staleTime 30 s; `signal`). When results land: `setForced(first 10)`, log the count.
  It holds `search` while `query` is set.
- `useRecordModal()`: the record query, then (if `chars > 500` and the agent is ready) the summary
  query, then `voice.say` once per opening.

Sequence for a click on a result:

```text
SearchResults.onSelect(id)
  → searchStore.select(id)                     forced = [id, ...forced − id].slice(0, 10); record = {tableId, id}
  → cockpitStore.pinOverview('rec:'+id)        trace lit, NodeDetail, cycle hold 'pin'
  → useOverview: id missing from vo? → POST …/nodes → merge → limitGraph({ must: forced }) → chart redraws
  → RecordModal: GET …/records/{id} → chars > 500 && agent ok? → POST …/summary → show → voice on? say()
```

### 11.4 Voice

`useVoiceConversation` stops reading `UIMessage`s (there are none, **D1**). It keeps listening,
which submits through the composer's parser, and the engines and queue. It gains
`say(id: string, text: string)`, which builds segments with the speech script's prose splitter and
calls `queue.enqueue(id, segments)`. `busy` = a summary is loading, so the mic pauses while the
agent talks, as it does now. `stopSpeech` is unchanged. `locked` no longer applies, because no reply
streams.

---

## 12. Edge cases

- **The current base is deleted or the access is revoked:** fall back to the default (§5.2) and log
  `BASE data-centre (was <name>, gone)`.
- **A base with no drawable tables:** the stage shows `NOTHING TO SHOW` with each table's reason, as
  it does for datasets today. Search still works on a picked table.
- **A table with a single record, or a hub only:** drawn as is, and the rotation still gives it its
  minute.
- **The query changes while the table rotates:** impossible by construction. `typing` holds the
  cycle while the text is unsent, and `search` holds it while the query is active.
- **A result from a record later deleted:** the record endpoint returns 404, the modal says
  `RECORD GONE`, and the row is removed on the next search.
- **The agent is not enabled or not `ok`:** stage, commands, search and modal work, and only the
  summary is unavailable. The old `StandbyStage` block, which hid the stage, goes away, because
  nothing on the stage needs the model now.
- **Long names in the menus:** truncated with a `title`. **Names that differ only by case:**
  autocomplete shows both, and `Enter` needs a pick.
- **Narrow screens (< 900 px):** the chart draws without labels (today's rule), the results keep
  their own labels in the panel, and the modal is full width.
- **Secrets:** masked in snippets, Markdown, summary input and voice (D8).

## 13. What the chat leaves behind (D1)

The goal turns plain input into a search, removes every command but `/base` and `/table`, and
replaces THREAD with BASE. Nothing in the cockpit can then start or show a conversation. The design
therefore removes the cockpit's chat path, **frontend only, in its own phase (P8)**, so it can be
reverted on its own: the session store, the chat transport, the transcript and its cards, the
search board model, the plan and lens stage, the thread menu and the thread deep link. The backend
chat, threads, `investigate` toolkit and `agent_search` table are **not touched**. Other clients
(MCP, Admin ▸ Agent) keep using them. If D1 is rejected, the chat stays behind a `/ask` command
instead, and P8 shrinks to removing the board-only parts.

## 14. Testing

- **Model (vitest):**
  - `commands.spec`: the `/base dat` case from the goal; exact vs partial matches; word fallback;
    names with spaces; unknown commands; leading-space queries.
  - `search-results.spec`: forced LRU, cap 10, the reset on new results.
  - `limit.spec`: `must` keeps forced records under budget and drops the lowest non-results.
  - `merge.spec`.
  - `cycle.spec`: string ids, `search`/`typing` holds, `pick` on a table, `available` on a base
    change.
- **UI:**
  - Composer: the list opens on `/`, filters, Tab completes, Enter applies; the idle search fires
    once after 3000 ms with fake timers, not for commands, empty text, an unchanged query or during
    IME composition; Enter cancels the timer.
  - Results: rows, OFF CHART, click selects and opens.
  - Modal: summary only when over 500 chars, `say` called only with voice on, Esc order.
  - BaseMenu: ★ states. LayoutKnobs: rendered in the left HUD and stacked.
- **Containers:** `cockpit.spec` rewritten for the new rail, with no board, no thread and no
  suggestions. `layers.spec` passes.
- **Backend:**
  - `auto-preset.spec` on the data-centre fixture (every table gets a preset, curated anchors map)
    and on a minimal demo fixture.
  - `record-markdown.spec` (masking, sections, `chars`), `snippet.spec`.
  - Controller e2e: guard, 403/404, search parity with the record list route (same ids, same
    order), summary with a fake `MODEL_PORT` (threshold, cache hit, 409).
  - The base graph `recordIds` path.
- **Manual (P9, with the user):** the dev server's three bases, `/base dat`, `/table` on
  data-centre, idle and Enter searches, a forced off-chart result, a long knowledge entry spoken in
  Chrome, the ★ default surviving a reload, and the 1440/1024/390 px layouts.

`pnpm -F nextjs-app exec tsc --noEmit`, `pnpm -F @teable/backend exec tsc --noEmit`, lint (re-run
tsc after `eslint --fix`), and the vitest suites of both apps run before every commit.

## 15. Decisions (defaults used above)

| # | Decision | Default | Alternative |
| --- | --- | --- | --- |
| D1 | The cockpit stops being a chat (§13) | Yes. Frontend chat path removed in P8; backend untouched | Keep the chat behind `/ask <question>` |
| D2 | Which table a query searches | The table on stage (`/table`, else the rotation's), held while active | Every table of the base, fanned out, results grouped by table |
| D3 | Search scope inside the table | Table-wide (no view), all fields | The table's first view (its filter and sort), as the grid shows it |
| D4 | How many results | List 50 with the total; chart forces the top 10 plus the clicked ones (LRU 10) | List capped at 10 |
| D5 | Where the default base lives | `agent_setup.data_base_id`, shared with the agent's searches | A per-admin preference that leaves the agent alone |
| D6 | Which base rotates | The current base (it starts at the default) | Only the default base rotates; another base stays on its picked table |
| D7 | Curated datasets | Kept as presets of their anchor tables (TYPES identical); auto preset elsewhere | Auto preset for every table |
| D8 | Secret-looking fields | Masked in the modal, snippets and summary | Shown raw in the modal (masked only for the summary) |
| D9 | Records of 500 chars or fewer with voice on | Nothing spoken | Read the title |
| D10 | Autocomplete matching | Full-name prefix; word-prefix only when nothing has the prefix | Fuzzy match |
| D11 | Input after a query | Kept, for refining; commands clear | Cleared like a chat |
| D12 | Grid's "ask the agent" entry | Opens the cockpit on that base and table | Also list the selected rows as results |

## 16. Phases (one commit each, not pushed)

| P | Scope | Done when |
| --- | --- | --- |
| P0 | Contracts: `agent/cockpit.ts`, the table overview schemas, shared constants; base graph `recordIds` | openapi builds; base-graph tests pass |
| P1 | Backend scope: bases, tables, default base | controller e2e green |
| P2 | Backend table overview: presets, auto preset, select grouping, nodes route | `auto-preset.spec` and the overview e2e green on the data-centre fixture |
| P3 | Backend search, record Markdown, summary | parity test, `record-markdown.spec`, summary e2e green |
| P4 | F1: `LayoutKnobs` stacked in the left HUD; board, views and their keys removed | cockpit renders with no board; `cockpit.spec` updated |
| P5 | F3: search store scope, BaseMenu with ★, TableMenu, the per-table cycle on the new endpoint | the rotation runs on the dev bases; `cycle.spec` green |
| P6 | F2: composer commands and autocomplete, idle and Enter queries, log, Search Results, `marked`, forced, merge | model and UI specs green |
| P7 | Record modal, summary, `voice.say` | modal spec green |
| P8 | Prune the chat path (D1), dead i18n keys, the old dataset route; as-built notes here | tsc, lint and every spec green; no unused exports in the folder |
| P9 | Manual run with the user (§14) | the user signs off |
