# Cybernetics Data Centre — System Architecture & Request Flow

> Analysis of how the NestJS backend serves the Next.js frontend, the four data
> paths between them, and the internal layering of each tier.
>
> Branch at time of writing: `feat-better-branding` · commit `b15a6f3`

---

## Contents

1. [Repo topology](#1-repo-topology)
2. [The core serving model — one process, one port](#2-the-core-serving-model--one-process-one-port)
3. [Request routing](#3-request-routing)
4. [The four data paths](#4-the-four-data-paths)
5. [Backend internal layering — two generations](#5-backend-internal-layering--two-generations)
6. [Data layer](#6-data-layer)
7. [Dev vs. prod](#7-dev-vs-prod)
8. [End-to-end boot sequence](#8-end-to-end-boot-sequence)
9. [Operational notes and traps](#9-operational-notes-and-traps)

---

## 1. Repo topology

pnpm workspace — `apps/*`, `packages/*`, `packages/v2/*`, `plugins`. A Teable
fork rebranded as Cybernetics Data Centre.

| Workspace | Package name | Role |
|---|---|---|
| `apps/nestjs-backend` | `@teable/backend` | **The HTTP server.** Owns port 3000 and *hosts Next.js in-process* |
| `apps/nextjs-app` | `@teable/app` | React / Next 16 UI (pages router) — a **library** to the backend, not a server |
| `apps/mastra-ai` | `mastra-ai` | Separate AI agent runtime (Mastra) |
| `apps/nextjs-statics` | — | Static docs / homepage content, no package manifest |
| `plugins` | `@teable/plugin` | Separate Next app for iframe-embedded plugins (charts, sheet-form, …) |
| `packages/core` | `@cybernetics/core` | Domain primitives: `IdPrefix`, zod field/view schemas, `FieldOpBuilder` / `ViewOpBuilder`, formula AST |
| `packages/openapi` | `@teable/openapi` | **The contract**: route constants + zod request/response schemas + `createAxios()`. Imported by *both* controller and client |
| `packages/sdk` | `@cybernetics/sdk` | React contexts / hooks / models + the ShareDB client connection |
| `packages/db-main-prisma` | `@teable/db-main-prisma` | Prisma client for **metadata** |
| `packages/db-data-prisma` | `@teable/db-data-prisma` | Prisma client for **physical row data** |
| `packages/ui-lib`, `icons`, `common-i18n`, `i18n-keys`, `formula` | | Shared presentation / i18n / expression layers |
| `packages/v2/*` | `@teable/v2-*` | ~40 packages: a hexagonal / CQRS rewrite running *alongside* v1 |

---

## 2. The core serving model — one process, one port

This is the single most important fact about the system, and it is not obvious
from the directory layout:

> **NestJS is the only HTTP server. Next.js runs inside it as an embedded library.**

`apps/nestjs-backend/src/features/next/next.service.ts:24-31`

```ts
this.server = createServer({          // ← `next` used as a Node API, not a CLI
  dev: nodeEnv !== 'production',
  port,
  dir: nextJsDir,                     // NEXTJS_DIR=../nextjs-app
  hostname: 'localhost',
  turbopack: true,
});
await this.server.prepare();          // called from NestJS onModuleInit()
```

`apps/nestjs-backend/src/features/next/next.controller.ts:52-81` — a
`@Controller('/')` carrying an explicit route **allowlist**, handing each match
to Next's request handler:

```ts
@Get(['/', 'favicon.ico', '_next/*', '__nextjs*', 'images/*', 'streamsaver/*',
      'home', '404/*', '403/?*', '402/?*', 'space/?*', 'auth/?*', 'waitlist/?*',
      'base/?*', 'invite/?*', 'share/?*', 'setting/?*', 'admin/?*', 'oauth/?*',
      'developer/?*', 'public/?*', 'enterprise/?*', 'unsubscribe/?*',
      'integrations/authorize/?*', 't/?*'])
public async home(@Req() req: Request, @Res() res: Response) {
  await this.nextService.server.getRequestHandler()(req, res);
}
```

### Consequences that shape everything downstream

- **No CORS anywhere.** The browser's axios uses `baseURL: '/api'` — relative,
  therefore same-origin by construction.
- **No reverse proxy, no separate frontend deploy.** Production is one
  `node apps/nestjs-backend/dist/index.js`.
- **A new top-level page route must be added to that allowlist**, or Nest 404s
  it before Next ever sees the request. This is the most common surprise when
  adding pages.
- **Shared env files.** `src/configs/config.module.ts:41-51` resolves env paths
  as `path.join(process.cwd(), NEXTJS_DIR, str)` — so the *backend* reads
  `apps/nextjs-app/.env.development.local` → `.env.development` → `.env`.
  One env set serves both tiers.

---

## 3. Request routing

```
                        ┌──────────── :3000 — single Express/Nest server ───────────┐
                        │                                                            │
                        │  ClsMiddleware  →  RequestInfoMiddleware                   │
 browser ───────────────┤  AuthGuard  →  PermissionGuard  →  RouteTracingInterceptor │
                        │                                                            │
 GET /space/spcXxx ─────┼──► NextController ──► next.getRequestHandler()  ── SSR     │
 GET /_next/static/… ───┼──► NextController ──► Next static assets                   │
 GET /api/table/…/record┼──► RecordOpenApiController ──► services ──► Prisma / Knex  │
 POST /api/v2/tables ───┼──► V2Controller (oRPC) ──► v2 CommandBus ──► v2 adapters   │
 WS  /socket ───────────┼──► WsGateway (SockJS) ──► ShareDbService                   │
                        │                                                            │
                        └────────────────────────────────────────────────────────────┘
```

44 controller prefixes, all under `api/…`. Two hand-crafted escape hatches:
`/streamsaver/mitm.html` and `/streamsaver/sw.js` receive bespoke CSP and
`Service-Worker-Allowed` headers *before* delegating to Next
(`next.controller.ts:16-49`) — the default CSP would otherwise block the
Service Worker registration that StreamSaver needs for large exports.

---

## 4. The four data paths

### Path A — SSR first paint (loopback HTTP to itself)

Every page composes three higher-order functions. From
`apps/nextjs-app/src/pages/base/[baseId]/[[...slug]].tsx:47-49`:

```ts
export const getServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => { … })
  )
);
```

1. **`withEnv`** (`src/lib/withEnv.ts`) — injects runtime config into props:
   `storage`, `driver`, `publicOrigin`, `sentryDsn`, `socialAuthProviders`,
   `maxSearchFieldCount`, trash retention, feature flags. This is how server
   env reaches the browser without `NEXT_PUBLIC_` variables.

2. **`withAuthSSR`** (`src/lib/withAuthSSR.ts:43-44`) — builds an `SsrApi` and
   forwards the browser's cookie verbatim:

   ```ts
   const ssrApi = new ssrClass();
   ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
   ```

   `SsrApi`'s axios has `baseURL = http://localhost:${process.env.PORT}/api`
   (`src/backend/api/rest/axios.ts:5`).

   **SSR therefore calls the backend over real HTTP to its own port** — not via
   direct dependency injection. Marginally slower than an in-process call, but
   it means SSR traverses the identical `AuthGuard` / `PermissionGuard` chain as
   any external client. Zero authorization logic is duplicated.

3. Results are pre-seeded into a `@tanstack/react-query` `QueryClient` and
   dehydrated into props, so the browser hydrates without a refetch waterfall.

4. Error mapping in `withAuthSSR`:

   | Upstream status | SSR outcome |
   |---|---|
   | `401` | redirect → `/auth/login?redirect=<original url>` |
   | `402` / `403` | `props.httpError` → renders `HttpErrorPage`, status preserved |
   | `404` | `{ notFound: true }` |
   | other | rethrow → Next error page |

### Path B — Client REST

`@teable/openapi` is the shared contract. The controller validates with
`ZodValidationPipe(schema)`; the client imports the *same* zod schema and the
*same* route constant (e.g. `GET_RECORDS_URL`). Type drift between tiers is
structurally impossible. `@cybernetics/sdk` wraps these calls in React Query hooks
and context providers.

`packages/openapi/src/axios.ts` additionally carries a response interceptor that
distinguishes genuine network failures from server errors, and an
`AsyncLocalStorage`-based request-scoped axios instance (keyed on `globalThis`
to survive pnpm's duplicated module instances) so server-side tools inherit the
caller's authentication.

### Path C — Realtime (ShareDB over SockJS)

**Client** — `packages/sdk/src/context/app/useConnection.tsx`:

```
AppProvider
  └─ ConnectionProvider
       └─ useConnection(wsPath)
            └─ ReconnectingSockJS(`${window.location.origin}/socket`)
                 └─ new Connection(socket)      ← sharedb/lib/client
```

Documents are subscribed per `IdPrefix` collection — `rec…`, `fld…`, `viw…`.

**Server** — `apps/nestjs-backend/src/ws/ws.gateway.ts:36-56`: a sockjs server
with `prefix: '/socket'`, `transports: ['websocket', 'xhr-streaming']`,
`response_limit: 2 MB`, then `installHandlers(nestHttpServer)` — it **shares
Nest's HTTP server**. Each connection is wrapped in a `WebSocketJSONStream` and
passed to `shareDb.listen(stream, request)`.

Authentication is the subtle part: SockJS stores the originating HTTP request in
a different place per transport, so `getRequestFromConnection()` digs it out of
`_session.recv.request` (XHR transports) or
`_session.recv.ws._driver._request` (WebSocket, via faye-websocket) to recover
cookies for `authMiddleware`. The fallback path loses cookies and logs a
warning — worth checking first when realtime auth misbehaves behind a new proxy.

**Write fan-out** — how a plain REST `PATCH` reaches every open browser
(`src/share-db/share-db.service.ts:80-98`):

```
  service mutates rows inside a Prisma transaction
      │
      │  ops accumulate in CLS:  cls.get('tx.rawOpMaps')
      ▼
  prismaService.bindAfterTransaction(…)        ← fires on COMMIT only
      │
      ├─► updateTableMetaByRawOpMap()          bump lastModifiedTime
      ├─► publishOpsMap()                      Redis pub/sub when
      │                                        BACKEND_CACHE_REDIS_URI is set
      │                                        (→ multi-instance fan-out)
      ├─► eventEmitterService.ops2Event()      listeners, webhooks, notifications
      └─► performanceCacheService.del(keys)    invalidate derived caches
```

Ops are published strictly post-commit, so no client ever observes a
rolled-back write.

### Path D — Plugins

`plugins/` is a standalone Next app — port 3002 in dev, `plugins/server.js` in
prod. The backend carries a `NextPluginModule`; the SDK exposes `plugin-bridge`
for iframe `postMessage`. `next.config.js` sets
`frameSrc: ["'self'", 'blob:', '*']` in the CSP to permit embedding, and the
base page explicitly sets `Content-Security-Policy: frame-ancestors *;` so a
base can itself be embedded.

---

## 5. Backend internal layering — two generations

### v1 "features"

40+ directories under `src/features/`, all following one shape:

```
features/record/
  open-api/record-open-api.controller.ts     ← HTTP surface, zod pipes, swagger
  open-api/record-open-api.service.ts        ← orchestration
  open-api/record-open-api-v2.service.ts     ← v2-backed variant
  record.service.ts                          ← data access
  record-query.service.ts
  record-permission.service.ts
  record-modify/{create,update,delete,duplicate}.service.ts
  query-builder/                             ← visitor-pattern SQL generation
  computed/                                  ← formula/rollup dependency graph
                                                + polling worker
```

Dialect-specific SQL lives outside the features, in
`src/db-provider/{aggregation,filter,sort,group,search,select,index,integrity}-query/`.

### v2 hexagonal / CQRS

Lives in `packages/v2/*`, bridged into Nest through `src/features/v2/`:

- **`V2ContainerService`** builds and caches a tsyringe container via
  `registerV2NodePgDependencies()` (`packages/v2/container-node/src/index.ts`) —
  wiring `MemoryCommandBus`, `MemoryQueryBus`, `AsyncMemoryEventBus`, the
  Postgres adapters, the Papaparse CSV parser, the `.tea` parser, and the
  computed-update polling service.
- **`V2Controller`** (`@Controller('api/v2')`) uses `@orpc/nest`'s
  `@Implement(v2Contract.tables)` and delegates to handlers such as
  `executeCreateTableEndpoint(context, input, commandBus)` from
  `@teable/v2-contract-http-implementation`. ORPC error codes are mapped from
  HTTP status by `throwOrpcErrorByStatus`.
- **`V2ExecutionContextFactory`** maps the Nest CLS request context into a v2
  execution context (user, base, permissions).
- **`v2-projection-registrar.ts`** is the seam between generations: providers
  decorated `@V2ProjectionRegistrar()` are discovered at bootstrap and attached
  to the shared container. v2 domain events are projected back into ShareDB ops,
  source-tagged `@@v2-projection`, so v2 writes still light up the v1 realtime
  layer. The UI cannot tell which engine served a given mutation.
- Compatibility shims (`v2-view-compat`, `v2-field-delete-compat`,
  `v2-base-node-compat`, `v2-record-history`, `v2-user-rename-propagation`)
  reconcile v2 semantics with v1 expectations during the cutover.

### Cross-cutting concerns

Registered in `src/global/global.module.ts`:

| Concern | Mechanism |
|---|---|
| Auth | Global `APP_GUARD` → `AuthGuard`, a passport chain `session → access-token → jwt → anonymous`; bypassed by `@Public()`, gated by `@AllowAnonymous`, redirect-on-fail via `@EnsureLogin` |
| Authorization | Global `APP_GUARD` → `PermissionGuard` |
| Request context | `ClsMiddleware` with request-id derived from the active OTel trace id (falls back to `nanoid`), plus `RequestInfoMiddleware` |
| i18n | `nestjs-i18n`, resolvers in order: `?lang` → `NEXT_LOCALE` cookie → `Accept-Language` → `x-lang` header |
| Tracing | `RouteTracingInterceptor` (`APP_INTERCEPTOR`), OTel bootstrapped in `src/tracing.ts` |
| Errors | `GlobalExceptionFilter` |
| Hardening | `helmet({ hsts: false })` — HSTS is set at the WAF to avoid duplicate headers with divergent max-age |
| Body limits | `json` and `urlencoded` at 50 MB; Next proxy body limit 1024 MB for `.tea` imports |
| API docs | Swagger via `setupSwagger()` unless `API_DOC_DISENABLED` |

---

## 6. Data layer

Two Prisma clients behind one router
(`src/global/database-router.service.ts`):

| Target | Prisma service | Knex token | Contents |
|---|---|---|---|
| meta | `MetaPrismaService` (`@teable/db-main-prisma`) | `META_KNEX` | spaces, bases, tables, fields, views, users, ops |
| data | `DataPrismaService` (`@teable/db-data-prisma`) | `DATA_KNEX` | the physical per-table row tables |

`DatabaseRouter` exposes `metaPrisma()`, `dataPrisma()`, `metaKnex()`,
`dataKnex()`, and `getDatabaseUrl('meta' | 'data')`.

Defaults to a single `PRISMA_DATABASE_URL`; split deployments override with
`PRISMA_META_DATABASE_URL` / `PRISMA_DATA_DATABASE_URL`.

> **Trap.** With one shared `DATABASE_URL`, the data Prisma client participates
> in the meta transaction. DDL issued through a *bare* client escapes that
> transaction and survives a rollback.

Redis, when `BACKEND_CACHE_REDIS_URI` is set, serves four distinct jobs:

1. `CacheModule` — general cache
2. `PerformanceCacheModule` — derived query results
3. ShareDB pub/sub (`RedisPubSub`) — cross-instance op fan-out
4. BullMQ — background queues, registered through `ConditionalModule` in
   `app.module.ts` so a Redis-less deployment still boots

---

## 7. Dev vs. prod

| | Dev | Prod |
|---|---|---|
| Launch | `cd apps/nestjs-backend && pnpm dev` — **backend only**; it boots Next itself | `scripts/start.sh` |
| Bundler | `nest start --webpackPath ./webpack.dev.js -w`; Next in dev mode with turbopack | `nest build` + `next build` |
| WebSocket | `DevWsGateway` on its **own** http server at `SOCKET_PORT=3001`; `next.config.js` `rewrites()` proxies `/socket/:path*` → `:3001` | `WsGateway` shares Nest's server; the rewrites list is `[]` |
| Port | `getAvailablePort()` walks 3000 → 3001 → … while busy | fixed |
| CSP | `NEXT_BUILD_ENV_CSP=false` | full CSP + `forceHTTPSRedirect` |
| HMR | `src/index.ts` stashes `closePromise` in `module.hot.data`, so the **new** instance awaits the old one's `app.close()` before booting — otherwise two generations race the same connection pools and background pollers | n/a |

Gateway selection is a single expression in `src/ws/ws.module.ts`:

```ts
process.env.NODE_ENV === 'production' || process.env.SERVER_PORT === process.env.SOCKET_PORT
  ? WsGateway        // shares Nest's http server
  : DevWsGateway     // standalone http server on SOCKET_PORT
```

Production entrypoint — `scripts/start.sh`:

```bash
node scripts/db-migrate.mjs                        # blocking; exits non-zero on failure
node ./apps/nestjs-backend/dist/index.js &         # Nest + embedded Next
node ./plugins/server.js &                         # plugin host
node ./apps/mastra-ai/.mastra/output/index.mjs &   # AI runtime
wait -n
```

`wait -n` means **any one process exiting brings the container down** — this is
deliberate, so the orchestrator restarts the pod rather than leaving it running
in a degraded state.

---

## 8. End-to-end boot sequence

1. `src/index.ts` → `./instrument` (Sentry) → `./tracing` (OTel) → `bootstrap()`
2. `NestFactory.create(AppModule)`. `GlobalModule` initializes first: config
   (loaded from `apps/nextjs-app/.env*`), CLS, cache, event emitter, Knex ×2,
   Prisma ×2, permissions, data loader, performance cache, i18n
3. Feature modules instantiate. `NextModule` →
   **`NextService.onModuleInit()` compiles and prepares Next** — the long pole
   on cold start
4. `WsModule` selects `WsGateway` or `DevWsGateway`. `ShareDbService`'s
   constructor attaches `authMiddleware`, the `submit` hook, and the
   after-transaction op publisher
5. `V2ContainerService` lazily builds the v2 DI container on the first
   `/api/v2` request; `@V2ProjectionRegistrar()` providers are discovered and
   attached
6. `setUpAppMiddleware()` → exception filter, validation pipe, helmet, body
   limits, Swagger, CORS if `security.web.cors.enabled`
7. `getAvailablePort()` → `app.listen(port)`; `process.env.PORT` is rewritten to
   the resolved port so `SsrApi`'s loopback baseURL stays correct
8. Both the UI and the API are live on one port

---

## 9. Operational notes and traps

### Secrets

`apps/nextjs-app/.env.development.local` holds **live credentials** — Postgres
and Redis passwords for the pgvector replica (NodePort 30898 / 30490), plus real
ElevenLabs, Vercel AI Gateway, and Cybernetics app tokens. The file is
gitignored and nothing is committed, but that file is the blast radius if it is
ever shared, pasted, or copied into a build context.

### The root `pnpm dev` script is misleading

```jsonc
"dev": "pnpm -r --parallel --stream -F @teable/backend -F @teable/app -F mastra-ai dev"
```

`@teable/app`'s own `dev` is a bare `next dev` with no `-p`, so it competes for
:3000 with the backend that **already embeds Next**. The backend's
`getAvailablePort()` then walks to :3001 — colliding with `SOCKET_PORT`.

The README's instruction is the correct path:

```sh
cd apps/nestjs-backend && pnpm dev
```

The root script only makes sense with `BACKEND_SKIP_NEXT_START=true`
(`next.service.ts:38`), which nothing in the repo currently sets.

### Adding a page route

A new top-level path must be added to the `@Get([...])` allowlist in
`next.controller.ts`. Without it, Nest 404s the request before Next's router is
consulted — and the failure looks like a Next routing bug rather than a backend
one.

### Adding an API endpoint

Three edits, in order:

1. `packages/openapi/src/<domain>/` — route constant + zod ro/vo schemas
2. `apps/nestjs-backend/src/features/<domain>/open-api/` — controller method
   with `ZodValidationPipe`, plus the service method
3. `packages/sdk/src/` — the React Query hook, if the browser needs it

Because both tiers import the same schema, a mismatch is a compile error rather
than a runtime surprise.
