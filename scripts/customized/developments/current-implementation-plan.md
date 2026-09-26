# Base Graph — Implementation Plan

Companion to `current-design.md` (the *what* and *why*). This file is the *order*, the *files*, and
the *proof* for each step.

Branch: `feat-update-knowledge-graph` · Base: `feat-db-setup`

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **GATE** = stop until cleared.

## Status — 2026-09-26: implemented, all phases

| Phase | State | Evidence |
|---|---|---|
| 0 Quick fixes | ✅ | Superseded by Phase 4 (old page deleted); store isolation now by construction |
| 1 Engine | ✅ GATE P1 cleared | Unit: resolver 15, assembler 19, helpers 7, knowledge-preset snapshots 7. E2E `base-graph.e2e-spec.ts` 17/17. **Parity** with the v3 assembler held over 7 fixtures + a 300-case seeded fuzz, and end-to-end against a real DB, before v3 was deleted |
| 2 Generic UI | ✅ (manual GATE P2 not run — see below) | Frontend unit 119/119 incl. 29 new; tsc + lint clean |
| 3 Scale & freshness | ✅ | Expand endpoint, pre-read ETag + cache (304 path e2e-tested), realtime invalidation, 2D renderer |
| 4 Integration & retirement | ✅ | Saved presets, table-header deep link, MCP `get_graph` / `get_record_neighbors` (e2e-tested with a PAT), v3 removed, old URL redirects |

Deviations from the plan, decided during implementation:

- **Visual tiers** (`blocks/base-graph/utils/visualTier.ts`): instead of re-tuning physics for v4
  kinds, each node/link is mapped onto the knowledge-graph tier it plays, so the heavily tuned
  layout constants in `graphTheme.ts` carry over unchanged.
- **Degree**: v4 counts a nested *type*'s edge to its parent, as for every other node; v3 omitted it
  for types only. Asserted, not hidden, in the parity work.
- **ETag probe** steps aside (full-payload ETag, no cache) whenever a used or filtered field is
  computed — a formula/lookup can change without its row being written. The feared "symmetric link"
  gap turned out not to exist: a drawn link always has both tables probed.
- **Node breadcrumb** walks the hierarchy per level (depth cap 32) rather than reading from the
  cached graph; in a cyclic hierarchy it can disagree with the graph about which edge was cut.
- **Record-level deep link** from the SDK expand-record menu was not added (needs an SDK slot);
  the graph accepts `?focus=rec:…`, and the table header links to the graph.
- MCP graph tools are grouped under `discovery` in the manifest (no new group, no UI change).

Not done / needs a human:

- GATE P2/P3 manual checks in a browser on `data-centre` (3D/2D rendering, record editor opened
  from the graph, live refresh). Everything around the canvas is covered by a component test; the
  WebGL canvas itself cannot run in happy-dom.
- Pre-existing failures, unchanged on clean HEAD: `table-open-api.service.spec.ts`
  (`cleanTablesRelatedData`) and `mcp.e2e-spec.ts` "deletes records and leaves them restorable" —
  the latter reads a record *after* deleting it and JSON-parses the error text.


---

## 0. Ground rules

- Every phase ends green: `pnpm -F @teable/backend test-unit`, `pnpm -F @teable/app test-unit`,
  type-check, lint. E2E suites named per phase must pass before the phase is marked done.
- Files stay under 500 lines. The assembler is split by concern from the start (see 1.6).
- The old `/knowledge-graph` page and API keep working until Phase 4 removes them. No phase
  breaks the current page.
- No raw SQL against data tables except the aggregate ETag probe in 3.2, and that goes through
  `RecordService.buildFilterSortQuery` so it uses the same filter compilation as the reads.
- Contract changes go into `packages/openapi` first; backend and frontend import from there only.

### 0.1 Decisions taken for the open questions in the design

| # | Question | Decision for v1 | Revisit |
|---|---|---|---|
| Q1 | Where presets live | `localStorage`, keyed by `baseId`, plus built-in code presets (knowledge). A `graph_presets` table is Phase 4, optional | After Phase 2 usage |
| Q2 | One-way links | Included by default. They are real links; with no symmetric field there is nothing to dedupe | — |
| Q3 | Lookup/rollup as edges | No. Link fields only | v5 |
| Q4 | Record-level permissions | Not planned. **GATE P3-A** re-checks before the ETag probe ships | Phase 3 |

---

## 1. File map

### New — contract (`packages/openapi/src/base-graph/`)

| File | Contents |
|---|---|
| `types.ts` | `BASE_GRAPH_VERSION = 4`, id prefixes, node/link kind enums, node/link/stats zod schemas |
| `schema.ts` | `GET /base/{baseId}/graph/schema` route, `IBaseGraphSchemaVo`, `getBaseGraphSchema()` |
| `query.ts` | `POST /base/{baseId}/graph/query` route, `baseGraphQueryRoSchema`, `IBaseGraphVo`, `queryBaseGraph()` |
| `node.ts` | `GET /base/{baseId}/graph/node/{recordId}` route, `IBaseGraphNodeVo`, `getBaseGraphNode()` |
| `expand.ts` | (Phase 3) `POST /base/{baseId}/graph/expand` route, `expandBaseGraph()` |
| `index.ts` | re-exports; add `export * from './base-graph'` to `packages/openapi/src/index.ts` |

### New — backend (`apps/nestjs-backend/src/features/base-graph/`)

| File | Contents |
|---|---|
| `base-graph.module.ts` | imports `RecordModule`; registered in `app.module.ts` next to `KnowledgeGraphModule` |
| `base-graph.controller.ts` | four routes, `@Permissions('record\|read')`, mounted at `api/base/:baseId/graph` |
| `base-graph.service.ts` | orchestration: plan → read → assemble → etag |
| `graph-plan.resolver.ts` | validates the query DTO against base metadata, produces `IGraphPlan` |
| `graph-row.reader.ts` | per-table `getRecordsFields` → `IGraphRow[]` |
| `assembler/assemble-base-graph.ts` | pure entry point |
| `assembler/structure.ts` | hierarchy + group + hub parent resolution (uses `knowledge-type-tree.ts`) |
| `assembler/edges.ts` | link-edge extraction, symmetric dedupe, budget |
| `assembler/budget.ts` | per-table + global node budget allocation |
| `assembler/*.spec.ts` | unit specs per file |
| `graph-etag.service.ts` | (Phase 3) aggregate probe + cache |
| `presets/knowledge.preset.ts` | knowledge preset as data, used by specs and the adapter |
| `base-graph.config.ts` → in `src/configs/` | `BASE_GRAPH_MAX_NODES`, `BASE_GRAPH_MAX_LINKS`, `BASE_GRAPH_DEFAULT_TABLE_LIMIT`, `BASE_GRAPH_CACHE_TTL` |

`knowledge-type-tree.ts` moves to `features/base-graph/hierarchy.ts` (pure move; the old module
re-imports it from there until deleted).

### New — frontend (`apps/nextjs-app/src/features/app/blocks/base-graph/`)

| File | Contents |
|---|---|
| `DynamicBaseGraph.tsx` | `next/dynamic`, `ssr: false` (same reason as today) |
| `BaseGraph.tsx` | container: data hooks, derived graph, layout of panels |
| `BaseGraphCanvas.tsx` | generalised from `KnowledgeGraphCanvas.tsx`, kind-keyed |
| `panels/GraphQueryPanel.tsx` | table checklist, view picker, filter, hierarchy/group, link fields |
| `panels/TableFilterDialog.tsx` | wraps SDK `FilterWithTable` |
| `panels/GraphLegend.tsx` | grouped by table → root |
| `panels/NodeDetailPanel.tsx` | generic fields + neighbour counts + open record |
| `panels/NodeSearch.tsx` | ported from `KnowledgeNodeSearch.tsx` |
| `GraphToolbar.tsx` | ported from `KnowledgeGraphToolbar.tsx` |
| `hooks/useGraphSchema.ts`, `useBaseGraph.ts`, `useGraphNode.ts`, `useGraphQueryParam.ts`, `useGraphLiveInvalidation.ts` | data + URL + realtime |
| `store/createGraphStore.ts`, `store/GraphStoreProvider.tsx` | per-base zustand store |
| `utils/queryCodec.ts` | query DTO ⇄ URL param |
| `utils/buildSimulationGraph.ts`, `utils/graphTheme.ts` | generalised copies; `hooks/useFullscreen.ts`, `hooks/useResizeObserver.ts` moved as-is |
| `presets.ts` | built-in presets + localStorage presets |
| page: `apps/nextjs-app/src/pages/base/[baseId]/graph.tsx` | same SSR shape as `knowledge-graph.tsx` |

### Changed

| File | Change |
|---|---|
| `apps/nestjs-backend/src/app.module.ts` | add `BaseGraphModule` |
| `apps/nestjs-backend/src/configs/config.module.ts`, `env.validation.schema.ts` | add base-graph config and Joi keys |
| `packages/sdk/src/config/react-query-keys.ts` | `baseGraphSchema`, `baseGraph`, `baseGraphNode` keys |
| `packages/common-i18n/src/locales/{en,…}/baseGraph.json`, `I18nNamespaces.ts` | new `baseGraph` namespace |
| `apps/nextjs-app/src/features/i18n/base-all.config.ts` | add `baseGraph` |
| `apps/nextjs-app/src/features/app/blocks/base/base-side-bar/BasePageRouter.tsx` | link → `/graph` |
| `apps/nestjs-backend/src/cache/types.ts` | Phase 3: `base-graph:*` keys in `ICacheStore` |
| `apps/nestjs-backend/src/features/mcp/tools/` | Phase 4: `graph.tools.ts` |

### Deleted (Phase 4)

`features/knowledge-graph/` (backend), `blocks/knowledge-graph/` (frontend),
`packages/openapi/src/knowledge-graph/`, `knowledge.config.ts`, the `KNOWLEDGE_*` Joi keys,
`knowledgeGraph` i18n namespace and query keys, `test/knowledge-graph.e2e-spec.ts` (after its cases
are ported), `src/types.d/d3-force-3d.d.ts` stays (still used).

---

## Phase 0 — Quick fixes on the current page (independent, ~0.5 day)

Ship these first; they are useful even if the rest slips.

- [ ] **0.1 Reset view state on base change.** In `KnowledgeGraph.tsx`, `useEffect(() => reset(), [baseId])`.
  Test: `KnowledgeGraph.spec.tsx` — render with base A, hide a type, rerender with base B →
  `hiddenTypeIds` empty, `focusedNodeId` null.
- [ ] **0.2 Remove dead `searchQuery`** from `useKnowledgeGraphStore.ts`. Verify: `grep -rn searchQuery` empty.
- [ ] **0.3 Fix the `CANVAS_BACKGROUND` comment** in `KnowledgeGraph.tsx` to state what the value is
  (a light canvas on purpose), not a dark-only claim.
- [ ] **0.4 Escape pipes in `current-design.md` tables** (`record\|read`) — markdownlint MD056.

Exit: unit tests green, page behaves identically apart from 0.1.

---

## Phase 1 — Backend engine (~5–6 days)

### 1.1 Contract (`packages/openapi/src/base-graph/`)

- [ ] `types.ts`

```ts
export const BASE_GRAPH_VERSION = 4;
export const RECORD_NODE_PREFIX = 'rec:';     // rec:<recordId>
export const TABLE_NODE_PREFIX = 'tbl:';      // tbl:<tableId>
export const GROUP_NODE_PREFIX = 'grp:';      // grp:<fieldId>:<recordId> | grp:<fieldId>:__none__
export const BASE_NODE_ID = 'base';           // optional base hub (the old `core`)

export const GraphNodeKindValues = ['base', 'table', 'group', 'record'] as const;
export const GraphLinkKindValues = ['hub', 'group', 'hierarchy', 'link'] as const;

node  = { id, kind, tableId: string|null, recordId: string|null, label,
          parentId: string|null, colorKey: string|null, depth: int, degree: int }
link  = { source, target, kind, fieldId: string|null }
stats = { perTable: { tableId, emitted, truncated }[], nodeCount, linkCount,
          truncated: { nodes, links }, cyclesDropped, danglingLinks, groupOrphans }
```

- [ ] `schema.ts` — VO per table: `id, name, icon, primaryFieldId, primaryFieldName,
  approxRecordCount, views: {id,name}[], linkFields: {id, name, foreignTableId, relationship,
  isOneWay, symmetricFieldId, isSelfLink, isMultipleCellValue}[], suggestedHierarchyFieldId`.
- [ ] `query.ts` — RO:

```ts
baseGraphQueryRoSchema = z.object({
  tables: z.array(z.object({
    tableId: z.string().startsWith('tbl'),
    viewId: z.string().startsWith('viw').optional(),
    filter: filterSchema.nullable().optional(),        // from @teable/core
    limit: z.number().int().min(1).max(20000).optional(),
    hierarchyFieldId: z.string().startsWith('fld').optional(),
    groupByFieldId: z.string().startsWith('fld').optional(),
  })).min(1).max(50),
  linkFieldIds: z.array(z.string().startsWith('fld')).optional(),  // undefined = all eligible
  showTableHubs: z.boolean().default(false),
  showBaseHub: z.boolean().default(false),
  maxNodes: z.number().int().min(1).optional(),
  maxLinks: z.number().int().min(1).optional(),
}).refine(unique tableIds)
```

- [ ] `node.ts` — VO: `id, recordId, tableId, tableName, label, fields: {fieldId, name, type,
  cellValue}[]` (non-hidden, max 20, primary first), `linkCounts: {fieldId, name, count,
  foreignTableId}[]`, `ancestors: {id,label}[]`, `createdTime`, `lastModifiedTime`.
- [ ] Register all routes with `registerRoute` so they appear in the OpenAPI doc.
- [ ] `packages/openapi/src/index.ts`: `export * from './base-graph';`

Verify: `pnpm -F @teable/openapi build` (or type-check) passes; schema snapshot test for the RO
(valid + 6 invalid shapes).

### 1.2 Config

- [ ] `src/configs/base-graph.config.ts` (same style as `knowledge.config.ts`, defaults in the
  factory, not Joi): `maxNodes 5000`, `maxLinks 15000`, `defaultTableLimit 1000`,
  `cacheTtlSeconds 60`.
- [ ] Joi keys `BASE_GRAPH_MAX_NODES|MAX_LINKS|DEFAULT_TABLE_LIMIT|CACHE_TTL` (integer, min 1).
- [ ] Register in `config.module.ts`.

Client-supplied `maxNodes`/`maxLinks`/`limit` are **clamped** to config, never trusted.

### 1.3 Module skeleton

- [ ] `BaseGraphModule` (`imports: [RecordModule]`), controller with four routes returning
  `NotImplemented`, registered in `app.module.ts`.
- [ ] Controller mount `@Controller('api/base/:baseId/graph')`, each route
  `@Permissions('record|read')`, body validated with `ZodValidationPipe(baseGraphQueryRoSchema)`.

Verify: e2e smoke — unauthenticated → 401; member without base access → 403; valid → 501.

### 1.4 Plan resolver (`graph-plan.resolver.ts`)

Input: `baseId`, RO. Output:

```ts
interface IGraphTablePlan {
  tableId: string; tableName: string; dbTableName: string;
  primaryField: IFieldInstance;
  viewId?: string; filter?: IFilter; limit: number;
  hierarchyField?: IFieldInstance;            // single-valued self-link
  groupField?: IFieldInstance;                // single-valued link to another table
  groupTargetIncluded: boolean;               // is the group's foreign table in the query?
  edgeFields: { field: IFieldInstance; foreignTableId: string; readSide: boolean }[];
}
interface IGraphPlan { baseId; tables: IGraphTablePlan[]; maxNodes; maxLinks; showTableHubs; showBaseHub }
```

Steps:

1. One `prisma.tableMeta.findMany({ where: { id: { in }, baseId, deletedTime: null } })`.
   Any requested table missing → **404** naming the id (generalised `assertTablesInBase`, one query
   instead of N).
2. Fields via `recordService.getFieldsByProjection(tableId)` per table (data loader caches).
3. `viewId` must belong to its table (`prisma.view.findFirst({ id, tableId, deletedTime: null })`) → else 400.
4. `hierarchyFieldId`: must be on that table, `type === Link`, `options.foreignTableId === tableId`,
   `!isMultipleCellValue` → else 400 with the reason (same messages style as `resolveFields` today).
5. `groupByFieldId`: on that table, Link, single-valued, `foreignTableId !== tableId`.
6. Edge fields: every Link field on an included table whose `foreignTableId` is also included,
   minus hierarchy/group fields (those are structural), intersected with `linkFieldIds` if given.
   Unknown id in `linkFieldIds` → 400. Links with `options.baseId` set to another base are skipped
   (cross-base, design §C.6).
7. **Read side** for symmetric dedupe: for a field with `symmetricFieldId` whose symmetric field is
   also an edge field, `readSide = field.id < symmetricFieldId`. Otherwise `readSide = true`.
8. Budget: `limit = min(t.limit ?? defaultTableLimit, config cap)`.

Spec (`graph-plan.resolver.spec.ts`, mocked prisma + record service): 12 cases — foreign table,
missing table, wrong-base table, view on wrong table, multi-valued hierarchy, hierarchy pointing
elsewhere, group = self-link, cross-base link skipped, symmetric pair picks one side, symmetric
with only one side included, `linkFieldIds` narrowing, clamping.

### 1.5 Row reader (`graph-row.reader.ts`)

```ts
interface IGraphRow {
  tableId: string; recordId: string; label: string;
  parentRecordId: string | null;           // hierarchy
  group: { recordId: string; title: string } | null;
  links: { fieldId: string; targetRecordIds: string[] }[];  // only readSide fields
}
```

- One `recordService.getRecordsFields(tableId, { fieldKeyType: Id, projection, viewId,
  ignoreViewQuery: !viewId, filter, take: limit + 1 }, true)` per table. `filter` is ANDed with the
  view's filter by the existing record query layer when both are given — **verify** in the e2e;
  if not, AND them in the resolver.
- Label: `primaryField.cellValue2String(cell)`, empty → `''`. Works for formula, number, link,
  user primaries.
- Link cells: reuse `extractLinkRecordId` / `extractRelatedRecordIds` — move them into
  `features/base-graph/link-cells.ts` and import from the old service.
- Group title comes from the link cell's `title` (`ILinkCellValue.title`), so a group target table
  that is *not* included still gets labelled synthetic group nodes with no extra read.
- Tables are read with `Promise.all` over a concurrency limit of 4 (not unbounded: one connection
  pool).
- Returns `{ rows, truncated }` per table (`rows.length > limit` → slice, truncated = true).
  Sorting for determinism happens in the assembler, not here.

Spec: label conversion for 4 primary types; missing cells (key absent) → nulls; truncation flag.

### 1.6 Pure assembler (`assembler/`)

`assembleBaseGraph(plan: IAssemblerPlan, rowsByTable: Map<tableId, IGraphRow[]>): IAssembledGraph`
— no Nest, no I/O. `IAssemblerPlan` is the serialisable subset of `IGraphPlan` (ids, flags,
budgets), so specs build it by hand.

**budget.ts**
1. Per table: sort rows `byTitleThenId` (label, recordId) — reuse the existing comparator.
2. If `Σ rows > maxNodes`: allocate `share_t = floor(maxNodes × n_t / Σ n)`, hand leftover slots to
   tables in `tableId` order, slice each table. Deterministic → stable ETag.
3. Mark `perTable[t].truncated` if the reader or the budget cut anything.

**structure.ts** — exactly one structural parent per record node:
1. Hierarchy: `breakCycles(sortedRows)` → `resolveHierarchy` → `orderDepthFirst` on the emitted set
   (same post-truncation rule as today: a parent cut by the budget ⇒ the child becomes a root).
2. For a root record (no hierarchy parent):
   - group field set and target table included and target emitted → parent = `rec:<groupRecordId>`,
     link kind `group`;
   - group field set but target table not included → parent = `grp:<fieldId>:<groupRecordId>`
     (synthetic node, label = link title), link kind `group`;
   - group field set but cell empty / target not emitted → `grp:<fieldId>:__none__`
     ("Unclassified"), counted in `stats.groupOrphans`;
   - else `showTableHubs` → `tbl:<tableId>`, link kind `hub`;
   - else no parent.
3. Table hubs and synthetic groups attach to `base` when `showBaseHub`, kind `hub`.
4. `depth`: hierarchy depth + depth of the structural parent + 1 (hub/base = 0).
5. `colorKey`: the id of the top-most **non-hub** ancestor (group root or hierarchy root);
   falls back to `tbl:<tableId>`. This reproduces today's `rootTypeId` for the knowledge preset.
6. Node order: base, hubs, then per table in plan order, each depth-first — parents before
   children, as the client's `hiddenClosure` assumes.

**edges.ts**
1. For each row, for each `links[]` entry, for each target: drop self-links; drop if target not
   emitted → `danglingLinks++`; key `pairKey(fieldPairId, a, b)` where `fieldPairId` is the smaller
   of `{fieldId, symmetricFieldId}` — safety-net dedupe on top of read-side selection.
2. Sort pairs `(source, target, fieldId)`; structural links first, never dropped; `link` edges cut
   to `maxLinks - structural`. `truncated.links` accordingly.
3. `degree` = structural (1 if it has a parent) + children + **all** link pairs (before budget),
   same rationale as today (hubs don't visually shrink when edges are hidden).

**assemble-base-graph.ts** ties them together and fills `stats`.

Specs (target ≥ 40 cases, grouped):
- *Parity* (the key suite): port every case in `knowledge-graph.assembler.spec.ts` by running the
  knowledge preset through the new assembler and mapping ids (`type:x→rec:x`, `kn:x→rec:x`,
  `core→base`, `type:__unclassified__→grp:<knowledge_type fld>:__none__`, link tiers
  `core-type→hub`, `type-parent→hierarchy`, `type-knowledge→group`, `knowledge-parent→hierarchy`,
  `knowledge-knowledge→link`). Node set, parent ids, depths, degrees, colour keys and stats must
  match.
- Multi-table: goals←projects←tasks chain, contacts↔companies many-many, one-way link, symmetric
  link with both sides included (one edge), filtered-out targets become dangling, hub mode.
- Budget: proportional split, leftover distribution, determinism under shuffled input.
- Cycles in two tables at once; hierarchy parent truncated away.

### 1.7 Service + controller

- [ ] `BaseGraphService.getSchema(baseId)` — table meta + link fields; `approxRecordCount` via
  `pg_class.reltuples` for the table's `dbTableName` (cheap, may be −1 → report `null`); views list.
  Reuse the field/table loading pattern from `GraphService.getBaseErdContext` but do **not** call
  the `/erd` route (it needs `base|update`).
- [ ] `BaseGraphService.query(baseId, ro)` — resolver → reader → assembler →
  `etag = "bg4-" + sha1(JSON(graph)).slice(0,16)` (Phase 3 replaces with the probe ETag).
- [ ] `BaseGraphService.getNode(baseId, recordId, tableId)` — assert table in base; `getRecord`
  with `fieldKeyType: Id`, projection = primary + first 20 visible fields of the table's default
  view (via `viewService`/field order); `linkCounts` from link cells lengths; ancestors: walk
  hierarchy field with one `getRecord` per level, **depth cap 32**, `seen` guard. (Phase 3 serves
  ancestors from the cached assembled graph when present so breadcrumbs agree with cycle cuts.)
- [ ] Controller sets `ETag`, `Cache-Control: private, no-cache`, `Vary: Cookie, Authorization`,
  honours `If-None-Match` (same as today).

### 1.8 E2E (`apps/nestjs-backend/test/base-graph.e2e-spec.ts`)

Harness exactly like `knowledge-graph.e2e-spec.ts` (`initApp`, `createTable` with `records: []`,
`createField`). Fixtures: `goals`, `projects` (link → goals), `tasks` (link → projects, self-link
`parent_task`), `tags` (many-many ↔ tasks).

Cases:
1. Schema lists all four tables with correct link metadata.
2. Query with all tables → expected nodes/edges; symmetric many-many edge appears once.
3. Per-table `filter` narrows rows; edges into filtered rows become `danglingLinks`.
4. `viewId` with a view filter narrows rows; `viewId` + `filter` are ANDed.
5. Hierarchy field on `tasks` produces `hierarchy` links, cycle is cut and counted.
6. Group by `projects` on `tasks` with projects excluded → synthetic `grp:` nodes labelled with titles.
7. Budget: `limit: 2` sets `perTable.truncated`.
8. Validation: foreign-base table 404; multi-valued hierarchy 400; unknown linkFieldId 400.
9. Knowledge preset against knowledge-shaped fixtures returns the same graph as
   `GET /knowledge-graph` after id mapping (**parity gate**).
10. Node detail: fields, link counts, ancestors.
11. `If-None-Match` → 304.

**GATE P1** — all unit + e2e green, parity case 9 passes. Only then start Phase 2.

---

## Phase 2 — Generic frontend (~5–6 days)

### 2.1 Plumbing

- [ ] Query keys in `react-query-keys.ts`:
  `baseGraphSchema(baseId)`, `baseGraph(baseId, queryHash)`, `baseGraphNode(baseId, recordId)`.
- [ ] i18n namespace `baseGraph` (en + zh, copy + adapt `knowledgeGraph.json`), register in
  `I18nNamespaces.ts` and `base-all.config.ts`.
- [ ] Page `pages/base/[baseId]/graph.tsx` — copy of `knowledge-graph.tsx` SSR (base + permission
  prefetch only), renders `DynamicBaseGraph`.

### 2.2 URL state (`utils/queryCodec.ts`, `hooks/useGraphQueryParam.ts`)

- URL params: `preset` (built-in or saved id), `q` (encoded RO), `focus` (`rec:…`).
- `q` = base64url(JSON) of the RO with defaults stripped. No new dependency (no lz-string in the
  repo). Hard cap 6 KB encoded; above it, the UI saves a local preset and writes `preset=` instead.
- Decode → validate with `baseGraphQueryRoSchema.safeParse`; invalid → fall back to default preset
  and show a toast. Never send an unvalidated URL payload.
- Writes use `router.replace(..., { shallow: true })` for panel edits and `router.push` for preset
  switches (so Back undoes a preset change, not every checkbox).
- `queryHash` = stable stringify (sorted keys) of the normalised RO, used in the query key.

Spec: round-trip, default stripping, invalid input fallback, size cap.

### 2.3 Per-base store (`store/`)

- `createGraphStore()` via `zustand/vanilla` `createStore`; `GraphStoreProvider` keyed by `baseId`
  (`<GraphStoreProvider key={baseId}>`) — a new base gets a new store by construction (supersedes 0.1).
- State: `focusedNodeId`, `hiddenNodeIds` (exclusions; subtree semantics via `hiddenClosure`),
  `hiddenTableIds`, `autoRotate`, `showLegend`, `showQueryPanel`, `expanded: IBaseGraphVo[]` (Phase 3).
- `focus` from the URL seeds `focusedNodeId` once on mount.

### 2.4 Data hooks

- `useGraphSchema()` — `staleTime 5m`.
- `useBaseGraph(ro)` — `useQuery({ queryKey: baseGraph(baseId, hash), queryFn: queryBaseGraph,
  placeholderData: keepPreviousData, staleTime 60s })`. Error UI stays in the component (shared
  QueryCache swallows 4xx, as noted in the current hook).
- `useGraphNode(recordId, tableId)`.

### 2.5 Derived graph (`utils/buildSimulationGraph.ts`)

Generalise the current file: `hiddenClosure(nodes, hiddenNodeIds)` unchanged in logic; add table
filter (`node.tableId in hiddenTableIds` → hidden, cascades through the closure); visibility:
`base` node and `hub` links invisible (same trick as `core` today, keeps the layout connected).
Keep the clone-before-render rule. Port `buildSimulationGraph.spec.ts` (640 lines of cases) and add
table-hiding cases.

### 2.6 Theme + canvas

- `graphTheme.ts`: lookups keyed by `node.kind` / `link.kind` (base/table/group/record;
  hub/group/hierarchy/link). Colour: hue from `hash(colorKey)`, lightness by `depth` — same
  function as today's `colorForNode` with `colorKey` in place of `rootTypeId`. Per-table palette
  override map for stable, distinguishable table colours.
- `BaseGraphCanvas.tsx`: port `KnowledgeGraphCanvas.tsx`; replace tier lookups with kind lookups;
  label sprites for `table`, `group`, focused node, and top-N by degree (N = 150) to bound sprite
  count. Keep sprite disposal, time-based rotation, gated mount on non-zero size.
- Port `graphTheme` specs; add a spec that every kind has an entry (total lookups).

### 2.7 Panels

- [ ] `GraphQueryPanel` (collapsible, left): from schema — table rows (checkbox, colour swatch,
  name, approx count), expand a row for: view `Select`, "Filter…" (opens `TableFilterDialog`),
  hierarchy field `Select` (self-link fields only, pre-filled with `suggestedHierarchyFieldId`),
  group-by `Select` (single-valued links to other tables). Relationships section: link fields
  between checked tables. `auditlog`, `system_*`, `template_table` unchecked by default (name list
  in `presets.ts`, UI default only). All edits write the URL (2.2), never the store.
- [ ] `TableFilterDialog`: `FilterWithTable` needs `fields: IFieldInstance[]` and a link context —
  load the table's fields with the SDK field fetch used by `LookupFilterOptions.tsx` and mirror its
  props (it is the closest existing usage).
- [ ] `GraphLegend`: sections per table, rows per root (group/hierarchy root), toggles
  `hiddenNodeIds`; table header toggles `hiddenTableIds`; "show all".
- [ ] `NodeDetailPanel`: label, table name, breadcrumb (same rtl-truncation trick as today),
  fields rendered with SDK `CellValue`, link counts per field, **Open record** →
  `<ExpandRecorder tableId recordId recordIds={[recordId]} onClose>` (same usage as
  `CalendarProvider.tsx:101`); on close, invalidate `baseGraph` and `baseGraphNode`.
- [ ] `NodeSearch`, `GraphToolbar`: ports; toolbar shows per-table truncation in a popover instead
  of the single banner.

### 2.8 Built-in presets (`presets.ts`)

- `knowledge`: resolved from schema **by table and field name once** (`knowledges`,
  `knowledge_type`, `knowledge_parent`, `parent_type`, `knowledge_type`, `related_knowledge`,
  `deleted_at is empty` filter) and then kept as ids. If a name is missing, the preset is shown
  disabled with the reason — never a 404 page.
- `work`: goals ← projects ← tasks.
- `people`: contacts ↔ companies + contact_type/profession groups.
- `finance` (filtered: last 90 days of `finance_Transactions`).
- Default for a base with none of these: all tables except system ones, hubs on.

### 2.9 Navigation

- `BasePageRouter.tsx`: entry points to `/base/:id/graph`, label "Graph".
- `knowledge-graph.tsx`: keep, but add a visible "Open in new graph" link during the transition.
  (Redirect happens in Phase 4.)

### 2.10 Frontend tests

Unit (vitest): codec, store provider isolation per base, `buildSimulationGraph`, theme totality,
`GraphQueryPanel` (checking a table updates the URL RO), `NodeDetailPanel` (opens ExpandRecorder),
presets resolution incl. missing field.

**GATE P2** — manual pass on `data-centre` in the dev stack (`apps/nextjs-app/.env.development.local`,
Postgres `30898`): knowledge preset looks and behaves like the old page; `work` and `people`
presets render cross-table edges; a filter change keeps the old graph on screen until the new one
arrives; opening and editing a record updates the graph on close.

---

## Phase 3 — Scale & freshness (~4 days)

### 3.1 Expand endpoint

- [ ] Contract `expand.ts`: RO `{ tableId, recordId, linkFieldIds?, limit (≤ 500), exclude?:
  string[] (node ids the client has) }` → VO `{ nodes, links, truncated }` in the v4 shapes.
- [ ] Service: `getRecord` for the link cells of the seed record, group target ids by foreign
  table, one `getRecordsById`-style read per foreign table (projection primary only), build nodes
  with `parentId: null`, `colorKey: tbl:<tableId>`, links kind `link`. Permission: base
  `record|read`; foreign tables must be in the same base (same resolver check).
- [ ] Frontend: store keeps `expanded[]`; `buildSimulationGraph` merges base graph + expansions
  (dedupe by id; base graph wins). Detail panel "Expand" per link field. Expansions are cleared when
  the query hash changes.
- Specs + e2e: expand returns neighbours, respects `exclude`, rejects foreign-base.

### 3.2 Pre-read ETag + cache

- **GATE P3-A**: confirm no record-level permission plan (design Q4). If there is one, the probe
  must be built on `RecordPermissionService.getReadQuerySource` first.
- [ ] `graph-etag.service.ts`: per plan table, build the filtered query with
  `recordService.buildFilterSortQuery(tableId, { viewId, ignoreViewQuery, filter })` (public), then
  `select count(*) as n, max(coalesce(__last_modified_time, __created_time)) as m`. Also include
  field meta `lastModifiedTime` for the plan's fields (renames/type changes) and `queryHash`.
  `etag = "bg4-" + sha1(all of that)`.
- [ ] Cache: `CacheService` with a new typed key
  `` [key: `base-graph:${string}`]: IBaseGraphVo `` in `cache/types.ts`; key
  `base-graph:<baseId>:<queryHash>:<etag>`, TTL `BASE_GRAPH_CACHE_TTL`.
- [ ] `query()` flow: probe → `If-None-Match` hit → 304 without reading rows; cache hit → return
  cached; else read + assemble + store.
- [ ] Node detail ancestors: look up the latest cached graph for any query containing the table
  (store a small `base-graph-ancestors:<baseId>:<tableId>` map when assembling) — fall back to the
  walk.
- Verify in e2e: unchanged data → 304; edit a record → new ETag; delete a record → new ETag; toggle
  a link on record A (symmetric field on B changes) → new ETag; rename the primary field → new ETag.
  **If any of these fail, the probe is incomplete — do not ship it; keep full-read ETag.**

### 3.3 Freshness on the client

- [ ] `refetchOnWindowFocus: true` for `useBaseGraph` (cheap now).
- [ ] `useGraphLiveInvalidation(tableIds)`: renders one `<TableListener tableId>` per included table
  using SDK `useTableListener(tableId, ['addRecord','setRecord','deleteRecord'], cb)`; `cb`
  debounced 2s → `invalidateQueries(baseGraph(baseId))`. Hard cap: listeners only when ≤ 20 tables.

### 3.4 Large-graph rendering

- [ ] Add `react-force-graph-2d` (new dependency — same author/version line as the 3D package,
  confirm version pin matches `1.29.x` family) and a toolbar toggle `3D / 2D`; auto-suggest 2D above
  3000 visible nodes. Loaded via `next/dynamic` like the 3D canvas.
- [ ] Check `.size-limit.js` still passes (graph code must stay out of the initial chunk).

**GATE P3** — a filtered `finance_Transactions` graph (≥ 5k rows in the table) loads in < 2s on the
dev stack, a repeat load is a 304, and edits in the grid show up within ~3s without a manual refresh.

---

## Phase 4 — Integration & retirement (~3 days)

- [ ] **Saved presets**: save / rename / delete current query as a preset in `localStorage`
  (`base-graph:presets:<baseId>`, try/catch around every access). Optional: "Share to base" writes a
  row to a `graph_presets` table (name, JSON) if the user creates it — read it through the normal
  record API; no schema created automatically.
- [ ] **Deep links**: "Show in graph" in the table view header menu (`q` = that table + current
  view) and in the expand-record menu (`focus=rec:…`, table + its linked tables).
- [ ] **MCP tools** (`features/mcp/tools/graph.tools.ts`, registered in `tool-registry.ts`):
  `get_graph` (RO as input, trimmed output: nodes `{id,label,tableId}`, links, stats) and
  `get_record_neighbors` (expand). Both call `BaseGraphService` in-process, so PAT scoping and
  permissions are the existing path. Add to the tool-registry spec and manifest test.
- [ ] **Retire the old feature**:
  1. `knowledge-graph.tsx` → `getServerSideProps` returns `redirect` to `/base/:id/graph?preset=knowledge`
     (pattern: `pages/base/[baseId]/[[...slug]].tsx:59`).
  2. Delete the files listed in §1 "Deleted"; move remaining shared helpers first.
  3. Remove `KNOWLEDGE_*` env keys from Joi and any `.env*` examples.
  4. `grep -rn "knowledge-graph\|knowledgeGraph\|KNOWLEDGE_" apps packages` → only the redirect.

**GATE P4** — full `npm run build && npm test` green; old URL redirects; MCP `get_graph` works from
Claude Code against the dev instance.

---

## 5. Test matrix

| Layer | Suite | Phase |
|---|---|---|
| Contract | RO/VO zod snapshots | 1 |
| Backend unit | resolver, reader, budget, structure, edges, assembler parity | 1 |
| Backend unit | etag service (probe composition), expand | 3 |
| Backend e2e | `base-graph.e2e-spec.ts` cases 1–11, + etag + expand | 1, 3 |
| Frontend unit | codec, store isolation, simulation graph, theme, panels, presets | 2 |
| Manual | GATE P2 / P3 checklists on `data-centre` | 2, 3 |
| MCP | tool-registry spec, manifest, live call | 4 |

## 6. Risks

| Risk | Mitigation |
|---|---|
| View filter + ad-hoc filter not ANDed by the record layer | e2e case 4 decides; AND in resolver if needed |
| `__last_modified_time` not bumped on symmetric link changes or deletes | GATE in 3.2: ship the probe only if every e2e freshness case passes |
| `cellValue2String` slow for large formula/lookup primaries | label read is one projection; measure in GATE P3, fall back to `cellFormat: Text` for the primary via a second lightweight read if needed |
| Graph for all 21 tables exceeds render budget | defaults exclude system tables, per-table limits, 2D mode, expand-on-demand |
| URL too long with complex filters | 6 KB cap → local preset |
| Parity drift between old and new knowledge graph during Phase 2–3 | parity spec + e2e case 9 run in CI until Phase 4 deletes the old path |
| Permission bypass via new endpoints | every table/field/view id checked against `:baseId` in one resolver; all reads via `RecordService`; cross-base links skipped |

## 7. Rollback

Phases 1–3 are additive: new module, new routes, new page. Reverting is removing
`BaseGraphModule` from `app.module.ts` and the sidebar link. Phase 4 is the only destructive step
and happens last, in its own commit, so it can be reverted alone.

## 8. Estimate

| Phase | Days |
|---|---|
| 0 | 0.5 |
| 1 | 5–6 |
| 2 | 5–6 |
| 3 | 4 |
| 4 | 3 |
| **Total** | **~18–20** |
