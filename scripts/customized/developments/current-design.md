# Base Graph — from Knowledge Graph to all-table graph

Status: **analysis + proposed design, not started**
Branch: `feat-update-knowledge-graph`
Scope: `apps/nextjs-app/src/pages/base/[baseId]/knowledge-graph.tsx` and everything behind it.

> The previous content of this file (MCP server design) is in git history:
> `git show HEAD:scripts/customized/developments/current-design.md`.

Every path and behaviour below was read from the working tree. Live table list from base
`data-centre` (`bseJEuE54y5caWO0Xc8`) on 2026-09-26: 21 tables — `goals`, `projects`, `tasks`,
`contacts`, `contact_profession`, `contact_type`, `companies`, `knowledges`, `knowledge_type`,
`project_frameworks`, `table_references`, `finance_*` ×6, `auditlog`, `system_info`,
`system_status`, `template_table`.

---

## Part A — How it works today

### A.1 Request path at a glance

```
Browser                                   Next.js SSR                    NestJS
───────                                   ───────────                    ──────
/base/:baseId/knowledge-graph ──► getServerSideProps
                                    prefetch base + basePermission ──► (existing APIs)
                                    NOT the graph (see §A.2)
◄── HTML + dehydratedState
DynamicKnowledgeGraph (ssr:false, lazy three.js chunk)
  └ KnowledgeGraph
      ├ useKnowledgeGraph()      ── GET /api/base/:baseId/knowledge-graph ──► KnowledgeGraphController.getKnowledgeGraph
      │                                                                        └ KnowledgeGraphService.getGraph
      │                                                                            ├ assertTablesInBase
      │                                                                            ├ readTypes      (1 SQL)
      │                                                                            ├ readKnowledges (1 SQL)
      │                                                                            └ assembleKnowledgeGraph (pure)
      └ KnowledgeNodeDetailPanel
          └ useKnowledgeGraphNode(id) ─ GET …/knowledge-graph/node/:nodeId ──► KnowledgeGraphService.getNode
```

### A.2 Page (`pages/base/[baseId]/knowledge-graph.tsx`)

- `withEnv(ensureLogin(withAuthSSR(...)))` — login is enforced server-side.
- SSR prefetches only `ReactQueryKeys.base` and `getBasePermission`, which `BaseLayout` needs.
  The graph is **not** prefetched on purpose: `fetchQuery` rejects on error (a backend 404 would
  become a hard 500), and the consumer is `ssr: false`, so a dehydrated graph would never be used.
- The component is `DynamicKnowledgeGraph` → `next/dynamic(..., { ssr: false })` because
  `react-force-graph-3d` touches `window` at import time. That also keeps three.js out of the
  initial chunk.
- Entry point: sidebar link in `blocks/base/base-side-bar/BasePageRouter.tsx:101`.

### A.3 Backend (`apps/nestjs-backend/src/features/knowledge-graph/`)

| File | Role |
|---|---|
| `knowledge-graph.controller.ts` | `GET api/base/:baseId/knowledge-graph` and `GET …/node/:nodeId`, both `@Permissions('record\|read')`. Sets `ETag`, `Cache-Control: private, no-cache` |
| `knowledge-graph.service.ts` | Resolves the two tables, reads rows, builds breadcrumbs |
| `knowledge-graph.assembler.ts` | **Pure** function `assembleKnowledgeGraph(types, knowledges, opts)` → `{nodes, links, stats}` |
| `knowledge-type-tree.ts` | Generic hierarchy engine: `breakCycles`, `resolveHierarchy`, `orderDepthFirst` over `IHierarchyRow {recordId, title, parentRecordId}` |
| `types.ts` | `KNOWLEDGE_FIELD` — field **names** resolved at request time, and allowed field types |
| `configs/knowledge.config.ts` | `KNOWLEDGE_TABLE_ID`, `KNOWLEDGE_TYPE_TABLE_ID` (defaults are the data-centre ids), `KNOWLEDGE_GRAPH_MAX_NODES=2000`, `KNOWLEDGE_GRAPH_MAX_LINKS=6000` |

**`getGraph(baseId)`**

1. `assertTablesInBase` — both configured tables must belong to `:baseId`, else 404. This is what
   stops a member of another base from reading these tables through their own base id.
2. `resolveFields` — loads the table's fields, looks them up **by name**, asserts type
   (`title` text, `deleted_at` date, `knowledge_type`/`parent_type`/`knowledge_parent` single-valued
   Link, `related_knowledge` Link). Missing required field → 404; wrong type → 400.
3. `readRows` — `recordService.getRecordsFields(tableId, { fieldKeyType: Id, projection, filter:
   deleted_at is empty, ignoreViewQuery: true, take: max + 1 })`. One SQL per table. `take + 1`
   detects truncation without `COUNT(*)`.
4. `assembleKnowledgeGraph`:
   - sort by `title, recordId` (deterministic → stable ETag),
   - `breakCycles` on `parent_type` and on `knowledge_parent`, then depth/root resolution,
   - emits a synthetic `core` node, one `type:<rec>` per type, a synthetic
     `type:__unclassified__` bucket when needed, one `kn:<rec>` per knowledge,
   - structural links (`core-type`, `type-parent`, `type-knowledge`, `knowledge-parent`) are never
     dropped; `knowledge-knowledge` relations are deduped (two-way link arrives twice) and cut to
     the remaining link budget,
   - `degree`, `depth`, `rootTypeId` (colour key) are precomputed server-side.
5. ETag = sha1 of the whole assembled payload.

**`getNode(baseId, nodeId)`** parses the `type:`/`kn:` prefix, `getRecord` with `title`, `context`,
`knowledge_type`, `related_knowledge`, then **re-reads the whole type table (and, for knowledges,
the whole knowledge table)** to build a cycle-consistent breadcrumb.

Contract lives in `packages/openapi/src/knowledge-graph/{types,get,get-node}.ts`
(`KNOWLEDGE_GRAPH_VERSION = 3`; node tiers `core|type|knowledge`; link tiers are a closed enum).

### A.4 State management (frontend, `blocks/knowledge-graph/`)

Three layers, cleanly separated:

| Layer | Holder | Contents |
|---|---|---|
| **Server state** | React Query | `ReactQueryKeys.knowledgeGraph(baseId)`, `knowledgeGraphNode(baseId, nodeId)`; `staleTime 60s`, `gcTime 5m`, `refetchOnWindowFocus: false`. Refresh button = `invalidateQueries` |
| **View state** | zustand `useKnowledgeGraphStore` (not persisted) | `focusedNodeId`, `hiddenTypeIds` (**exclusions** — empty = show all), `autoRotate`, `showLegend`, `searchQuery` |
| **Derived state** | `useMemo` in `KnowledgeGraph.tsx` | `buildSimulationGraph(data, hiddenTypeIds)` — expands hidden ids to the whole subtree (`hiddenClosure`, fixpoint), filters nodes/links, **clones** everything (the force lib mutates nodes). Also `visibleCounts`, `typeNodes`, `legendHiddenTypeIds`, `siblingCount` |
| Browser-owned | DOM | fullscreen (`useFullscreen` reads `document.fullscreenElement`), container size (`useResizeObserver`) |

Rendering: `KnowledgeGraphCanvas` wraps `react-force-graph-3d`; tier-keyed lookup tables in
`utils/graphTheme.ts` drive size, charge, link distance/strength, radial "sphere" force, focus
distance, and colour (hue from `rootTypeId`). Search (`KnowledgeNodeSearch`) and the legend filter
work only on the already-loaded payload.

---

## Part B — Problems and restrictions

### B.1 Structural (block the all-tables goal)

| # | Restriction | Where | Effect |
|---|---|---|---|
| R1 | **Two table ids are fixed in env config**, defaulting to data-centre ids | `knowledge.config.ts` | Only one base can ever have a graph; any other base 404s. No way to add a table without a deploy |
| R2 | **Field semantics bound by magic names** (`title`, `deleted_at`, `knowledge_type`, …) | `types.ts` | Renaming a column in the UI breaks the page (404/400). Other tables do not follow these names (their primary field is not `title`) |
| R3 | **Domain baked into the published contract**: tier enums `core/type/knowledge`, link-tier enum, `type:`/`kn:` prefixes | `openapi/src/knowledge-graph/types.ts` | Any new table requires a contract change and a version bump |
| R4 | **Frontend styling keyed by tier enum** (`NODE_VAL`, `LINK_DISTANCE`, `TIER_CHARGE`, `LABELLED_TIERS`, `rootTypeId` hue) | `graphTheme.ts`, `KnowledgeGraphCanvas.tsx` | Unknown tiers fall back to neutral defaults — works, but looks like one grey cloud |
| R5 | **Only self-links + one type link are understood.** Cross-table links (task→project→goal, transaction→payee/category/account, contact→company) are invisible | service specs | The actually interesting base-wide structure is not in the graph |
| R6 | **No server-side filtering**; the only filter is "hide type subtree" on the client | store/`buildSimulationGraph` | Useless once the dataset exceeds the node budget: the kept subset is "first 2000 by title" |

### B.2 Performance / scale

| # | Issue | Detail |
|---|---|---|
| P1 | Full-table read on every request | Nothing cached server-side. The ETag is computed **after** the full read + assembly, so it saves bandwidth only, never DB work. The controller notes browsers never see a 304 anyway |
| P2 | `getNode` reads both whole tables to render one breadcrumb | Fine at 2k rows; an all-tables version must not copy this |
| P3 | Truncation is alphabetical | `sorted.slice(0, max)` — deterministic, but semantically arbitrary. `auditlog` / `finance_Transactions` would crowd everything else out |
| P4 | 3D force layout ceiling | `react-force-graph-3d` + a SpriteText per labelled node is comfortable to ~3–5k nodes / ~10k links on a laptop GPU; a whole base can exceed that |

### B.3 Correctness / UX

| # | Issue | Detail |
|---|---|---|
| U1 | **zustand store is a global singleton, not keyed by base** | Navigating base A → base B keeps `focusedNodeId` and `hiddenTypeIds` from A; `reset()` is only called from the toolbar |
| U2 | Dead state | `searchQuery`/`setSearchQuery` are never read — `KnowledgeNodeSearch` keeps its own state |
| U3 | No freshness signal | `staleTime 60s`, no focus refetch, no realtime: edits in the grid are not reflected until manual refresh |
| U4 | Detail panel is read-only and knowledge-specific | Shows `context` only; no "open record", no edit, no other fields |
| U5 | View state is not in the URL | A filtered/focused graph cannot be linked or bookmarked |
| U6 | Soft-delete is a naming convention (`deleted_at`) | Other tables have no such column; Teable's own deletion is real deletion + trash |
| U7 | Misleading comment | `CANVAS_BACKGROUND` comment says the app is dark-only, but the value `#f5f0e8` is a light cream |

### B.4 Permissions (must be carried into the new design)

- Check is **base-level** `record|read` only. `RecordPermissionService.wrapView` is a no-op in this
  build. *(Corrected during implementation: `getRecordsFields` does go through `wrapView`, via
  `buildFilterSortQuery` → `prepareQuery`. The earlier claim that it skips it was wrong.)* So reads
  through `RecordService` inherit any future record/field permission enforcement; do not add a
  raw-SQL path that bypasses it (see §C.6).
- The existing **ERD endpoint** (`GET /api/base/:baseId/erd`, `GraphService.generateBaseErd`) already
  computes table + link-field topology — but it is guarded by `base|update`, so read-only members
  cannot use it. Reuse its internals, not the route.

---

## Part C — Target design: schema-driven "Base Graph"

### C.1 Principle

Stop encoding the knowledge domain in code. The graph is derived from Teable's own metadata:

- **Node** = a record (plus optional synthetic *table hub* / *group* nodes).
- **Edge** = a value in a **Link field** whose foreign table is also in the graph. Link metadata
  (`foreignTableId`, `relationship`, `symmetricFieldId`, `isOneWay`) says everything needed.
- **Hierarchy** = an optional single-valued **self-link** per table (today: `parent_type`,
  `knowledge_parent`) — the existing `knowledge-type-tree.ts` engine is already generic and is
  reused as-is.
- **Grouping** = an optional single-valued link to another table used as a bucket (today:
  `knowledge_type`).
- **Label** = the table's **primary field** (via `getPrimaryField`), not a field named `title`.
- **Filtering** = Teable's own `IFilter` / saved views, per table, evaluated server-side.

The current knowledge graph becomes a **preset** of this engine (§C.7), not a separate code path.

### C.2 API (new module `features/base-graph`, mounted under `api/base/:baseId/graph`)

All routes `@Permissions('record|read')` under `:baseId` so `PermissionGuard` resolves the base.

**1. `GET /graph/schema`** — what can be graphed.

```ts
{
  tables: {
    id, name, icon, primaryFieldId,
    approxRecordCount,           // cheap estimate, for the table picker
    linkFields: { id, name, foreignTableId, relationship, isOneWay, symmetricFieldId,
                  isSelfLink, isMultipleCellValue }[],
    suggestedHierarchyFieldId?,   // single-valued self-link, if exactly one
  }[]
}
```
Built from `tableMeta` + field loader, reusing `GraphService.getBaseErdContext` logic without its
`base|update` guard. No record reads.

**2. `POST /graph/query`** — the graph. POST because `IFilter` is a nested tree.

```ts
IBaseGraphQueryRo = {
  tables: {
    tableId: string;
    viewId?: string;            // use a saved view's filter/sort (reuses the grid's filter UX)
    filter?: IFilter;           // or an ad-hoc filter; ANDed with the view's
    limit?: number;             // per-table budget (default derived from global)
    hierarchyFieldId?: string;  // single-valued self-link → tree edges
    groupByFieldId?: string;    // single-valued link to another included table → bucket edges
  }[];
  linkFieldIds?: string[];      // which link fields become edges; default = all between included tables
  showTableHubs?: boolean;      // synthetic `tbl:` node per table, tethering its roots
  maxNodes?: number;            // clamped server-side to config max
  maxLinks?: number;
}
```

Response (contract **v4**, generic):

```ts
node = { id, kind: 'record'|'table'|'group', tableId, recordId|null, label,
         parentId|null, colorKey, depth, degree }
link = { source, target, kind: 'hierarchy'|'group'|'hub'|'link', fieldId|null }
stats = { perTable: { tableId, emitted, truncated }[], nodeCount, linkCount,
          truncated: { nodes, links }, cyclesDropped, danglingLinks }
etag
```

- Node id: `rec:<recordId>` (Teable record ids are globally unique; `tableId` travels in the node),
  `tbl:<tableId>` for hubs. `colorKey` = `tableId` by default, or the hierarchy/group root — the
  same idea as `rootTypeId` today, generalised.
- `distance`/`value` are **dropped from the payload**: physics is presentation, it moves to
  `graphTheme.ts` keyed by `link.kind`.

**3. `GET /graph/node/:recordId?tableId=`** — detail. Primary + up to N non-computed fields
(respecting the table's field order / a view's visible fields), plus per-link-field neighbour
counts. Breadcrumb computed by walking the hierarchy field **per record** with a depth cap —
*not* by re-reading the whole table (fixes P2). Consistency with the graph's cycle-cut is achieved
by returning `ancestors` from the cached assembled graph when the node is in it (see C.5), and only
falling back to the walk for nodes outside it.

**4. `POST /graph/expand`** — `{ recordId, tableId, linkFieldIds?, limit }` → neighbours not yet in
the client's graph. Lets the user start small (filtered) and grow outward, which is what makes
`auditlog`/`finance_Transactions` usable at all (fixes P3/P4).

Validation at the boundary (zod): every `tableId` belongs to `:baseId` (generalised
`assertTablesInBase`, batched in one query), every `fieldId`/`viewId` belongs to its table,
hierarchy/group fields are single-valued links of the right target. Wrong input → 400, not an empty
graph.

### C.3 Backend engine

```
BaseGraphService.query(ro)
  ├ resolveSchema(baseId, ro)          → validated table/field plan (one metadata pass)
  ├ for each table (parallel, bounded):
  │     recordService.getRecordsFields(tableId, {
  │       viewId, filter, ignoreViewQuery: !viewId, fieldKeyType: Id,
  │       projection: [primary, hierarchyField?, groupField?, ...edgeLinkFields],
  │       take: limit + 1 })
  ├ assembleBaseGraph(rows, plan, budget)   ← pure, unit-tested like today's assembler
  └ etag
```

Pure assembler rules (generalising what the current one already does well):

1. Sort per table by `(label, recordId)` before truncating → stable subset and ETag.
2. Hierarchy per table: `breakCycles` → `resolveHierarchy` → `orderDepthFirst` (existing code).
3. Exactly one structural parent per node: hierarchy parent › group bucket › table hub › none.
4. **Symmetric-link dedupe via metadata**: for a two-way link, read edges from one side only —
   the field whose id sorts first of `{fieldId, symmetricFieldId}` when both tables are included;
   if only one side's table is included, that side. Replaces today's "read only the ManyOne side"
   hand rule and the `pairKey` dedupe (keep `pairKey` as a safety net).
5. Edges whose other endpoint was filtered/truncated out are counted in `danglingLinks`, not drawn.
   The client may offer "expand" on nodes with dangling links.
6. Structural links never displaced by the link budget; `link` edges truncated deterministically.

Config (`base-graph.config.ts`): `BASE_GRAPH_MAX_NODES` (default 5000), `BASE_GRAPH_MAX_LINKS`
(15000), `BASE_GRAPH_DEFAULT_TABLE_LIMIT` (1000). The two `KNOWLEDGE_*_TABLE_ID` env vars disappear.

### C.4 Filtering model

Two layers, both server-side:

- **Per-table filter** — `viewId` and/or `IFilter`. Reusing views means the user filters with the
  exact UI they already know from the grid, and the frontend can reuse
  `@teable/sdk/components/filter` (`BaseFilter`, `FilterWithTable`) for ad-hoc filters.
- **Which relationships** — `linkFieldIds`. Unticking `tasks.project` removes those edges.

Client-only (instant, no refetch): hide table, hide subtree (today's `hiddenTypeIds` generalised to
`hiddenNodeIds` + `hiddenTableIds`), search, focus.

Default when a table is added without a filter: `limit` = default table limit, and
`auditlog`/`system_*`/`template_table` are unticked in the picker by default (a UI default, not a
server rule).

### C.5 Caching and freshness

- **Cheap ETag before the read**: every Teable data table has `__last_modified_time`. One query per
  table — `max(__last_modified_time), count(*)` under the same filter — plus a hash of the
  normalised query DTO gives an ETag *without* reading rows or assembling. On match, return 304 /
  cached payload. Fixes P1. (Deletes lower `count`, so they invalidate too; verify with the trash
  restore path.)
- In-process LRU (or existing cache service, if Redis-backed) keyed by `(baseId, queryHash, etag)`,
  TTL ~60s. Also stores per-node ancestors for the detail endpoint.
- Frontend: `refetchOnWindowFocus: true` becomes cheap once 304s are real. Later: listen for
  `TABLE_RECORD_CREATE/UPDATE/DELETE` on the included tables via the existing realtime channel and
  invalidate the query key (debounced ~2s).

### C.6 Permission rules

- Route guard: `record|read` on the base (unchanged).
- Every read stays on `RecordService.getRecordsFields/getRecord` — no raw SQL on data tables — so
  any future record/field permission enforcement there is inherited automatically. The one
  exception, the ETag probe in C.5, only returns aggregates; if record-level permissions are ever
  enabled, it must be routed through `RecordPermissionService.getReadQuerySource` too.
- Cross-base links (link fields whose foreign table is in another base) are **excluded** in v4:
  following them would require a permission check against the other base.

### C.7 Knowledge graph as a preset

```ts
KNOWLEDGE_PRESET: IBaseGraphQueryRo = {
  tables: [
    { tableId: knowledge_type, hierarchyFieldId: <parent_type> },
    { tableId: knowledges, hierarchyFieldId: <knowledge_parent>, groupByFieldId: <knowledge_type>,
      filter: deleted_at is empty },
  ],
  linkFieldIds: [<related_knowledge>],
  showTableHubs: false,
}
```

Field ids are resolved from `/graph/schema` by name **once, client-side, when the preset is
created**, then stored by id — renames no longer break it (fixes R2). The synthetic `core` node
becomes an optional "base" hub. Old route `GET /knowledge-graph` can stay as a thin adapter over the
engine for one release, then be removed.

Presets are saved per base. Recommended storage: a `graph_presets` record in the base itself
(queryable by the MCP server too) — or, simpler for v1, `localStorage` keyed by `baseId`.

### C.8 Frontend

**Routing**: `pages/base/[baseId]/graph.tsx` (keep `knowledge-graph` as a redirect with
`?preset=knowledge`). SSR stays as today — prefetch base/permission only.

**State**

| Layer | Holder | Contents |
|---|---|---|
| Query (shareable) | **URL** (`?q=<compressed query DTO>&preset=&focus=rec:…`) | tables, views/filters, link fields. Source of truth for what is fetched → bookmarkable, back button works (fixes U5) |
| Server | React Query | `['base-graph', baseId, 'schema']`, `['base-graph', baseId, hash(query)]` with `placeholderData: keepPreviousData` so changing a filter doesn't blank the canvas; expansions merged into a separate `['base-graph', baseId, hash, 'expanded']` list |
| View | zustand, **one store per base** (`createStore` in a context provider mounted by the page, or `reset()` in an effect on `baseId` change) | `focusedNodeId`, `hiddenNodeIds`, `hiddenTableIds`, `autoRotate`, `showLegend`, `renderMode: '3d'\|'2d'`. Drop dead `searchQuery` (fixes U1, U2) |
| Derived | `useMemo` | `buildSimulationGraph(data ∪ expanded, hidden…)` — same clone-before-handing-to-force-lib rule |

**Components**

- `GraphQueryPanel` (new, collapsible, left): table checklist with colour swatch + approx count,
  per-table view picker and "Filter…" (`FilterWithTable`), hierarchy/group field selects,
  relationship (link field) checklist. Edits the URL, not the store.
- `Legend`: grouped by table, then by group/hierarchy root; toggles hide tables/subtrees.
- `NodeDetailPanel` (generic): primary + fields rendered with the SDK's `CellValue`
  renderers; per-link-field neighbour counts with "expand"; **"Open record"** opening the SDK
  `ExpandRecord` modal in place — the user can edit, and on close the graph query is invalidated
  (fixes U4, closes the loop with the grid).
- `graphTheme.ts`: keyed by `node.kind`/`link.kind` instead of the domain tier; colour from
  `colorKey` (table → hue, depth → lightness, as today for types). Labels only for hubs, groups,
  focused node, and top-degree nodes to keep sprite count bounded.
- Optional 2D renderer (`react-force-graph-2d`, same props) for large graphs (P4).

### C.9 Integration points

- Table view header / record expand menu: **"Show in graph"** → `/base/:id/graph?q={that table +
  current view}&focus=rec:…`.
- MCP server (`features/mcp`, same backend): add `get_graph` / `get_record_neighbors` tools calling
  `BaseGraphService` directly — the same permission path, no duplicate logic.
- Base sidebar entry renamed "Graph"; knowledge preset one click away.

---

## Part D — Delivery plan

| Phase | Work | Exit criterion |
|---|---|---|
| **0 — Quick fixes** (independent) | Reset store on `baseId` change; remove `searchQuery`; fix `CANVAS_BACKGROUND` comment | Switching bases shows a clean graph |
| **1 — Engine** | `features/base-graph`: schema route, query route, pure `assembleBaseGraph` + spec (port the existing assembler spec cases as the knowledge-preset regression suite), openapi v4 contract | Knowledge preset via `/graph/query` produces the same node/edge set as `/knowledge-graph` today (spec-asserted) |
| **2 — Generic UI** | New page, URL-state query, query panel, kind-keyed theme, generic detail panel + ExpandRecord | Can graph goals→projects→tasks and contacts→companies with view filters |
| **3 — Scale & freshness** | `/graph/expand`, pre-read ETag + cache, focus refetch, 2D mode | 20k-row `finance_Transactions` usable via filter + expand; unchanged data returns 304 |
| **4 — Integration** | Saved presets, "Show in graph" deep links, realtime invalidation, MCP tools, retire `/knowledge-graph` routes and `KNOWLEDGE_*` env | Old module deleted |

### Open questions

1. Presets: stored in the base (shared, visible to MCP) or per-user localStorage?
2. Should one-way link fields (no symmetric) be graphed by default, or opt-in?
3. Include lookup/rollup relationships as edges (the ERD does), or only real Link fields? Proposed:
   Link only in v4.
4. Is a record-level permission model planned? If yes, §C.6's ETag probe needs the permission CTE
   before Phase 3.
