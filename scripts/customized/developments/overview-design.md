# Agent cockpit: the overview constellation (the default stage)

Status: **designed 2026-10-30, waiting for the admin's decisions (§13).** Branch `feat/agent-cockpit`,
on top of the review fixes of 2026-10-30 (uncommitted at the time of writing). Paths are relative to
`apps/nextjs-app/src/features/app/blocks/agent/` (frontend) or `apps/nestjs-backend/src/features/`
(backend) unless they start with `apps/` or `packages/`. The reference is
`/home/avarile/Documents/agentic-centre/ai-cockpit/` ("the cockpit"). It is written to this file, not
`current-design.md`, because that file holds the cockpit analysis the admin saved there at 12:03.

---

## 1. Summary

Today the stage shows a line of STANDBY text until a search runs. Instead, it becomes a living picture
of the data: the **overview**, a constellation of one dataset at a time. The datasets are WORK,
KNOWLEDGE, PEOPLE and FINANCE, each on screen for **60 seconds**, in a loop. When the agent searches,
the search takes the stage as it does today; NEW or the OVERVIEW knob brings the overview back.

| Part | What changes | § |
|---|---|---|
| A. Stage modes | The stage is in `overview` or `search` mode; overview is the default | 4 |
| B. Datasets | Four groups of tables, defined by name like the cockpit's presets | 5 |
| C. Cycle | 60 s per dataset, holds while the admin is looking, progress shown, next one prefetched | 6 |
| D. Interaction | Hover trace, pin, `1`–`4`, `[` `]`, `T`, `0`, open a record, ask about it | 7 |
| E. Data path | A new admin endpoint in the agent module that composes the existing base graph with field values and the cockpit's tone rules | 8 |
| F. Frontend | All in `blocks/agent/`, in its layers; the existing `Constellation` draws it | 9 |

---

## 2. Current state

### 2.1 The stage

- `StageContainer` renders `StandbyStage` (text, or the setup link) when no board has a plan. With a
  search it shows the readout, the knobs `BOARD │ CONSTELLATION [TREE] · ANSWER n │ RETRIEVED n`, the
  board or the constellation, the run log and the legend.
- `Constellation` (`ui/stage/Constellation.tsx`) draws any `IGraph` (`model/graph/types.ts`): radial
  cluster or tree (`model/graph/layout.ts`), bundled edges, people as diamonds, halos, labels, zoom and
  pan, slow rotation, a hover and pin trace. `limitGraph` keeps it under 900 nodes plus links.
- Rotation advances an angle 8 times a second and **re-runs the whole d3 layout each time**
  (`layoutGraph(..., rotation)`). That's tolerable while a search is on screen; an always-on view
  would pay it for as long as the cockpit is open (§9.5).
- `cockpit-store` holds `view` (board, constellation), `layout` (bundle, tree), `zoomResets`, `lens`,
  `pinned` (a card key) and `selectedSearch`. Keys: `V`, `T`, `0`, `[` `]`, `Esc`, `/`, `F`.

### 2.2 The base graph already exists

The app has a schema-driven graph engine, used by `/base/:baseId/graph` and by the MCP `get_graph`
tool (which is what the cockpit itself calls):

- `POST /api/base/:baseId/graph/query` (`base-graph/base-graph.controller.ts`, `record|read` on the
  base). Per table: `tableId`, optional `viewId`, `filter`, `limit`, `hierarchyFieldId` (a
  single-valued self-link: draws the table as a tree) and `groupByFieldId` (a single-valued link:
  buckets root records). Plus `linkFieldIds` (edges), `showTableHubs`, `showBaseHub`, `maxNodes`,
  `maxLinks`.
- It answers `{ version: 4, etag, nodes, links, stats }`. Nodes are `base`, `tbl:<id>`,
  `grp:<field>:<record|__none__>` or `rec:<recordId>`, each with one structural `parentId`. Links are
  `hub`, `group`, `hierarchy` (structural) or `link` (a link field, with `fieldId`).
- **Groups:** when the group's target table is in the graph, a record hangs under that record's own
  node (`assembler/structure.ts:81`). Otherwise it hangs under a synthetic group node, and empty cells
  go to `grp:…:__none__`. So `goal → project → task` and `type → contact → task` are both one query.
- The rows are one SQL read per table through `RecordService.getRecordsFields` with a projection, as
  the requesting user (`graph-row.reader.ts`). An ETag computed before the read (one aggregate per
  table) answers 304 when nothing changed. Limits come from config: 5,000 nodes, 15,000 links, 1,000
  per table by default, cache TTL 60 s.
- `blocks/base-graph/presets.ts` already names the same groups: `knowledge`, `work` (goals, projects,
  tasks, project_frameworks), `people` (contacts, companies, contact_type, contact_profession),
  `finance` (six tables) and `all`.
- **What it does not return: field values.** The graph has structure and labels, but no status,
  priority, date or amount, so it can't colour or size anything the way the cockpit does.

### 2.3 What the cockpit does (the reference)

`src/data.ts` and `src/main.ts` of the cockpit:

- **Presets by table name**, resolved against the live schema. Each table has a role (`branch` hub,
  `item`, `actor` diamond), a `parent` link or `hierarchy`/`groupBy`, a tone field (a status select,
  a `fresh` tone from the last update, or a `toneMap` such as Income → target), a priority or amount
  for size, date fields, a `dueAlert`, an `orphan` label for records without a parent, `prune`
  (an actor is drawn only when linked to a drawn item) and a time `window` (finance: 90 days).
- Structure comes from `get_graph`; values from `query_records` with a projection, merged by record
  id. Up to seven KPIs per dataset (`summarize`), computed **from the full graph**: only the chart
  sees the reduced one. A dataset is refetched every 3 minutes and cached 60 s.
- Datasets are switched from a menu or with `1`–`4`. They do not cycle on their own: the timed loop
  is new here.

### 2.4 The data

`data-centre` (`bseJEuE54y5caWO0Xc8`), read on 2026-10-30 from the disposable copy of the K3s
database (`cybernetics_k3s` in `agent-e2e-pg`):

| Table | Records | What matters here |
|---|---|---|
| `goals` | 3 | `deadline`; `projects` (one→many), `refer_knowledge` |
| `projects` | 6 | `progress` (backlog, preparing, initiated, in-progress, finished-reviewing/-validating/-testing, finalized, onhold, cancelled); `belong_goals`, `lead_by` → contacts, `tasks`, `refer_knowledge` |
| `tasks` | 73 | `progress` (backlog, in-progress, finished_reviewing, finished_validating, onhold, cancelled, closed), `priority` (urgent … can wait), `started_at`, `finished_at`; `belong_project`, `assigned_to` → contacts, `refer_knowledge` |
| `contacts` | 6 | `contact_type`, `contact_profession`, `contact_company` (all many→one); back-links `tasks`, `projects` |
| `contact_type` | 6 | title only |
| `contact_profession` | 64 | title only: far more professions than people |
| `companies` | 0 | empty today |
| `knowledges` | 151 | `knowledge_type` (many→one), `knowledge_parent` (self, many→one), `related_knowledge` (many↔many) |
| `knowledge_type` | 56 | `parent_type` (self tree); **`credentials`** text field: must never be read |
| `finance_Transactions` | 1,102 | `Date`, `Type` (Income, Expense, Transfer), `Amount`, `Category`, `Payee`, `Account`, `Transfer Account`, `Tags`, `Budget`, `Receipt` (attachment) |
| `finance_Categories` | 24 | `Type`, `Parent Category` (self tree) |
| `finance_Payees` | 127 | `Type`, `Default Category` |
| `finance_Accounts` | 2 | `Type`, balances (formulas) |
| `finance_Tags`, `finance_Budgets` | 3, 0 | small or empty |
| `project_frameworks` | 4 | a `type` select, **no links** to anything |

Every table also has `title` (primary), `context`, `created_at`, `updated_at`, `deleted_at`,
`is_active`. Except for finance, the data is small: every dataset fits the 900-element budget today.

---

## 3. Goals and non-goals

Goals:

1. When there is nothing searched to show, the stage shows the data itself: one dataset at a time, as
   a constellation, 60 s each, in a loop.
2. Each dataset reads as a picture of one area: its tables in their natural tree, people and other
   satellites as diamonds, links as bundled edges, meaning by tone, and a readout of its numbers.
3. It never fights the admin: it holds while they look or point, says what comes next, and hands the
   stage to a search the moment one starts.
4. One encoding: a record's tone means the same on the overview, on a search card and in the
   search constellation.
5. It stays inside the cockpit's layers and the agent folder, and reuses the base graph instead of
   writing a second graph reader.

Non-goals: editing records from the overview; datasets the admin defines themselves (the cockpit's
CUSTOM; maybe later); live push updates (a dataset refreshes when it comes round again); any change to
the `/graph` page's behaviour; non-admin access.

---

## 4. Part A: the stage has two modes

### 4.1 Overview or search

| When | Stage |
|---|---|
| The cockpit opens on a new conversation, or on a thread with no searches | overview |
| A search starts in this session (its plan arrives) | search (the board, or the constellation if that is the view) |
| The admin clicks a plan's legs in the transcript | search, that search |
| The admin opens a thread that has searches | search, the latest |
| NEW, `/clear`, `Mod+Shift+O` | overview |
| The admin clicks OVERVIEW | overview, until a new search starts or they pick a search |

The mode lives in `cockpit-store` as `stage: 'overview' | 'search'`, next to `view`. `selectSearch`
already resets lens and pin; it also sets `stage: 'search'` when given an id. NEW sets `overview`.

### 4.2 The stage in overview mode

```text
┌ STAGE ─────────────────────────────────────────────────────────────────────────────────────┐
│ OVERVIEW · WORK                     [ OVERVIEW │ BOARD │ CONSTELLATION ] [TREE]             │
│ GOAL → PROJECT → TASK · EDGES = PEOPLE, REFERENCES      ① WORK ② KNOWLEDGE ③ PEOPLE ④ FINANCE ⏸ │
│ 3 GOALS · 6 PROJECTS · 73 TASKS · 12 IN PROGRESS …       ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔──────  NEXT KNOWLEDGE · 0:21 │
│                                                                                            │
│                         (the dataset's constellation, turning slowly)                      │
│                                                                                            │
│ legend of this dataset                                         UPDATED 04:12Z · 112 RECORDS │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Knobs**: `OVERVIEW` joins `BOARD │ CONSTELLATION`. BOARD and CONSTELLATION are disabled while the
  conversation has no search. TREE works in both constellations. The lens knobs show only in search
  mode.
- **Dataset chips** `1 WORK · 2 KNOWLEDGE · 3 PEOPLE · 4 FINANCE`: the current one is pressed, and a
  dataset that can't be shown (missing tables, no access) is disabled with the reason as its title.
- **Progress**: a 2 px line under the chips fills over the minute, plus `NEXT <DATASET> · 0:21`. Held,
  it stops and reads `HELD · <reason>`; the ⏸ button becomes ▶.
- **Readout** (top left, as in search mode): `OVERVIEW · <DATASET>`, the path line, up to seven KPIs
  (§5.2), and notes (`NOT IN THIS BASE: …`, `SHOWING 640 OF 900`, `STALE · <error>`).
- **Foot**: the dataset's legend; at the right, when it was read and how many records it shows.
- No run log in overview mode.

---

## 5. Part B: datasets

### 5.1 The dataset model

A dataset is code (`domain/overview/datasets.ts`, server side), by table and field **names**, ported
from the cockpit's `Preset`/`TableDef`, and resolved against the live schema on each read. Recipes
for searches already work this way (`domain/search/recipes.ts`).

```ts
type IOverviewRole = 'branch' | 'item' | 'actor';
interface IOverviewTable {
  name: string;                  // table name in the data base
  role: IOverviewRole;           // branch = hub, item = dot, actor = diamond
  /** How a record finds its parent: a self tree, and/or a link to another table in the dataset. */
  hierarchy?: string;            // single-valued self-link (base graph hierarchyFieldId)
  groupBy?: string;              // single-valued link (base graph groupByFieldId)
  tone?: string | 'fresh';       // status-like select, or freshness from the update date
  toneMap?: Record<string, ISearchTone>;
  size?: string;                 // priority select or amount
  money?: string;                // amount shown on the node and summed in the readout
  date?: string[];               // first present wins: recency, deadline
  dueAlert?: boolean;            // halo when the date passed and the record is not settled
  open?: boolean;                // only records whose state is not settled or cancelled
  windowDays?: number;           // only records whose date is within the window
  orphan: string;                // label of the hub for records with no parent (or of the actors)
  short: string;                 // key prefix on nodes: TASK · #42
  prune?: boolean;               // drawn only when linked to a drawn record
}
interface IOverviewDataset {
  id: 'work' | 'knowledge' | 'people' | 'finance';
  title: string; path: string;
  tables: IOverviewTable[];
  edges: string[];               // link field names drawn as edges (any table of the dataset)
  legend: [mark: string, label: string][];
}
```

Rules shared by every dataset:

- **Archived records are left out**: `deleted_at` set or `is_active` not true (the rule of
  `card-projection.isArchived`). `deleted_at isEmpty` goes into the base-graph filter;
  `is_active` is checked on the values.
- **Secret fields are never requested**: the `secretField` rule of `domain/search/schema.ts` (credential,
  password, secret, token, api key, private key) and attachments are excluded **before** the value
  projection is built, so `knowledge_type.credentials` never leaves the database.
- **Empty hubs are dropped**: a branch record or group with no drawn record under it isn't drawn
  (no empty spokes: 56 knowledge types and 24 categories would otherwise crowd the rim).
- **Tone**: a status select goes through `toneOf` (`domain/search/tone.ts`, the same function the
  search cards use); `fresh` is ≤ 7 days route, ≤ 30 days target, older ink (the cockpit's); a
  `toneMap` maps select values directly.
- **Open-only filters** are computed from the select's choices: the values whose `toneOf` is `ink`
  (settled) or `faint` (cancelled) go into an `isNoneOf` filter. A renamed state never needs a code
  change.

### 5.2 The four datasets

**WORK** (`GOAL → PROJECT → TASK · EDGES = PEOPLE, REFERENCES`)

| Table | Role | Parent | Tone | Size | Date | Notes |
|---|---|---|---|---|---|---|
| `goals` | branch | — | none; done when all its projects are settled | — | `deadline` (alert) | |
| `projects` | item | groupBy `belong_goals` | `progress` | — | `updated_at` | orphan: PROJECTS · NO GOAL |
| `tasks` | item | groupBy `belong_project` | `progress` | `priority` | `finished_at`, `started_at`, `updated_at` | orphan: TASKS · NO PROJECT |
| `contacts` | actor, prune | — | — | — | — | hub: PEOPLE |
| `knowledges` | actor, prune | — | `fresh` | — | `updated_at` | hub: REFERENCES; only entries the work refers to |

Edges: `assigned_to`, `lead_by`, `refer_knowledge`. About 3 + 6 + 73 + 6 people + referenced entries
(≈ 120 nodes, < 400 elements: it turns). KPIs: GOALS · PROJECTS · TASKS · IN PROGRESS · BACKLOG ·
ON HOLD (`n LATE`) · DONE %. The goal rule fixes the earlier finding that a goal with a past deadline
always gets a halo: it doesn't when every project under it is finalized or cancelled.

**KNOWLEDGE** (`TYPE → ENTRY → SUB-ENTRY · EDGES = RELATED`)

| Table | Role | Parent | Tone | Date | Notes |
|---|---|---|---|---|---|
| `knowledge_type` | branch | hierarchy `parent_type` | none | — | the `credentials` field is never read |
| `knowledges` | item | hierarchy `knowledge_parent`, groupBy `knowledge_type` | `fresh` | `updated_at`, `created_at` | orphan: UNTYPED |

Edges: `related_knowledge`. About 151 entries under the types that have them. KPIs: ENTRIES · TYPES ·
UPDATED 7D · UPDATED 30D · OLDER · RELATED LINKS · UNTYPED.

**PEOPLE** (`TYPE → PERSON → THEIR WORK · EDGES = PROFESSION, COMPANY`)

| Table | Role | Parent | Tone | Notes |
|---|---|---|---|---|
| `contact_type` | branch | — | none | |
| `contacts` | item | groupBy `contact_type` | from their open work: route if any task in progress, else caution if any on hold, else target, else none | orphan: NO TYPE |
| `projects` | item, open | groupBy `lead_by` | `progress` | only projects they lead |
| `tasks` | item, open | groupBy `assigned_to` | `progress`, size `priority` | only open tasks |
| `contact_profession` | actor, prune | — | — | hub: PROFESSIONS; only the professions people have (≤ 6 of 64) |
| `companies` | actor, prune | — | — | hub: COMPANIES; empty today |

Edges: `contact_profession`, `contact_company`, `belong_project` (a task to its project, when both are
drawn). KPIs: PEOPLE · TYPES · PROFESSIONS · COMPANIES · PROJECTS LED · OPEN TASKS · UNASSIGNED OPEN
TASKS (counted, not drawn).

**FINANCE** (`CATEGORY → TRANSACTION · LAST 90 DAYS · EDGES = PAYEE, ACCOUNT`)

| Table | Role | Parent | Tone | Size | Date | Notes |
|---|---|---|---|---|---|---|
| `finance_Categories` | branch | hierarchy `Parent Category` | none | — | — | |
| `finance_Transactions` | item, window 90 d | groupBy `Category` | `Type`: Expense route, Income target, Transfer dim | `Amount` (log) | `Date` | orphan: UNCATEGORISED; amount signed by type |
| `finance_Payees` | actor, prune | — | — | — | — | hub: PAYEES |
| `finance_Accounts` | actor, prune | — | — | — | — | hub: ACCOUNTS |

Edges: `Payee`, `Account`, `Transfer Account`. KPIs: TRANSACTIONS 90D · SPENT · INCOME · NET ·
TRANSFERS · PAYEES · CATEGORIES. With two edges per transaction this one is likely over 400 elements:
it holds still (the existing motion rule) and the budget folds the smallest, oldest transactions
first.

### 5.3 Left out, and why

- `project_frameworks`: four records and no links: a ring of four dots says nothing. It can join
  KNOWLEDGE later as a branch if it gets links.
- `finance_Tags` and `finance_Budgets`: three tags and no budgets today. Tags can become a pruned
  actor table of FINANCE with one line in the dataset once they're used.
- System tables (`system_info`, `system_status`, `auditlog`, `table_references`, `template_table`)
  and the Agent space: never, as for searches.

---

## 6. Part C: the cycle

### 6.1 Timing

- Order WORK → KNOWLEDGE → PEOPLE → FINANCE → WORK. 60 s each, so a loop is 4 minutes, the same as
  one turn of the rotation: each dataset turns a quarter while it's on screen.
- Datasets that can't be shown are skipped. With none left, the stage falls back to STANDBY with the
  reason (no data base, no access, tables missing).
- The minute starts when the dataset is **drawn**, not when it was asked for, so a slow read never
  eats its time.
- 10 s before the switch, the next dataset is prefetched, so the switch is immediate.

### 6.2 Holds

The cycle holds, and the progress line stops, while:

| Hold | Ends |
|---|---|
| The pointer is over the chart | it leaves the chart |
| A node is pinned | the pin is cleared (click it again, or `Esc`) |
| The admin picked a dataset (chip or `1`–`4`) | ▶, or `Esc` with nothing pinned |
| ⏸ was pressed | ▶ |
| The browser tab is hidden | it is visible again |
| The cockpit is off | it turns on: the same dataset, with a fresh minute |

The remaining time is kept through a hold, so a pause never skips a dataset. A hold is shown as its
reason (`HELD · POINTER`, `HELD · PINNED`, `HELD · PICKED`, `PAUSED`).

### 6.3 The switch

A cross-fade of 400 ms. The zoom resets to the whole chart (`zoomResets`), the overview pin and hover
clear, the layout mode (bundle or tree) stays, and the rotation goes on from where it was. Under
reduced motion, there is no fade, no progress animation (the countdown text stays), and no rotation.

### 6.4 State

The cycle is a pure reducer (`model/overview/cycle.ts`), so the timing rules are tested without
timers:

```ts
interface ICycle {
  order: IOverviewDatasetId[];   // the showable ones, in order
  index: number;
  /** ms left in the current dataset; counts down only while nothing holds. */
  remaining: number;
  holds: Set<'pointer' | 'pin' | 'picked' | 'paused' | 'hidden'>;
}
type ICycleEvent =
  | { type: 'tick'; elapsed: number }      // from one setTimeout per change, not per second
  | { type: 'drawn' }                      // the dataset is on screen: the minute starts
  | { type: 'hold' | 'release'; reason: ... }
  | { type: 'pick'; index: number }        // also adds the 'picked' hold
  | { type: 'available'; order: ... };     // a dataset became showable or not
```

`useOverviewCycle` (hooks) owns one `setTimeout` for the remaining time, the `visibilitychange`
listener and the prefetch timer. The progress line is a CSS animation of 60 s whose
`animation-play-state` follows the holds, so the minute costs no React renders. The countdown text
updates once a second.

---

## 7. Part D: interaction

- **Hover** a node: tooltip (key, label, state, up to four fields), and the trace lights the node,
  its parent chain to the branch, its children, and the nodes its edges reach (a person lights every
  task they are on). The rest dims. Computed from the graph (`model/graph/trace.ts`), since the
  overview has no board cards.
- **Click**: pins the trace and shows a detail strip under the readout: table, title, state, fields,
  `OPEN ↗` (the record in its table; the cockpit turns off, as cards do), and `ASK`.
- **ASK** sets the focus hint to that record (`{ baseId, tableId, recordIds: [id] }`). The
  annunciator shows the chip as it does for "add to chat" (`FOCUS · KNOWLEDGES · 1 ROW`), the
  composer takes focus with `Tell me about <title>` selected, and the admin sends or edits. No API
  change: the focus hint exists.
- **Keys** (new or changed for the overview; they do nothing while typing, as now):

| Key | Overview | Search mode |
|---|---|---|
| `1`–`4` | pick that dataset (holds) | — |
| `[` `]` | previous / next actor, pinned | lanes (board) or actors (constellation) |
| `T`, `0` | bundle ↔ tree, reset zoom | same, in the constellation |
| `V` | OVERVIEW → BOARD → CONSTELLATION when a search exists | board ↔ constellation |
| `Esc` | unpin, else resume the cycle | unpin, else lens to RETRIEVED |
| `P` | ⏸ / ▶ | — |

- **Pins**: the overview has its own `overviewPinned` (a node id). A board pin is a card key, and
  mixing the two would light the wrong things after a mode switch. `Constellation` sets
  `data-key={cardKey ?? id}` on actor nodes, and `[` `]` pins into the slot of the current mode.

---

## 8. Part E: the data path (server)

### 8.1 Where the graph is composed

| | Server composes (recommended) | Browser composes |
|---|---|---|
| Structure | `BaseGraphService.query` inside the agent module | `POST /api/base/:id/graph/query` from the browser |
| Values | the same read (§8.2) | one more `getRecords` per table, paged, merged by id |
| Tone, size, alert, secrets | `domain/search` rules, already on the server | copied into the browser (a second `toneOf` to keep in step) |
| Payload | only what is drawn: label, tone, size, a few meta lines | every value of every record read |
| Presets resolved | once per read, on the server | in the browser from `getBaseGraphSchema` |
| Permissions | admin guard + `record|read` on the base, reads as the admin | the base-graph route's own guard |

Server composition keeps one set of encoding rules for searches and the overview, and the browser
stays a renderer. It costs a new endpoint and a small, optional extension of the base graph (§8.2).

### 8.2 Values from the base graph (additive)

- `baseGraphTableQuerySchema` gets `valueFieldIds?: string[]` (at most 8 per table). The resolver
  checks that each field belongs to the table and isn't an attachment. The reader adds them to the
  projection it already makes. `IGraphRow` gets `values`, and record nodes get an optional
  `values: Record<fieldId, unknown>`.
- The ETag fingerprint includes `valueFieldIds`, so a query with values never answers 304 for one
  without.
- `BASE_GRAPH_VERSION` stays 4: the field is optional, and `/graph` and `get_graph` don't send it, so
  nothing changes for them. The `/graph` page can use it later to colour by status.
- The fallback, if the base-graph change is refused (D12), is a second projected read per table with
  the same filter and limit, merged by record id.

### 8.3 Endpoint

`GET /api/agent/overview/:dataset` → `IAgentOverviewVo`, in `interface/agent-overview.controller.ts`
behind `AgentAdminGuard`, with `ETag` / `If-None-Match` → 304.

```ts
// packages/openapi/src/agent/overview.ts
export const overviewDatasetSchema = z.enum(['work', 'knowledge', 'people', 'finance']);

interface IOverviewNode {
  id: string;                    // base-graph id (rec:…, grp:…) or hub:<tableId> for orphan/actor hubs
  kind: 'item' | 'hub' | 'actor';
  label: string;
  short: string | null;          // "TASK · #42"
  parent: string | null;
  tone: ISearchTone;
  state?: string;                // the select value the tone came from
  alert?: boolean;
  size?: number;                 // 0–4
  date?: string;                 // ISO, the date the readout and the budget use
  amount?: number;               // signed (finance)
  recordId?: string;
  tableId?: string;
  table?: string;
  meta?: [string, string][];     // up to four tooltip lines
}
interface IAgentOverviewVo {
  dataset: IOverviewDatasetId;
  title: string;
  path: string;
  baseId: string;
  nodes: IOverviewNode[];
  links: { id: string; source: string; target: string; tone: ISearchTone; label: string }[];
  /** Records read per table, and the counts the readout needs but the chart does not draw. */
  counts: Record<string, number>;
  missing: string[];             // tables or fields of the dataset not in the base
  truncated: boolean;            // a table hit its limit
  builtAt: string;
}
```

### 8.4 Composition (`application/overview/get-overview.query.ts`)

1. **Base**: the agent's data base (`SchemaCatalog.dataBase(agent_setup.data_base_id)`), the same one
   searches use.
2. **Access**: the admin must have `record|read` on it (the permission the base-graph route checks).
   Without it, 403 `no_access`, and the chip shows why.
3. **Resolve** (`domain/overview/resolve.ts`, pure): dataset × base-graph schema → the base-graph
   query (ids only; `showTableHubs` and `showBaseHub` off; per-table filter for `deleted_at`,
   open-only, window; per-table limit 1,500; `valueFieldIds` for tone, size, date, money,
   `is_active`) plus the encoding spec and `missing`.
4. **Read** through the port `OVERVIEW_GRAPH_PORT`, implemented by
   `infrastructure/overview/base-graph-reader.ts` over `BaseGraphService` (the agent module imports
   `BaseGraphModule`, which already exports it).
5. **Encode** (`domain/overview/encode.ts`, pure): base-graph nodes and values → overview nodes:
   - roles become kinds;
   - `base` and table hubs are dropped;
   - orphans and actors go under `hub:<tableId>` labelled by `orphan`;
   - `grp:…:__none__` takes the orphan label;
   - tone, size, alert and derived tones follow §5.1–§5.2;
   - archived records are dropped, then unlinked actors and empty hubs are pruned;
   - structural links become parents, `link` edges whose field is in `edges` become links, and the rest
     are dropped;
   - labels are cut to 120 characters.
6. **Cache**: the encoded VO is kept in memory per (dataset, base-graph ETag) for 60 s. An unchanged
   base costs one aggregate per table and no assembly.

### 8.5 Limits

1,500 records per table read, 5,000 nodes and 15,000 links (the base-graph ceilings), a payload under
about 500 KB, and the browser's draw budget of 900 on top (`limitGraph`). The readout and KPIs are
computed from the whole VO, and only the chart sees the reduced graph (the cockpit's rule).

---

## 9. Part F: frontend

### 9.1 Files, by layer

| Layer | File | What |
|---|---|---|
| model | `model/overview/datasets.ts` | ids, order, chip labels, legend per dataset, 60 s |
| model | `model/overview/from-overview.ts` | `IAgentOverviewVo` → `IGraph` (`finishGraph`) |
| model | `model/overview/metrics.ts` | the KPIs of §5.2, from the VO |
| model | `model/overview/cycle.ts` | the cycle reducer (§6.4) |
| model | `model/graph/trace.ts` | trace by graph: parent chain, children, edges |
| data | `data/agent-api.ts` | `fetchOverview(dataset)` and its query key |
| state | `state/cockpit-store.ts` | `stage`, `overviewPinned`, the cycle's index and holds (not persisted) |
| hooks | `hooks/useOverview.ts` | React Query (stale 60 s), prefetch the next, graph, limit, metrics |
| hooks | `hooks/useOverviewCycle.ts` | the timer, visibility, prefetch moment, the holds the chart reports |
| hooks | `hooks/useStage.ts` | the mode rules of §4.1 |
| ui | `ui/stage/OverviewHead.tsx` | dataset chips, progress, countdown, ⏸/▶ |
| ui | `ui/stage/Readout.tsx` | generalised: `top`, `title`, `notes`, `metrics` (search and overview) |
| ui | `ui/stage/Legend.tsx` | entries passed in (today a fixed list) |
| ui | `ui/stage/NodeDetail.tsx` | the pinned node's strip with OPEN and ASK |
| ui | `ui/stage/Constellation.tsx` | `data-key` fallback, `onPointerInside`, fade class, rotation as a layer (§9.5) |
| containers | `containers/StageContainer.tsx` | overview or search |
| theme | `ui/theme/overview.module.css` | chips, progress, fade, detail strip (a new module: the main one is over 1,000 lines) |

i18n keys in `en` and `zh` under `agent.cockpit.overview.*`.

### 9.2 Constellation for the overview

The same component with the same props. The overview passes no lens, `lit` from the graph trace, and
`onHover`/`onPin` into the overview slots. Two additions: `onPointerInside(inside)` for the pointer
hold, and a `fading` flag for the cross-fade.

### 9.3 Mode switching and the session

`useStage` decides the mode from the store and the session. A live plan event switches to search
through the session's `onData` (the way a highlight's `view` already switches the view), so a replay
or a remount never takes the stage from the overview.

### 9.4 Readout and legend

`Readout` takes `{ top, title, notes, metrics }`:

- search mode passes `PROJECT PROGRESS · ANSWER`, the summary and the plan's notes;
- the overview passes `OVERVIEW · WORK`, the path, `UPDATED`, `SHOWING n OF m` and `NOT IN THIS BASE`.

`Legend` takes its entries: the search legend stays as now, and each dataset brings its own (for
example KNOWLEDGE: UPDATED ≤ 7 DAYS · ≤ 30 DAYS · OLDER · TYPE · RELATED).

### 9.5 Motion and cost (rotation as one layer)

The overview is on screen whenever the cockpit is idle, so the 8-fps re-layout of §2.1 becomes a
standing cost. With this design:

- the layout is computed only when the data, size or mode changes;
- rotation turns the chart group with a CSS `transform: rotate()` (GPU-composited, as the cockpit's
  `turnLayer` does);
- labels on the left half are flipped by re-rendering only when a label crosses the vertical, at most
  twice a turn per label, or in practice by re-rendering labels once every 5°.

This also closes review item C10 for the search constellation. Charts over 400 elements still hold
still, and reduced motion still stops everything.

### 9.6 Narrow screens, reduced motion, assistive tech

- Under 900 px the overview is still the default. Labels are off, the budget is 400, and the chips
  scroll sideways.
- Reduced motion: no fade, no rotation, no progress animation (the countdown text stays), and the
  cycle still advances.
- The readout's `aria-live` is `polite` for a dataset the admin picks and `off` for timed switches,
  so a screen reader isn't interrupted every minute. ⏸ satisfies WCAG 2.2.2 (pause moving content).
  Chips are buttons with `aria-pressed`, and the progress line is `aria-hidden`.

---

## 10. API changes

| Change | Where |
|---|---|
| `valueFieldIds?` per table, `values?` on record nodes (optional, version stays 4) | `packages/openapi/src/base-graph/query.ts`, `types.ts`; `base-graph/graph-plan.resolver.ts`, `graph-row.reader.ts`, `assembler/`, `graph-etag.service.ts` |
| `GET /api/agent/overview/:dataset` → `IAgentOverviewVo`, ETag/304 | `packages/openapi/src/agent/overview.ts`; `agent/interface/agent-overview.controller.ts` |
| Agent module imports `BaseGraphModule` | `agent/agent.module.ts` |

No database migration, and no change to the chat request (ASK uses the existing focus hint).

---

## 11. Files and phases

One commit per phase, lower-case subjects, tsc and the specs before each commit.

| Phase | Content | Done when |
|---|---|---|
| **P0 Values in the base graph** | `valueFieldIds` (resolver check, projection, row values, node values, ETag fingerprint); specs for assembler, resolver and ETag | `/graph` specs unchanged and passing; a query with values returns them, one without is byte-identical |
| **P1 Overview domain** | `domain/overview/datasets.ts`, `resolve.ts`, `encode.ts`; a fixture of the live schema of §2.4 (16 tables); specs | the four datasets resolve on the fixture; encoding covers roles, tones (status, fresh, map), open and window filters, pruning, empty hubs, the goal and contact rules, secrets never in the projection |
| **P2 Overview endpoint** | openapi contract; port and base-graph adapter; `GetOverview` with base, access and cache; controller; layers spec; e2e on `agent-e2e-pg` | e2e: each dataset over created tables, 304 on no change, 403 for a non-admin and for an admin without access to the base |
| **P3 Frontend model** | `model/overview/*`, `model/graph/trace.ts`; specs | from-overview, metrics per dataset, cycle reducer (holds, skips, drawn-starts-the-minute), trace |
| **P4 Overview stage** | store additions; `useOverview`, `useOverviewCycle`, mode rules in `useStage`; `OverviewHead`, `NodeDetail`, Readout and Legend generalised; keys `1`–`4`, `P`, `Esc`, `V`; ASK; i18n; CSS | component specs: default overview, a live search takes the stage, NEW returns, the cycle advances with fake timers and holds on pointer, pin, pick, hidden; ASK sets the focus |
| **P5 Rotation as one layer** | Constellation rotation by transform, labels re-flipped by steps | layout runs once per data change (spec counts it); labels stay readable on both halves |
| **P6 Manual run** | with the cockpit's P8: Chrome, Firefox, Safari; 1440, 1024, 390 px; MONO and CYBERPUNK; reduced motion; leave it cycling 10 minutes | admin signs off |

---

## 12. Testing

- **Backend unit**: resolve (every dataset against the fixture; a missing table goes to `missing`; a
  renamed state still filters open work; secret and attachment fields never in `valueFieldIds`) and
  encode (roles, orphans, `__none__`, pruning, empty hubs, tone kinds, the goal and contact rules,
  archived dropped). Base graph: values only when asked, ETag differs with and without them.
- **e2e** (`agent-e2e-pg`, `NODE_ENV=test`, Redis variables blank, at most two agent suites per
  process): create the WORK and KNOWLEDGE tables with links, read each dataset, check nodes and edges,
  304 on a second read, 403 for a non-admin.
- **Frontend**: the model specs of P3; component specs of P4 (fake timers for the minute and the
  prefetch at 50 s); the layers spec; the existing cockpit, board and constellation specs unchanged.

---

## 13. Decisions to confirm

Defaults are what this design assumes.

| # | Decision | Default |
|---|---|---|
| D1 | The view is called OVERVIEW and is the stage's default when there is no search to show (§4.1) | yes |
| D2 | A search starting in the session takes the stage; NEW and OVERVIEW bring the overview back; reopening a thread with searches shows its latest search | yes |
| D3 | Four datasets in this order: WORK, KNOWLEDGE, PEOPLE, FINANCE | yes |
| D4 | 60 s each, fixed (no setting in v1) | yes |
| D5 | The cycle holds on pointer over the chart, a pin, a picked dataset, ⏸ and a hidden tab; the remaining time is kept | yes |
| D6 | WORK shows the knowledge the work refers to, as a REFERENCES branch | yes |
| D7 | PEOPLE shows each person's open tasks and the projects they lead, under them | yes |
| D8 | FINANCE shows the last 90 days | yes |
| D9 | Archived records (deleted or inactive) are left out; cancelled work is shown faint | yes |
| D10 | Hubs with nothing under them are not drawn | yes |
| D11 | The server composes the overview in the agent module (§8.1) | yes |
| D12 | Field values come through an optional `valueFieldIds` on the base graph, rather than a second read | yes |
| D13 | ASK on a pinned node sets the focus hint and pre-fills the composer, but does not send | yes |
| D14 | Rotation becomes one turning layer (P5), also for the search constellation | yes |
| D15 | Narrow screens show the overview too, without labels, budget 400 | yes |
| D16 | Money is shown as a plain number with its sign, no currency symbol | yes |

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| The base-graph change affects `/graph` and `get_graph` | optional field, version unchanged, their specs must pass unchanged; the D12 fallback needs no change there |
| An always-on chart costs CPU and battery | rotation as one layer (P5); charts over 400 hold still; nothing runs while the cockpit is off or the tab hidden |
| The admin cannot read the data base | the endpoint checks first and answers 403 `no_access`; the chips show why and the stage falls back to STANDBY |
| Renamed tables or fields | names are resolved on each read; a missing table lands in `missing`, and the dataset is skipped when it has nothing to draw |
| Finance grows past the budget | the 90-day window, 1,500 per table, then the draw budget with "+N more" |
| A switch every minute is annoying, or noisy for screen readers | holds while looking, ⏸, `P`; timed switches are not announced |
| Stale numbers | 60 s cache on both sides, refetched each time the dataset comes round (every 4 minutes); `UPDATED` shows the age; live push can come later from the base graph's existing invalidation hook |
| Secrets in values | secret-looking and attachment fields are never in the projection; the encoder reads only the fields the spec names |
