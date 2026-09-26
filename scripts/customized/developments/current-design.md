
# MCP Server — Detailed Design

Status: **design finalized — open questions resolved, ready for Phase 1**
Branch: `feat-mcp-server`
Companion: `todo-list` (execution order), `current-implementation-plan.md` (written in Phase 1)

Every signature, path and line reference below was read out of the working tree on this branch.

---

## 0. Locked decisions

| # | Decision | Chosen | Consequence |
|---|---|---|---|
| D1 | Direction | **Server only** — we expose our data to external MCP clients | No MCP *client* registry, no outbound credential vault, no tool-approval UX in chat |
| D2 | Placement | **`apps/nestjs-backend/src/features/mcp`** | Reuses `AuthGuard`, `PermissionService`, cls store and the open-api services in-process. No network hop, no duplicated permission logic, same deploy artifact |
| D3 | Auth | **PAT bearer now, OAuth 2.1 in phase 2** | Works today with Claude Code / Cursor / any header-capable client. One-click connectors in Claude web/Desktop wait for phase 2 (§11) |
| D4 | Tool surface | **CRUD + additive schema. Irreversible schema ops excluded** | See D5 |
| D5 | v1 exclusions | **`delete_field`, `delete_table`, `update_field`/`convertField` are OUT** | This is the decision that shaped §6. It removes every *irreversible* operation from the surface, which in turn makes the confirm-token machinery unnecessary — see §6.1 |
| D6 | Read-only default | `MCP_READONLY=false` | Writes are on by default; operators opt *out*, not in |
| D7 | Settings page | **Instance-wide `/setting/mcp`** | Confirmed possible — §8.2. No `baseId` in client setup |

---

## 1. Goal and non-goals

### Goal
A single Streamable-HTTP MCP endpoint on the existing backend that lets an authenticated external
AI client discover and operate on the spaces, bases, tables, fields, views and records that
**the presenting personal access token is already allowed to touch — never more**.

### Non-goals
- Not an MCP **client**. Nothing here connects outward. (D1)
- Not stdio. HTTP only; a stdio shim is a phase-3 convenience.
- Not OAuth 2.1 / dynamic client registration in v1. (D3, §11)
- Not MCP **resources** or **prompts** in v1 — tools only.
- No new permission *concepts*. This feature introduces **zero** new `Action` values. If a tool
  cannot be expressed with the existing vocabulary in `packages/core/src/auth/actions.ts`, it does
  not ship in v1.

---

## 2. What already exists (verified)

| Capability | Where | Why it matters here |
|---|---|---|
| Express-based Nest app, global `json({limit:'50mb'})` | `src/bootstrap.ts:27` | `StreamableHTTPServerTransport.handleRequest(req,res,req.body)` accepts a pre-parsed body, so the global parser helps rather than obstructs |
| Multi-strategy auth chain `session → access-token → jwt → anonymous` | `features/auth/guard/auth.guard.ts:18-23` | A PAT in `Authorization: Bearer` already authenticates. **No new strategy is needed** |
| PAT validation sets `user.*` + `accessTokenId` into cls | `features/auth/strategies/access-token.strategy.ts:52-56` | The dispatcher reads `cls.get('accessTokenId')` to scope every tool call |
| PATs carry `scopes: Action[]`, `spaceIds`, `baseIds`, `hasFullAccess`, expiry | `features/access-token/access-token.service.ts:26-59` | The whole scoping model already exists. MCP reuses it verbatim |
| `PermissionService.validPermissions(resourceId, actions, accessTokenId)` | `features/auth/permission.service.ts:437-450` | **The single authorization primitive this design is built on.** Resolves the user's role permissions (walking table→base→space), intersects with PAT scopes, enforces `spaceIds`/`baseIds`, throws `RESTRICTED_RESOURCE` otherwise |
| The same primitive is already called *imperatively* outside a guard | `features/trash/trash.service.ts:779-784` | Confirms §4's approach is idiomatic here, not a workaround invented for MCP |
| `@TokenAccess()` metadata flag | `features/auth/decorators/token.decorator.ts:3-5` | The escape hatch that lets a PAT reach a route carrying no `@Permissions` — §4.1 |
| **Table-level trash with restorable snapshots for View / Field / Record** | `features/trash/listener/table-trash.listener.ts:30-95`, `trash.service.ts:750+` | **The finding that reshaped §6.** Record deletes write `tableTrash` + per-record `recordTrash` snapshots; `restoreTableResource` restores them |
| `operationId` is generated unconditionally on record delete | `features/record/record-modify/record-delete.service.ts:77` | The listener's `if (!operationId) return;` guard never trips on this path, so trash capture does **not** depend on `windowId` being passed |
| OAuth 2.1 authorization server with PKCE | `features/oauth/oauth-server.controller.ts` | Phase 2 builds on this rather than standing up a new AS |
| `@modelcontextprotocol/sdk@1.29.0` already in the pnpm store (via `@mastra/mcp`) | `node_modules/.pnpm` | Promoting it to a direct dependency costs no new download |
| Settings UI pattern `pages/setting/<x>.tsx` → `features/app/blocks/setting/<x>/` | `apps/nextjs-app/src/pages/setting/personal-access-token.tsx` | The MCP page follows this exactly; `ScopesSelect` and `AccessTokenForm` are reusable |

---

## 3. Architecture

### 3.1 Shape

```text
External MCP client (Claude Code / Desktop / Cursor)
   │  HTTP POST /api/mcp     Authorization: Bearer teable_xxx
   ▼
AuthGuard  ──► access-token strategy ──► cls: user.id, accessTokenId
   │
PermissionGuard ──► route has no @Permissions + @TokenAccess() ⇒ PASS THROUGH (§4.1)
   │
McpController.handle()
   │
StreamableHTTPServerTransport  (stateless: sessionIdGenerator undefined)
   │
McpServer ──► tool dispatch
   │
ToolRegistry: for the invoked tool
   1. zod-parse args
   2. resolveResource(args) ──► resourceId  (spc… / bse… / tbl…)
   3. PermissionService.validPermissions(resourceId, tool.requiredActions, accessTokenId)
   4. cls.set('permissions', ownPermissions)         ◄── MANDATORY, §4.3
   5. tool.execute(args, services)
   │
Existing open-api services (Table / Field / Record / View) — unmodified
```

### 3.2 Transport: stateless, deliberately

`StreamableHTTPServerTransport` is constructed **per request** with `sessionIdGenerator: undefined`
(stateless mode), and disposed when the response closes.

- No server-side session map, so no sticky-session requirement. This matters: this runs on k3s where
  replica count is not pinned to 1, and a session map would silently break the moment a second
  replica appears.
- `GET /api/mcp` and `DELETE /api/mcp` return **405** with a JSON-RPC error body. Stateless mode has
  no server→client stream to resume and no session to terminate; 405 is spec-correct and more honest
  than a 404 that reads as "wrong URL".
- Cost: no server-initiated notifications (no `notifications/tools/list_changed`). Acceptable — the
  tool list is static per deployment.

### 3.3 Files to add

```text
apps/nestjs-backend/src/features/mcp/
  mcp.module.ts
  mcp.controller.ts            # POST /api/mcp (+405 GET/DELETE), thin
  mcp.service.ts               # builds McpServer + transport per request
  tool-registry.ts             # IMcpTool contract + registry + the authorize() pipeline
  tools/
    discovery.tools.ts         # list_spaces, list_bases, list_tables, get_table_schema, list_views
    record.tools.ts            # query/get/create/update/delete records
    schema.tools.ts            # additive table/field/view ops (§5)
  types.ts
  mcp.manifest.controller.ts   # GET /api/mcp/manifest — REST, for the settings UI

packages/openapi/src/mcp/
  get-manifest.ts              # zod contract + typed client for the manifest
  types.ts
  index.ts

apps/nextjs-app/src/pages/setting/mcp.tsx
apps/nextjs-app/src/features/app/blocks/setting/mcp/
  McpPage.tsx
  ToolCatalogue.tsx
  ConnectionSnippet.tsx
```

`app.module.ts` gains `McpModule`. Nothing else in the backend is edited — strictly additive, which
keeps the review surface small and the revert trivial.

---

## 4. Authorization — the core of this design

### 4.1 Why the existing guard cannot do this job

`PermissionGuard` is **decorator-driven and per-HTTP-route**. It reads required actions from
`@Permissions(...)` and the resource id from `req.params.baseId | spaceId | tableId`
(`permission.guard.ts:34`, `:241-245`).

An MCP endpoint is **one route dispatching N logically distinct operations**. At guard time the body
has not been interpreted: there is no `req.params.tableId`, and required actions differ per tool. The
decorator model structurally cannot express *"this call needs `field|create` on the table named in
`params.arguments.tableId` of a JSON-RPC envelope."*

So the route carries **no `@Permissions`**, and authorization moves into the dispatcher. The guard
already anticipates exactly this:

```ts
// permission.guard.ts:246-254
const accessTokenId = this.cls.get('accessTokenId');
if (accessTokenId && !permissions?.length) {
  // The token can only access interfaces that are restricted by permissions
  // or have a token access indicator.
  return this.reflector.getAllAndOverride<boolean>(IS_TOKEN_ACCESS, [...]);
}
```

**`@TokenAccess()` on the MCP controller is the sanctioned hook**, not a workaround. And the pattern
of calling `validPermissions` imperatively is already established in this codebase —
`trash.service.ts:779` does exactly this.

> Review gate: `@TokenAccess()` without `@Permissions` means *the guard authorizes nothing*. Any tool
> reaching `execute()` without passing through `authorize()` is an unauthenticated data path.
> §10.3 makes this a mechanically enforced test, not a code-review hope.

### 4.2 The tool contract

```ts
export interface IMcpTool<TArgs extends z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: TArgs;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  /** Actions the caller must hold on the resolved resource. Empty array is ILLEGAL. */
  requiredActions: Action[];
  /** Which id in the args is the permission subject. Returns spc… | bse… | tbl… */
  resolveResource(args: z.infer<TArgs>): string | Promise<string>;
  execute(args: z.infer<TArgs>, ctx: IMcpToolContext): Promise<unknown>;
}
```

`requiredActions` uses only values from `packages/core/src/auth/actions.ts` — verified vocabulary:
`space|read`, `base|read`, `table|create|read|update|delete`, `field|create|read|update|delete`,
`view|create|read|update|delete`, `record|create|read|update|delete`.

A registry-construction assertion rejects any tool with empty `requiredActions`, so "I forgot to
declare permissions" fails at boot, not in production.

### 4.3 The mandatory `cls.set('permissions', …)` step

`validPermissions()` **returns** the caller's effective permissions, and `PermissionGuard` stores
them (`permission.guard.ts:206`). Several services read them back:

- `table-open-api.service.ts:833` — `new Set(this.cls.get('permissions'))`
- `base.service.ts:542`, `selection.service.ts:476`, `record-open-api-v2.service.ts:902`

Because the MCP route bypasses the guard, **the dispatcher must replicate line 206**:

```ts
const ownPermissions = await this.permissionService.validPermissions(
  resourceId, tool.requiredActions, this.cls.get('accessTokenId')
);
this.cls.set('permissions', ownPermissions);   // ← omitting this is a silent bug
```

Omitting it does not throw. `cls.get('permissions')` returns `undefined` and the consumers degrade
quietly — `table-open-api.service.ts:833` builds an empty Set and reports a table as having no
permissions; `record-open-api-v2.service.ts:902` falls back to `?? []`. The failure mode is **wrong
output with a 200 status**, the worst kind. Highest-value line in the feature; dedicated test in §10.3.

Correspondingly, because each tool call re-sets cls state within one HTTP request, **batched JSON-RPC
calls must execute sequentially, never with `Promise.all`** — concurrent calls would interleave writes
to a single request-scoped cls store and cross-contaminate permissions. The dispatcher enforces this.

### 4.4 Defence in depth

The PAT restriction is enforced twice, intentionally:

1. `getPermissionsByAccessToken` (`permission.service.ts:247+`) throws if `resourceId` falls outside
   the token's `spaceIds` / `baseIds`.
2. `getPermissions` intersects token scopes with the user's actual role permissions
   (`permission.service.ts:432`), so a token can never exceed the human who minted it — even if that
   human is later demoted.

Discovery tools have no single resource to check. They call `SpaceService.getSpaceList()` /
`BaseService.getAllBaseList()`, which already filter by caller, then additionally pass through
`SpaceService.filterSpaceListWithAccessToken` (`space.service.ts:117`). **Enumeration must never leak
names of out-of-scope resources** — listing is a disclosure surface and is treated as one.

---

## 5. Tool catalogue (v1)

`R` = readOnlyHint · `D` = destructiveHint

### Discovery
| Tool | Actions | Resource | Backed by |
|---|---|---|---|
| `list_spaces` R | `space\|read` | — (list-filtered) | `SpaceService.getSpaceList()` :132 |
| `list_bases` R | `base\|read` | `spaceId?` | `getBaseListBySpaceId` :258 / `getAllBaseList` :152 |
| `list_tables` R | `table\|read` | `baseId` | `TableOpenApiService.getTables` :312 |
| `get_table_schema` R | `table\|read`, `field\|read` | `tableId` | `getTable` :308 + `FieldOpenApiService.getFields` :551 |
| `list_views` R | `view\|read` | `tableId` | view service |

### Records
| Tool | Actions | Resource | Backed by |
|---|---|---|---|
| `query_records` R | `record\|read` | `tableId` | `RecordService.getRecords` :1033 |
| `get_record` R | `record\|read` | `tableId` | `RecordService.getRecord` :1075 |
| `create_records` | `record\|create` | `tableId` | `multipleCreateRecords` :65 |
| `update_record` idempotent | `record\|update` | `tableId` | `updateRecord` :172 |
| `delete_records` D | `record\|delete` | `tableId` | `deleteRecords` :213 — **recoverable via trash**, §6.2 |

### Schema — additive only (D5)
| Tool | Actions | Resource | Backed by |
|---|---|---|---|
| `create_table` | `table\|create` | `baseId` | `createTable` :220 |
| `update_table` | `table\|update` | `tableId` | `updateName` :599 / `updateDescription` :611 — metadata only |
| `create_field` | `field\|create` | `tableId` | `createField` :1330 |
| `create_view` | `view\|create` | `tableId` | `ViewOpenApiService.createView` :86 |
| `delete_view` D | `view\|delete` | `tableId` | `deleteView` :102 — **recoverable via trash** |

### Excluded from v1, with reasons

| Excluded | Reason |
|---|---|
| `delete_field` | **D5.** Irreversible in practice; field deletion cascades to dependent formulas, rollups and links |
| `delete_table` | **D5.** Not a recoverable mistake at agent speed |
| `update_field` / `convertField` | **D5.** Type conversion loses cell data irreversibly |
| `sqlQuery` :574, base-sql-executor | Injection and unbounded-result surface deserving its own design |
| `create_base` / `delete_base`, space mutation | Blast radius beyond what PAT scoping alone should gate |
| `duplicateTable`, `duplicateBase`, import/export | Long-running work that wants a job model, not a synchronous tool call |

> **Known asymmetry, accepted.** The model can `create_table`, `create_field` and `create_view` but
> cannot delete the first two. A confused agent can therefore leave clutter that a human must remove
> through the UI. This is accepted deliberately: the failure mode is *untidy*, whereas enabling the
> deletes reintroduces the *irreversible* failure mode D5 exists to remove. Untidy is the better
> trade. Revisit only if it becomes a real operational complaint.

### 5.1 Output discipline
Record payloads are the dominant token cost and the main way an MCP server becomes useless in
practice:
- `query_records` `take` defaults to **50**, hard-capped at `MCP_MAX_RECORDS_PER_CALL` (**500**),
  applied server-side after zod parsing and never trusted from args.
- Responses always report `{ total, returned, hasMore, nextCursor? }` so the model pages
  deliberately instead of guessing.
- `fieldKeyType` is pinned to `FieldKeyType.Id` on every read path. `getRecord` defaults internally
  to `Name`, which would make `record.fields[field.id]` silently return `undefined` — a known trap
  already recorded in `current-implementation-plan.md` §0.2 R1.

---

## 6. Guardrails

### 6.1 Why there is no confirm-token machinery

An earlier draft specified a two-phase plan→confirm flow with HMAC tokens, built on the existing
`planDeleteField` / `planFieldConvert` planners. **D5 removed the tools that justified it.**

What remains destructive is `delete_records` and `delete_view` — and both are **recoverable**:

- `table-trash.listener.ts:30-58` writes a `tableTrash` row plus per-record `recordTrash` snapshots
  on every record delete; `:85` does the same for view deletes.
- `operationId` is generated unconditionally (`record-delete.service.ts:77`), so the listener's
  `if (!operationId) return;` guard never trips — capture does **not** depend on `windowId`.
- `trash.service.ts:750+` `restoreTableResource` restores both, gated on `table|trash_update`.

Building a bespoke confirm protocol on top of a recovery path that already exists would be
complexity that buys nothing. **The trash is the undo mechanism.** Dropping the confirm flow removes
a file, a set of unit tests, and two-phase complexity from every destructive tool.

*Open verification (Phase 1.5): the trash retention window. If rows are pruned aggressively, "it is
recoverable" weakens and this section is revisited.*

### 6.2 What guards the destructive tools instead

1. **Permissions first.** `record|delete` / `view|delete` must be held on the resolved resource, by
   both the user's role and the token's scopes (§4.4). This is the real control.
2. **Bounded blast radius.** `delete_records` accepts at most `MCP_MAX_DELETE_PER_CALL` (**200**)
   record ids per call. A runaway loop is throttled into many visible, individually-recoverable
   operations rather than one catastrophic one.
3. **Honest annotations.** `destructiveHint: true` so client UIs can prompt the human. These are
   hints, not security, and are never the only thing standing between a model and data loss.
4. **Recovery is discoverable.** Each destructive tool's description states that the operation is
   recoverable from the table trash, and names the UI path. The model tells the user how to undo.

### 6.3 Read-only mode
`MCP_READONLY=true` drops every non-`readOnlyHint` tool from the catalogue at registry construction.
Default is **`false`** (D6): writes are on, operators opt out. Evaluated at boot, so the tool list a
client sees is always the truth.

---

## 7. Errors

| Condition | Response |
|---|---|
| Missing / invalid / expired PAT | HTTP **401** + `WWW-Authenticate: Bearer` (prepares phase-2 resource metadata) |
| Tool not found, malformed JSON-RPC | JSON-RPC protocol error (`-32601` / `-32700`) |
| Permission denied, validation failure, business error | **`isError: true` tool result**, not a protocol error |

The last row matters. MCP convention is that *tool execution* failures come back as tool results so
the model can read the message and self-correct, while *protocol* failures abort the call. Returning
`RESTRICTED_RESOURCE` as a protocol error would leave the model unable to learn "I may not write to
that table, but I may read it."

`CustomHttpException` messages are already user-facing and i18n-keyed, so they are safe to surface.
Stack traces and raw Prisma errors never leave the process — a generic message plus a server-side log
line with a correlation id.

---

## 8. Contract and frontend

### 8.1 What belongs in `packages/openapi`
Only `GET /api/mcp/manifest` — a normal REST endpoint returning the tool catalogue (`name`, `title`,
`description`, `requiredActions`, `annotations`) for the settings UI.

The MCP endpoint itself is **JSON-RPC over Streamable HTTP and deliberately stays out of the openapi
contract and out of Swagger**. Modelling a JSON-RPC envelope as REST would produce a misleading
contract no generated client could usefully consume.

### 8.2 Instance-wide settings page — confirmed possible (D7)

**A single instance-wide endpoint works natively; no `baseId` in client setup.** The reasoning:

- The endpoint is one URL, `{publicOrigin}/api/mcp`. Reach is determined entirely by the **PAT's**
  `spaceIds` / `baseIds` (`access-token.service.ts:26-59`), resolved per call by `validPermissions`.
- Tools take `baseId` / `tableId` as **arguments**, and `list_spaces` → `list_bases` → `list_tables`
  let a client discover what its token can reach. Scoping is carried by the token, not the URL.
- So a per-base endpoint would add no security and would force users to reconfigure their client for
  every base. The fallback you sketched is not needed.

One ergonomic note: with a broad token the model spends turns discovering its way down the tree. If
that proves annoying, an **optional** `MCP_DEFAULT_BASE_ID` hint could pre-seed context. It is a
convenience only, changes no part of the security model, and is deferred out of v1.

Page structure, following `personal-access-token.tsx`:

1. **Endpoint** — `{publicOrigin}/api/mcp`, copyable.
2. **Tool catalogue** — grouped by domain, each row showing required scopes and a destructive badge,
   read from the manifest. The honest answer to "what can this thing actually do."
3. **Token** — pick an existing PAT or create one; the create path pre-selects exactly the scopes the
   chosen tool groups need, reusing `ScopesSelect` and `AccessTokenForm`. Least privilege must be the
   *easy* path or nobody takes it.
4. **Connection snippet** — `claude mcp add --transport http …` plus JSON for Desktop/Cursor. **The
   token renders exactly once, at creation**, consistent with existing PAT behaviour.

i18n strings go in `common-i18n` / `i18n-keys`. No hard-coded English.

---

## 9. Configuration

| Var | Default | Meaning |
|---|---|---|
| `MCP_ENABLED` | `true` | Master switch; when false the module registers no routes |
| `MCP_READONLY` | `false` | §6.3 (D6) |
| `MCP_MAX_RECORDS_PER_CALL` | `500` | Hard cap for `query_records.take` |
| `MCP_MAX_DELETE_PER_CALL` | `200` | Hard cap for `delete_records` (§6.2) |

---

## 10. Testing strategy

### 10.1 Unit — `vitest`, colocated `*.spec.ts`
Registry invariants, zod schemas, resource resolution, the read-only filter, and the delete cap.

> Trap: `vitest.config.ts:39` excludes `**/*.controller.spec.ts`. A file named
> `mcp.controller.spec.ts` would silently run **zero** tests and exit 0. Controller coverage lives in
> e2e. Do not create that filename.

### 10.2 E2E — `apps/nestjs-backend/test/mcp.e2e-spec.ts`
Driven by the real MCP SDK `Client` over Streamable HTTP against the booted app, with PATs minted
through the typed `@teable/openapi` clients. This proves protocol compliance against a real client
rather than against our own assumptions. Follows established conventions: `initApp()`, vitest
(`vi.fn()`, never `jest.fn()`), no supertest.

### 10.3 The permission matrix — the test that actually matters
Table-driven, and the acceptance gate for the whole feature:

| Case | Must |
|---|---|
| Token scoped to base A calls a tool on base B | **fail** `RESTRICTED_RESOURCE` |
| Token lacking `record\|delete` calls `delete_records` | **fail**, even though the user could |
| User demoted to read-only after minting a write token | **fail** (intersection, §4.4) |
| `list_bases` with a base-scoped token | returns **only** that base — no name leakage |
| `delete_records` above `MCP_MAX_DELETE_PER_CALL` | **rejected**, nothing deleted |
| `delete_records` then trash restore | records come back intact (proves §6.1's premise) |
| `MCP_READONLY=true` | catalogue contains **no** write tool |
| Every registered tool | has non-empty `requiredActions` (registry assertion) |
| Every registered tool | reached `authorize()` before `execute()` — pipeline spy, so a future tool cannot skip it |
| Excluded tools (`delete_field`, `delete_table`, `update_field`) | **absent** from the catalogue |

A DB-mutating tool that passes its happy path but fails this matrix is a **security defect**, not a
failing test.

### 10.4 Manual verification
Connect real Claude Code to a dev instance: tool discovery, one read, one write, one delete, then
restore from trash. Protocol compliance is not credible until a real client has spoken to it.

---

## 11. Phase 2 — OAuth 2.1 (designed for, not built)

Deferred by D3, but v1 must not foreclose it:
- `WWW-Authenticate` already emitted on 401 (§7) — the hook clients look for.
- Add `/.well-known/oauth-protected-resource`; honour `resource` indicators (RFC 8707).
- Reuse the existing AS at `/api/oauth/*` (`oauth-server.controller.ts`); add dynamic client
  registration (RFC 7591), the one genuinely new piece.
- Token exchange maps an OAuth grant onto the same `accessTokenId` scoping, so **§4 does not change
  at all** — only how the caller proves identity. That property is the point of putting authorization
  in the dispatcher rather than the transport.

Phase 3 candidates: the excluded schema deletes behind a stronger confirm channel, MCP resources,
`sqlQuery`, a stdio shim.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Missing `cls.set('permissions')` → silently wrong output, HTTP 200 | **High** | §4.3; dedicated test in §10.3 |
| A future tool skips `authorize()` | **High** | Pipeline spy test (§10.3); `execute()` unreachable except via the registry |
| Model bulk-deletes records | Medium | §6.2 permissions + 200/call cap + trash recovery, proven by a restore test |
| Trash retention prunes before a user notices | ~~Medium~~ **Low** | **Verified (Phase 1.3): no pruning is implemented at all.** `configs/trash.config.ts` declares `retention: 30d` but nothing reads it — no `@Cron`, no `ScheduleModule`. Rows persist until restore, explicit reset, or permanent table deletion |
| Agent clutters a base with fields/tables it cannot delete | Low | Accepted trade (§5); untidy beats irreversible |
| Enumeration leaks out-of-scope names | **Was REAL, now fixed** | **Found in review (S1).** `BaseService.getAllBaseList` filters by user but **not** by access token — unlike `SpaceService.getSpaceList`, which applies `filterSpaceListWithAccessToken` (`space.service.ts:117`). `list_bases` now applies the token's `spaceIds`/`baseIds` itself, mirroring `permission.service.ts:243-245`. Three regression tests |
| MCP is a laxer door than REST into the same services | **Was REAL, now fixed** | **Found in review (S2).** `create_table`/`create_field` skipped the zod schemas the controllers apply. Both now parse with `tableRoSchema` / `createFieldRoSchema` |
| Driver error text reaches the model | **Was REAL, now fixed** | **Found in review (S3).** Only `HttpException` messages pass through; everything else returns a generic line and logs the detail |
| `create_view` accepted any string as a view type | **Was REAL, now fixed** | **Found in live testing (S4).** The S2 fix covered `create_table` and `create_field` but missed `create_view`, which still passed args through unvalidated — a view was created with `type: "notAViewType"`. Now parses with `viewRoSchema` from `@teable/core` |
| Wrong-prefix id returns empty instead of erroring | **Was REAL, now fixed** | **Found in live testing (S5).** A `spc…` passed as `baseId` passed the permission check (the caller genuinely holds rights on that space) and then matched no tables, so the model was told "no tables" rather than "wrong id". All id arguments now validate their `IdPrefix` (`tools/ids.ts`) |
| Token bloat from large record payloads | Medium | §5.1 caps and pagination metadata |
| Stateless mode surprises a client expecting sessions | Low | 405 with an explanatory JSON-RPC error body |
| MCP SDK promoted from transitive to direct dep | Low | Already at 1.29.0 in the store; pin exactly |