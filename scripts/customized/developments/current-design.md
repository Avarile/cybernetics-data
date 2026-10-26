# Agent System Redesign: one admin agent, your own providers, tables it owns

Status: **designed 2026-10-26, not started**. Branch: `feat/agentic-database`.
Goal: `current-goal.md` (Features 1 to 5). The previous content of this file (the Twenty-style
UI redesign) is in git history: `git show HEAD:scripts/customized/developments/current-design.md`.

Every "today" statement below was read from the working tree on 2026-10-26. File paths are
relative to the repo root. `cybernetics-agents` (the LibreChat fork) was used as a reference for
provider setup, skills, memory and credentials. None of its code is copied.

---

## 1. Summary

The three chat modes in the table side panel today ("Local AI", "Knowledge Search", "RAG Search")
are replaced by **one Agent**. Only system admins can use it, and it is not limited by RBAC. It runs
inside the NestJS backend on the AI SDK 6 `ToolLoopAgent`, with the models and API keys that the admin
configures in **Admin ▸ AI Settings**, including any OpenAI-compatible or Anthropic-compatible endpoint.
Its memory, setup, threads, messages, skills and credential metadata are ordinary tables in a dedicated
**Agent base**, inside its own admin-only **Agent space**. The agent creates them on first enable and
checks them every time it starts. It reads and writes them with built-in tools, and an admin can browse and edit them like any other table. Secrets, the audit
log and the run state stay in system (Prisma) tables, out of the agent's reach. The Mastra service is
retired once its RAG pipeline has been ported.

```text
Browser (admin only)            NestJS backend                                   Storage
┌──────────────────┐  SSE   ┌───────────────────────────────────────────────┐   ┌────────────────────────┐
│ Agent panel/page │──────► │ interface   AgentController (admin guard)     │   │ main DB (Prisma)       │
│ useChat + tools  │◄────── │ application RunTurn · Threads · Memory · ...  │──►│  agent_installation    │
└──────────────────┘        │ domain      policies · ports (pure TS)        │   │  agent_secret (enc)    │
                            │ runtime     ToolLoopAgent + context builder   │   │  agent_run, audit_log  │
                            │ toolkits    memory skills data schema http …  │   ├────────────────────────┤
                            │ infra       ProviderRegistry · TableStore ·   │──►│ Agent base (Teable)    │
                            │             SecretVault · Vector · Http       │   │  agent_setup, memory,  │
                            └──────────────┬────────────────────────────────┘   │  threads, messages,    │
                                           │ AI SDK providers                   │  skills, credentials   │
                                           ▼                                    ├────────────────────────┤
                           OpenAI · Anthropic · Gateway · Ollama · vLLM · …     │ vector DB (pgvector)   │
                                                                                └────────────────────────┘
```

---

## 2. Current state (Feature 5, plus providers and chat)

### 2.1 Components

| Piece | Where | What it does |
|---|---|---|
| Chat panel | `apps/nextjs-app/src/features/app/blocks/table/chat-panel/` (`ChatPanel.tsx`, 729 lines) | Side panel in a table. Offers "Local AI" (no agent) plus the two Mastra agents listed in `types.ts` (`MASTRA_AGENTS`). The agent choice is kept per base in `localStorage`. The stream is plain text, with `\x00` separating reasoning from the answer |
| AI controller | `apps/nestjs-backend/src/features/ai/ai.controller.ts` | `api/:baseId/ai/*`: generate-stream, threads CRUD, TTS. Every route needs only `base\|read` |
| Generation | `features/ai/service/generation.service.ts` | With an `agentId`: proxies to Mastra (`streamAgent`). Without one: runs the in-process `ToolLoopAgent` (`features/ai/agents/general-agents.ts`) on the base's configured model |
| ai-data | `features/ai-data/*` | Read-only data access **as the chatting user**, limited to one base. Mastra reaches it through `POST /api/internal/ai-data/:op` with the `MASTRA_API_KEY` bearer plus a context token that lasts one turn (`ai-data-context.service.ts`) |
| Mastra service | `apps/mastra-ai/` (port 4111) | Three agents: `knowledge-manager-non-rag`, `knowledge-manager-rag`, `knowledge-manager-reactive`. The reactive agent is allowed by the backend but not offered in the UI. Every model comes from `gateway(...)` with `AI_GATEWAY_API_KEY` from env |
| Mastra storage | `VECTOR_DATABASE_URL` | `store_schema` (threads and messages), `vector_schema` (vectors), `index_schema.embedding_index` (index registry), `job_schema.ingest_job` |

### 2.2 How "Knowledge Search" works today (`knowledge-agent-non-rag.ts`)

1. The model turns the question into **one keyword**. This is a prompt rule, not code.
2. **Round 1**: `search-*-titles` runs a `title contains <keyword>` filter on a fixed table name
   (`knowledges`, `goals`, `projects`, `tasks`, `contacts`, `companies`). The names come from
   `tools/db-query/ai-data-reads.ts` `TABLES` and match the schema packs.
3. The model picks at most 5 ids. **Round 2**: `get-*-contexts` fetches `title` and `context` for those ids.
4. The model answers and cites titles. All reads go Mastra → `/api/internal/ai-data` → `AiDataService`,
   as the user, in the base the chat runs in.

In short, this is substring search on titles with an LLM in the loop. It has no semantic matching and
no ranking. It finds nothing when the wording differs from the title, and it only works in a base that
has the pack tables under their original names.

### 2.3 How "RAG Search" works today (`knowledge-agent-rag.ts`, `rag/*`, `tools/rag-query/*`)

- **Ingest**: the agent calls `ingest-document` or `synthesize-and-ingest`. The text is chunked by
  `MDocument` (recursive, 4000 chars, 400 overlap) and embedded through the Gateway
  (`openai/text-embedding-3-small`, 1536 dims). Chunks are upserted into the pgvector index named
  `indexName`, under the id `sha256(index:docName)` plus the chunk number. Re-ingesting replaces old
  chunks. The tools only check `canWrite`, meaning the user may write records in the current base.
- **Query**: `vector-query` covers one index and `all-knowledge-query` covers every active registry
  index. The query is embedded once, ANN runs (fanned out with `allSettled` across indexes), and then
  **every query is reranked by an LLM** (`claude-haiku-4.5` through the Gateway).
- **Index registry**: `index_schema.embedding_index` is seeded with `knowledge, personal, work, finance,
  family, tech, credential`. `create-index` only inserts a registry row.
- **Memory**: one `Memory` is shared by all three agents. It stores the last 30 messages, semantic
  recall (topK 8, scoped to the user), working memory, and observational memory, all on Haiku.

### 2.4 Providers today

- Teable's instance setting `aiConfig` (`packages/openapi/src/admin/setting/update.ts`) holds
  `llmProviders[] {type, name, apiKey, baseUrl, models, modelConfigs}`, plus `chatModel {lg, md, sm}`
  and an AI Gateway key. Each space can override it with an AI integration
  (`features/ai/service/ai-config.service.ts`). Model keys look like `type@model@name`.
- Only the Local AI path and Teable's field AI features use this. **Mastra ignores it** and uses
  `AI_GATEWAY_API_KEY` with hard-coded model ids.

### 2.5 Problems found

| # | Problem | Evidence |
|---|---|---|
| F1 | Two disconnected model configs. The admin's provider settings don't reach the Mastra agents | `apps/mastra-ai/src/mastra/provider.ts`, `env.ts` |
| F2 | Every instance provider is renamed `teable` on save, so two providers of the same type (Ollama + vLLM, both `openaiCompatible`) collide. `getModelConfig` returns the first one that matches type+name | `setting-open-api.service.ts` `normalizeInstanceProviderNames`; `model-resolver.service.ts` `getModelConfig` |
| F3 | Provider API keys are stored as plain JSON in `setting.content` and `integration.config`, and `GET /api/admin/setting` returns them unmasked to the browser | `setting.service.ts` `getSetting` |
| F4 | `create-index` writes only a registry row. Nothing calls `postgresVector.createIndex`, so ingesting into a new index fails (`PgVector.upsert` describes the index first). The 7 seeded indexes have no vector tables unless someone created them by hand, and `all-knowledge-query` quietly drops the failures (`allSettled`), so searches come back "no results" | `db/migrations.ts`, `memory/index.ts` (init functions commented out), `rag/vector-db.ts` |
| F5 | RAG indexes are global and the query tools don't check the user. Any user with `base\|read` anywhere can search the `personal`, `finance` and `credential` indexes. Anyone who can write in any base can soft-delete a global index | `tools/rag-query/query-tools.ts`, `index-tools.ts` |
| F6 | `ingest-document` with `extractEnrichments: true` uses `@mastra/rag`'s default LLM directly instead of the Gateway (the comment in `vector-db.ts` says so), so it needs a provider key that isn't configured | `rag/vector-db.ts` `chunkDocument` |
| F7 | Every RAG query pays an LLM rerank call on the hot path | `rag/vector-db.ts` `queryVectors` |
| F8 | The knowledge records (Teable `knowledges`) and the RAG vectors are separate stores, and nothing syncs them | `ingest-tools.ts` says it "does NOT create a structured knowledge record" |
| F9 | The `knowledge-base` SKILL.md describes tools that don't exist (`knowledge-ingest`, `knowledge-search`, `knowledge-delete`) | `apps/mastra-ai/src/mastra/skills/knowledge-base/SKILL.md` |
| F10 | Threads are listed per user across all agents and bases (`listThreads(userId)`), and the history the panel shows is text only (tool calls are lost) | `ai.controller.ts`, `mastra-client.service.ts` `normalizeMessages` |
| F11 | Three runtimes do much the same job: in-process Local AI, Mastra, and the MCP tool registry | `features/ai`, `apps/mastra-ai`, `features/mcp` |

---

## 3. Goals and non-goals

**Goals.** G1: an admin can add any provider, custom ones included, with its own key, and choose the
agent's models from them (Feature 1). G2: one general agent with unrestricted data access (Feature 2).
G3: the agent's tables are created and verified automatically and are usable out of the box (2.1, 2.2).
G4: a layered, modular codebase where adding a tool, a provider type or a store is a local change
(Feature 3). G5: admin only, enforced at every layer (Feature 4). G6: knowledge search and RAG fixed
and merged into the agent (Feature 5).

**Non-goals.** Chat for non-admin users (decided 2026-10-26: no AI chat for non-admins at all). Per-user provider keys (only admins use the agent, so
instance keys are enough). Skills that run code (that needs a sandbox). Scheduled or autonomous runs
(the `agent_run` table leaves room for them). Multi-tenant isolation. MCP client connections to
outside servers (the toolkit registry is built so this can be added later).

---

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The agent runtime moves **into nestjs-backend** (AI SDK 6 `ToolLoopAgent`, already a dependency at 6.0.169). Mastra is retired after the RAG port (§13) | Unrestricted access becomes direct service calls under a server-only principal, with no internal HTTP endpoint and no shared key that unlocks everything. One provider config. One runtime instead of three (F11). The AI SDK already supports tool approval (`needsApproval`) and UI message streams |
| D2 | **One provider registry**: the instance `aiConfig.llmProviders`, extended. Providers get a stable `id`, keys are encrypted and masked, keys can come from env, and custom headers are allowed | One place to configure. Fixes F1, F2, F3 |
| D3 | The agent tables are a **schema pack `agent`** installed into the Agent base by the existing `SchemaPackInstallerService`. A Prisma `agent_installation` row keeps the table and field id map, so renaming a table or field doesn't break anything (the same pattern as `EmailSource`) | Reuses tested install, plan and lock code. Admins get the normal table UI for free |
| D4 | **Secret values never go into table cells.** `agent_credentials` holds metadata only. The value lives in Prisma `agent_secret` (AES-256-GCM, AAD = the credential record id) | Cells end up in record history, exports, undo, realtime ops and the LLM context |
| D5 | "Unrestricted" means an **agent robot principal** plus a CLS flag that only the server can set, which `PermissionService` honours. What the agent can do is bounded by its **tools**, not by RBAC | No permission matrix to maintain, and HTTP clients can't forge it |
| D6 | **Admin only** at four layers: route guard, run-time check, a principal that only exists server-side, and a hidden UI | Feature 4. Defence in depth |
| D7 | Destructive operations need **human approval**. The audit log is append-only and kept in Prisma, where the agent can't change or erase it | An unrestricted agent reads untrusted cell text (prompt-injection risk) |
| D8 | Local AI, Knowledge Search and RAG Search are **retired as modes** and come back as tools and built-in skills | One agent, one place to improve |
| D9 | **Records are the source of truth for knowledge.** Vectors are derived from them and kept in sync by jobs. Search is hybrid (keyword + vector, merged with RRF). Reranking is optional | Fixes F4, F7, F8 |

---

## 5. Architecture (Feature 3)

### 5.1 Layers and dependency rule

```text
interface ──► application ──► domain ◄── infrastructure
                  │                         ▲
                  └──► runtime ──► toolkits ┘   (toolkits call application ports, never Prisma)
```

- **domain/**: pure TypeScript with no Nest, Prisma or AI SDK imports. It holds entities (`AgentProfile`,
  `Thread`, `Message`, `Memory`, `Skill`, `CredentialRef`), policies (`ToolPolicy`,
  `ApprovalPolicy`, `ContextBudget`, `MemoryRanking`) and **ports** (interfaces, each with a DI token).
- **application/**: use cases, one class each: `RunTurn`, `ResumeTurn` (after approval), `CancelRun`,
  `ManageThreads`, `ManageMemory`, `ManageSkills`, `ManageCredentials`, `ConfigureAgent`,
  `EnsureInstallation`. They orchestrate ports, own the transaction boundaries and write the audit log.
- **runtime/**: assembles the AI SDK agent: `ContextBuilder` (system prompt, memories, skills,
  history), `ToolAssembler` (toolkits → AI SDK tools, wrapped), `StreamAdapter` (UI message stream).
- **toolkits/**: one folder per toolkit. Each exports `{ id, title, tools, approval?, requires? }`.
  A toolkit is registered once in `toolkit.registry.ts`, and `agent_setup.toolkits` turns it on or off.
- **infrastructure/**: adapters that implement the ports. `llm/ProviderRegistry` (wraps
  `ModelResolverService`), `store/AgentTableStore` (record, table and field services run under the agent
  principal), `secrets/SecretVault`, `data/UnrestrictedDataGateway`, `knowledge/PgRagStore` and
  `Chunker`, `http/OutboundHttp`, `audit/AuditLog`, `jobs/AgentQueue` (BullMQ).
- **interface/**: controllers, zod DTOs from `@teable/openapi`, `AgentAdminGuard`, SSE piping.

### 5.2 Layout

```text
apps/nestjs-backend/src/features/agent/
  agent.module.ts                 composition root: binds port tokens to adapters
  interface/   agent.controller.ts · agent-admin.controller.ts · agent-admin.guard.ts
  application/ run-turn.usecase.ts · threads.usecase.ts · memory.usecase.ts · skills.usecase.ts
               credentials.usecase.ts · configure.usecase.ts · ensure-installation.usecase.ts
  domain/      entities/* · policies/* · ports/*.port.ts (MODEL_PORT, AGENT_STORE_PORT, …)
  runtime/     agent-runtime.ts · context-builder.ts · tool-assembler.ts · stream-adapter.ts
  toolkits/    memory/ skills/ threads/ setup/ credentials/ data-read/ data-write/ schema/
               sql-read/ knowledge/ http/ · toolkit.registry.ts · tool-wrapper.ts
  infrastructure/ llm/ store/ secrets/ data/ knowledge/ http/ audit/ jobs/ execution-context.ts
  pack/        agent.pack.json · agent.seed.json · builtin-skills/*.md
packages/openapi/src/agent/       zod contracts + route registrations
apps/nextjs-app/src/features/app/blocks/agent/   panel, page, settings, tool renderers
```

Rules: no file over 500 lines. `features/ai` keeps Teable's field AI, generation and TTS. The old
chat code in `features/ai` (Mastra client, general agents, thread routes) is deleted in phase P4.
`features/ai-data` stays for the MCP server (§13).

### 5.3 Ports (the seams that make it modular)

| Port | Adapter v1 | Swappable for |
|---|---|---|
| `ModelPort.resolve(ref) → LanguageModel` / `embedder(ref)` | `ProviderRegistry` | a per-tenant registry |
| `AgentStorePort` (setup, memory, threads, messages, skills, credentials) | `AgentTableStore` (Teable tables) | Prisma tables, if volume ever needs it |
| `SecretVaultPort.get/set/delete(credentialId)` | `PrismaSecretVault` | Vault or a KMS |
| `DataGatewayPort` (spaces/bases/tables/records/schema) | `UnrestrictedDataGateway` | — |
| `RagStorePort` (collections, documents, chunks, hybrid query, embedding spaces) | `PgRagStore` (`agent_rag` schema, §11) | another vector store |
| `ChunkerPort` / `RerankPort` | structure-aware splitter / AI SDK `rerank()` | — |
| `HttpPort.request(req, credentialRef?)` | `OutboundHttp` (SSRF guard + credential injection) | — |
| `AuditPort.append(entry)` | `PrismaAuditLog` | an external SIEM |

Every tool goes through `tool-wrapper.ts`. It runs the tool inside `AgentExecutionContext` (§9.2),
applies `ApprovalPolicy` (it sets `needsApproval`), times the call, caps the output (it reuses the
`ai-data.limits` budgets), turns errors into a result the model can read, and appends to the audit log.

---

## 6. LLM providers (Feature 1)

### 6.1 Data model (extends `llmProviderSchema`)

```ts
llmProvider = {
  id: string            // NEW: slug, unique, immutable ("openrouter", "ollama-local")
  type: LLMProviderType // + new 'anthropicCompatible' (native /v1/messages on a custom baseUrl)
  name: string          // display label; NO LONGER overwritten with "teable"
  apiKey?: string       // write-only; stored as apiKeyEnc (v1:iv:tag:ct), never returned
  apiKeyEnv?: string    // NEW: read the key from process.env[apiKeyEnv] at call time
  baseUrl?: string
  headers?: Record<string,string>     // NEW: static headers; values may be "env:VAR"
  models: string                      // CSV, as today
  fetchModels?: boolean               // NEW: GET {baseUrl}/models, merged with `models`
  enabled?: boolean                   // NEW, default true
  modelConfigs?: Record<model, IModelConfig>  // as today (tags, contextWindow, pricing…)
}
// read model (admin GET): apiKey omitted; adds hasApiKey, apiKeyPreview ("sk-…9f2c"), keySource
```

- **Model reference**: the agent stores `{providerId, model}` (`agent_setup.model` holds
  `providerId/model`). Teable's field AI keeps its `type@model@name` keys. `ModelResolverService`
  learns to resolve a third segment that is a provider `id`, and `@teable` stays a legacy alias for the
  first instance provider of that type, so existing keys keep working (fixes F2).
- **Secrets**: a generalised `utils/secret-cipher.ts`, lifted from `IntegrationSecretCipher` with the
  same v1 format. Key: `SECRETS_ENCRYPTION_KEY` (base64, 32 bytes), otherwise HKDF from `SECRET_KEY`
  with info `cybernetics-llm-provider`. AAD = `llm-provider:<id>`. A one-off migration encrypts
  existing plain keys on first boot. Writes: leaving `apiKey` out keeps the stored key, and `""`
  clears it.
- **Resolution order for a key**: `apiKeyEnc`, then `apiKeyEnv`, then none. An unset env var marks the
  provider **"not configured"** in the UI and in model lists, instead of failing later with a 401 (the
  LibreChat gotcha).
- **Env var rule**: `apiKeyEnv` and `env:` header values must match
  `AI_PROVIDER_ENV_PATTERN` (default `^(LLM|AI|OPENAI|ANTHROPIC|GOOGLE|AZURE|AWS|GROQ|MISTRAL|OPENROUTER|DEEPSEEK|XAI|OLLAMA|VLLM|LITELLM|TOGETHER|COHERE)_[A-Z0-9_]+$`)
  and can never name one of the app's own secrets (`SECRET_KEY`, `SECRETS_ENCRYPTION_KEY`,
  `PRISMA_*`, `*_DATABASE_URL`, `MASTRA_*`, `BACKEND_*`). Without this rule, an admin session could
  send a server secret to any base URL as a "key".
- **The Gateway is a provider.** Today's `aiConfig.aiGatewayApiKey` and `aiGatewayBaseUrl` become a
  provider `{id: 'vercel-gateway', type: 'aiGateway'}`, and its model pool becomes that provider's
  `models`. The `gateway | custom` mode goes away (§13.1).
- **Agent model slots** (in `agent_setup`): `model` (main loop, must have the `tool-use` tag),
  `small_model` (titles, summaries, memory extraction), `embedding_model` (fixed dimension, see §11),
  and an optional `rerank_model`.
- Admin-entered base URLs are trusted (local Ollama has to work). Only the agent's `http` toolkit is
  checked for SSRF.

### 6.2 How to set up a custom provider (admin guide; goes into the UI help text)

Admin ▸ AI Settings ▸ Providers ▸ **Add provider**. Pick a type, fill in the fields, click **Test**
(this uses the existing `test-llm` endpoint, which checks the key, tool use and vision), then **Save**.
Then go to Admin ▸ Agent ▸ Models and choose the models.

| Target | Type | Base URL | Key | Notes |
|---|---|---|---|---|
| OpenRouter | `openRouter` | (default) | `sk-or-…` or `apiKeyEnv: OPENROUTER_KEY` | headers: `HTTP-Referer`, `X-Title` |
| Vercel AI Gateway | `aiGateway` | (default) | gateway key | models such as `anthropic/claude-sonnet-5.5` |
| Ollama (local) | `openaiCompatible` | `http://host.docker.internal:11434/v1` | any non-empty string | `fetchModels: true` |
| vLLM / LiteLLM / LM Studio | `openaiCompatible` | `http://<host>:<port>/v1` | proxy key | each one gets its own `id`, so they no longer collide |
| DeepSeek / xAI / Mistral | native type | (default) | provider key | |
| Anthropic-compatible proxy | `anthropicCompatible` | proxy URL | proxy key | uses `/v1/messages`, so thinking and caching work |
| Azure OpenAI | `azure` | resource URL | key | the deployment name goes in `models` |

### 6.3 API

`GET/PATCH /api/admin/setting` now masks keys, and `PATCH` no longer accepts `llmProviders` (it
returns 400 pointing to the routes below). Providers get their own routes, which the UI in §13.1 uses.
All of them need `instance|read` (GET) or `instance|update`:

| Route | Purpose |
|---|---|
| `GET /api/admin/ai/providers` | masked list, plus health `{status, lastTestedAt, lastError, keySource, apiKeyPreview, apiKeyEnv, envSet, modelCount, usedBy[], version}` |
| `POST /api/admin/ai/providers` · `PATCH /api/admin/ai/providers/:id` | create or update one provider; `PATCH` carries `version` (409 on conflict); a missing `apiKey` keeps the stored key, `""` removes it |
| `DELETE /api/admin/ai/providers/:id` | 409 with `usedBy[]` while anything references the provider |
| `POST /api/admin/ai/providers/test` | test a **draft** (unsaved) or a saved provider with overrides; returns `{ok, status, latencyMs, models?, error?, hint?}`; the draft key is used once and never stored |
| `GET /api/admin/ai/providers/:id/models` | live `/models` fetch |
| `POST /api/admin/ai/providers/:id/models/test` `{models[]}` | ability test (tool use, vision, reasoning); the existing batch test, moved here |
| `GET /api/admin/ai/env-status?name=VAR` | `{set: boolean}` only, for names allowed by the env rule in §6.1 |

---

## 7. Agent tables (Feature 2.1)

### 7.1 The Agent space and Agent base (decided 2026-10-26)

"The first database" means a **dedicated `Agent` base**. It sits in its own **`Agent` space**, which
the system manages, and holds nothing but the agent tables.

- **Why a separate space, not just a separate base.** `PermissionService.getPermissionByBaseId`
  merges the caller's base role with their **space** role. An Agent base placed inside a shared space
  would be readable by every member of that space. A space of its own is the only way to make sure no
  one but admins can see it.
- **Created on first enable.** Admin ▸ Agent ▸ Enable creates the space and base, both named `Agent`,
  installs the pack (§7.4) and stores `space_id` and `base_id` in `agent_installation`. The agent
  always finds them by id, never by name, so renaming them is harmless and a user's own base called
  "Agent" is never mistaken for it.
- **Membership = the set of instance admins.** Every user with `isAdmin = true` is added as a space
  **owner**. On enable and at every health check, `EnsureInstallation` reconciles the list: it adds
  admins who are missing and removes anyone who is not an admin, and records each change in the audit
  log. The agent robot needs no membership, because it goes through the permission bypass (§9.2).
  This build only grants admin to the first user signed up (`user.service.ts`), so no event hook is
  needed; reconciling at each check also covers admin changes made directly in the database.
- **Locked down.** For this space and base the backend refuses: invitations and invite links, base
  share links, template publishing, moving the base to another space, and adding collaborators by
  hand. Each refusal is a check on the space or base id in the existing services, and it returns
  `403 "Managed by the Agent"`. Admins can still view, edit, export and add their own tables and fields.
- **Deletion.** If the base or space is in the trash, the agent stops with `needs_setup` and the
  Admin ▸ Agent page offers **Restore** (Teable's trash restores it with all data). It is **not**
  re-created automatically, because that would quietly start over with empty memory. **Reset** creates
  a new, empty base, and only after the admin confirms.

### 7.2 Tables (pack `agent`, snake_case like the other packs)

Every table also has the pack's standard `created_at`, `updated_at` and `id` (autoNumber).

**agent_setup**: one row per agent profile. Exactly one row has `is_default`.

| Field | Type | Notes |
|---|---|---|
| name | singleLineText (primary) | display name |
| is_default, is_active | checkbox | |
| persona | longText (markdown) | system prompt body, edited by the admin |
| model / small_model / embedding_model / rerank_model | singleLineText | `providerId/model`, validated on save |
| temperature | number | default empty (provider default) |
| max_steps / max_output_tokens / context_budget_tokens | number | 25 / 8000 / 60% of the model's context window |
| toolkits | multipleSelect | memory, skills, threads, setup, credentials, data_read, data_write, schema, sql_read, knowledge, http |
| approval_required | multipleSelect | delete_records, bulk_write(>50), schema_change, delete_schema, http_write, setup_change, skill_change |
| memory_mode | singleSelect | off · explicit (tools only) · auto (also extracts after each turn) |
| always_skills | link → agent_skills (manyMany) | bodies injected on every turn |

**agent_memory**

| Field | Type | Notes |
|---|---|---|
| title | singleLineText (primary) | one-line gist; this is what search ranks on first |
| content | longText | the fact or instruction |
| kind | singleSelect | fact · preference · instruction · entity · episode |
| scope | singleSelect | global · user · base · thread |
| scope_ref | singleLineText | user id / base id / thread record id (empty for global) |
| pinned | checkbox | always injected (budget-capped) |
| importance | rating (1–5) | used for ranking and pruning |
| source | singleSelect | user_said · agent_inferred · admin · imported |
| source_thread | link → agent_threads (manyOne) | provenance |
| tags | multipleSelect | |
| use_count / last_used_at | number / date | updated when the memory is injected or returned |
| expires_at | date | the memory is ignored after this date |
| embedded_at | date | set by the embedding job, used to spot stale vectors |
| is_active | checkbox | soft forget |

**agent_threads**

| Field | Type | Notes |
|---|---|---|
| title | singleLineText (primary) | generated by `small_model` after the first turn |
| owner | user | the admin who started it; the list shows the caller's own threads |
| profile | link → agent_setup (manyOne) | |
| status | singleSelect | active · archived |
| focus_base_id / focus_table_id | singleLineText | the UI context it started from (a hint, not a limit) |
| summary | longText | rolling summary of the turns that no longer fit the history window |
| messages | link (symmetric of agent_messages.thread) | |
| message_count | rollup / count | |
| tokens_in / tokens_out / cost_usd | number | summed after each turn |
| last_message_at | date | used for sorting |

**agent_messages**

| Field | Type | Notes |
|---|---|---|
| summary | singleLineText (primary) | first 100 characters, for the grid |
| thread | link → agent_threads (manyOne) | |
| seq | number | order within the thread |
| role | singleSelect | user · assistant · tool · system |
| content | longText (markdown) | visible text |
| parts | longText | AI SDK `UIMessage.parts` JSON (tool calls, results, approvals), capped at 64 KB |
| model | singleLineText | |
| tokens_in / tokens_out | number | |
| attachments | attachment | files the user sent |
| error | longText | |

**agent_skills**

| Field | Type | Notes |
|---|---|---|
| name | singleLineText (primary) | kebab-case, unique, ≤64 characters; also the `/name` command |
| description | longText | the "when to use" text the model reads; this decides when the skill fires |
| body | longText (markdown) | instructions (SKILL.md body), ≤100k characters |
| invocation | singleSelect | auto (listed in the catalog) · manual (`/name` only) · always |
| toolkits | multipleSelect | toolkits the skill expects; the UI warns when one is off |
| credentials | link → agent_credentials (manyMany) | credentials the skill may use with `http_request` |
| category | singleSelect | |
| source | singleSelect | builtin · admin · agent · imported |
| version | number | bumped on every body change |
| is_active | checkbox | |

**agent_credentials** (metadata only, D4)

| Field | Type | Notes |
|---|---|---|
| name | singleLineText (primary) | slug used by tools (`github`, `hubspot`) |
| description | longText | what the credential is for |
| auth_kind | singleSelect | bearer · header · query_param · basic · oauth2_client_credentials |
| header_name / query_param | singleLineText | for header and query kinds |
| allowed_hosts | longText | one host per line (`api.github.com`). **Required.** The secret is only ever sent to these hosts |
| allowed_methods | multipleSelect | GET · POST · PUT · PATCH · DELETE (default GET) |
| status | singleSelect | missing · set · invalid · expired (kept up to date by the vault) |
| preview | singleLineText | `ghp_…a1b2`, written by the vault, never the value |
| expires_at / last_used_at | date | |
| skills | link (symmetric) | |

### 7.3 System tables (Prisma, main DB; postgres and sqlite migrations)

```prisma
model AgentInstallation { id String @id  spaceId String  baseId String  packVersion Int  tableMap Json  fieldMap Json
  status String /* needs_setup|ok|repairing|error */  lastVerifiedTime DateTime?  lastError String?
  enabled Boolean @default(false)  seededVersion Int @default(0)  createdBy String  createdTime DateTime  lastModifiedTime DateTime? }
model AgentSecret { id String @id  credentialRecordId String @unique  ciphertext String  keyVersion Int
  createdBy String  createdTime DateTime  lastModifiedTime DateTime?  lastUsedTime DateTime? }
model AgentRun { id String @id  threadRecordId String  actorUserId String  status String /* running|awaiting_approval|done|failed|cancelled */
  model String  startedTime DateTime  finishedTime DateTime?  error String?  usage Json? }
model AgentAuditLog { id String @id  runId String  actorUserId String  tool String  args Json /* redacted, ≤8KB */
  resultSummary String?  status String  durationMs Int  createdTime DateTime   @@index([runId]) @@index([createdTime]) }
```

None of these is reachable by any agent tool.

### 7.4 Bootstrap: "check every time the agent starts"

`EnsureInstallation.run(reason)` holds a Redis lock and reuses `SchemaPackInstallLock`.

1. **When it runs**: on enable, on backend boot (`onApplicationBootstrap`, when `enabled`), and
   lazily at the start of a turn when `lastVerifiedTime` is more than 5 minutes old. The verified
   state is cached in Redis, so a normal turn costs one cache read.
2. **No Agent base** (never enabled, or base or space in the trash): status becomes `needs_setup` and
   the turn returns 409 "Agent needs setup" (§7.1 Restore / Reset).
3. **Verify**: reconcile space membership with the admin set (§7.1), then load the tables of the
   Agent base. For every pack table and field, use the stored id;
   if the id is gone, match by name; if the name is gone too, it counts as **missing**.
4. **Repair, additive only**: `planInstall` against the existing base, then install only the missing
   tables and fields, then update `tableMap` and `fieldMap`. It never deletes or retypes anything, and
   it never touches fields that admins added. A field whose type changed is reported as an `error`
   for its toolkit, and that toolkit is turned off until an admin fixes it.
5. **Seed** (only when `seededVersion < pack seed version`): the default `agent_setup` row and the
   built-in skills (`knowledge-search`, `rag-search`, `data-navigation`, `schema-design`,
   `using-credentials`, `memory-hygiene`). A built-in skill that an admin has edited (its hash differs)
   is not overwritten. The new version is added as a separate inactive row instead.
6. **Health**: membership matches the admin set, no share links or invitations exist (any found are
   revoked and reported), vault key present, models resolvable, vector index
   dimension matches `embedding_model`. The result is saved on the row and shown in Admin ▸ Agent.

---

## 8. Working with its tables out of the box (Feature 2.2)

| Toolkit | Tools | Approval by default |
|---|---|---|
| memory | `memory_search(query, scope?)`, `memory_save(title, content, kind, scope, pinned?)`, `memory_update(id, …)`, `memory_forget(id)` (sets is_active=false) | — |
| skills | `skill_list()`, `skill_load(name)` (returns the body), `skill_create(…)`, `skill_update(name, …)` | create/update |
| threads | `thread_search(query)` (past conversations by title and summary), `thread_read(id, range)` | — |
| setup | `setup_get()`, `setup_update(patch)` (persona, toolkits, models) | yes |
| credentials | `credential_list()` (metadata only), `credential_request(name, hosts, kind, why)` (creates a `missing` row and posts a "set secret" link in the chat) | — |
| data_read | `list_spaces`, `list_bases(spaceId?)`, `list_tables(baseId)`, `describe_table`, `query_records`, `get_records`, `aggregate`, `search_everywhere(query)` | — |
| data_write | `create_records`, `update_records`, `delete_records` (≤100 per call) | delete; bulk over 50 |
| schema | `create_table`, `create_field`, `update_field`, `delete_field`, `delete_table` | all; deletes always |
| sql_read | `sql_query(baseId, sql)`, run through `BaseSqlExecutorService` with its read-only role | — |
| knowledge | `knowledge_search`, `rag_search`, `rag_read`, `rag_ingest`, `rag_ingest_status`, `collection_list/create/delete` (§11) | ingest, collection delete |
| http | `http_request(method, url, headers?, body?, credential?)` | non-GET |

The store tools address tables and fields through `tableMap`/`fieldMap`, so they keep working after an
admin renames a column. The model never needs table ids for its own tables. The generic `data_*` tools
can still see the agent tables. That is intended, because the admin may say "tidy up my memory table".
`credential_request` exists so that **secrets never pass through the chat**: the admin types the value
into the Admin ▸ Agent ▸ Credentials dialog, which posts to `PUT /api/agent/credentials/:id/secret`.
`http_request` with `credential: "github"` makes the backend inject the secret, but only when the URL's
host is in `allowed_hosts` and the method is in `allowed_methods`. The secret is then removed from the
response before the model sees it.

---

## 9. Unrestricted access and admin only (Features 2 and 4)

### 9.1 Who may use it

1. **Route guard** `AgentAdminGuard` on every `/api/agent/**` route: `cls.user.isAdmin === true`. It
   rejects system and robot users, share and template contexts, and personal access tokens (v1; a
   later `agent|use` PAT scope is possible).
2. **Run-time check**: `RunTurn` and `ResumeTurn` read `isAdmin` again from the database, so an admin
   demoted while a stream is open is refused on the next step that needs approval.
3. **The principal is server-only** (§9.2): no header, cookie or token can produce it.
4. **UI**: the panel, the page and the settings render only when `user.isAdmin`. This is for
   convenience; the server enforces it anyway.

### 9.2 How "no RBAC" is implemented

- New `AGENT_ROBOT_USER = { id: 'agentRobot', name: 'Agent', email: 'agentRobot@system.cybernetics.ai' }`
  in `packages/core/src/auth/agent-robot.ts`, created by `builtin-assets-init` like the automation
  robot. Records the agent writes show **Agent** as the creator. The admin who asked is kept in the
  audit log and in `agent_run`.
- `AgentExecutionContext.run(runId, actorUserId, fn)` opens a fresh `cls.run`. It sets `user` to the
  agent robot and `agentRun = { runId, actorUserId }`, and sets `skipRecordAuditLog` for
  `agent_messages` writes only.
- `PermissionService.getPermissionsByResourceId`: if `cls.agentRun` is set **and** `cls.user.id ===
  AGENT_ROBOT_ID`, it returns every space, base and table action. `cls.set('permissions', …)` is
  still called, because table, base and selection services read it back (see the comment in
  `mcp/tool-registry.ts`). There are two unit tests: an HTTP request can never set `agentRun`, and
  the robot without `agentRun` gets nothing.
- "Unrestricted" covers data and schema across **every** space and base. It does **not** cover
  instance settings, users, sessions, invitations, billing, `agent_secret` or `agent_audit_log`,
  because no tool exposes them. Adding such a tool is a deliberate design change, not a permission
  change.

### 9.3 Safety rails, because untrusted cell text reaches a model with write access

- **Approval**: tools listed in `approval_required` set AI SDK `needsApproval`. The stream emits
  `tool-approval-request`, and the UI shows the arguments (for deletes, the affected record titles
  are fetched for the preview). Nothing runs until the admin approves. A denial goes back to the model
  as the tool result.
- **Caps**: ≤100 records per write call, ≤25 steps per turn, a 5-minute turn timeout, and output
  budgets on every tool result. Deletes go to Teable's trash, so they can be restored.
- **Containment**: record values, files and fetched pages are wrapped as `<untrusted>` data in tool
  results, and the system prompt says they are never instructions. `http_request` may only reach
  hosts listed by credentials or in `AGENT_HTTP_ALLOWED_HOSTS`. Private IPs, link-local addresses and
  the metadata IP are blocked after DNS resolution.
- **Audit**: one row per tool call (with secrets redacted), plus usage on `agent_run`.

---

## 10. Runtime

### 10.1 One turn

```text
POST /api/agent/chat  {threadId?, message, context?{baseId,tableId,viewId,recordIds}}
 1 guard (admin) → EnsureInstallation (cached) → lock thread (Redis, one run per thread) → AgentRun(running)
 2 persist user message (agent_messages)            ← before the model runs, so a crash loses nothing
 3 ContextBuilder: persona + capabilities + context hint
                   + pinned memories + top-k relevant memories (hybrid search on the message; scope global/user/base)
                   + skills catalog (name + description of active `auto` skills) + bodies of `always` skills
                   + thread.summary + newest messages that fit context_budget_tokens
 4 ToolLoopAgent(model, tools = ToolAssembler(setup.toolkits), stopWhen: stepCountIs(max_steps))
 5 pipeAgentUIStreamToResponse → SSE (text, reasoning, tool-input, tool-output, approval-request, data-usage)
 6 onStepFinish: persist assistant/tool parts; onFinish: usage → thread + run(done); release lock
 7 enqueue jobs: title (first turn), summary (history over budget), memory extraction (memory_mode=auto),
   embeddings for new or changed memories
```

- **Approval resume**: when the agent stops on an approval, `AgentRun` becomes `awaiting_approval`. The
  client posts the approval with AI SDK 6's `tool-approval-response` on the same thread, and
  `ResumeTurn` rebuilds the messages from `agent_messages` and continues.
- **Cancel**: `POST /api/agent/runs/:id/cancel` aborts the run. A closed client connection also aborts
  it (the current M1 behaviour).
- **Memory extraction** (auto mode): `small_model` reads the turn and proposes at most 3
  `{title, content, kind, scope}` items. An item that is near-duplicate of an existing memory
  (vector score over 0.9, or the same title) updates that memory instead of adding a new one.
- **Skills**: progressive disclosure, as in Claude skills. The catalog costs about 1 line per skill;
  `skill_load` fetches a body when the model decides it needs it; `/name` in the input loads one
  explicitly.

---

## 11. Knowledge search and RAG, redesigned (Feature 5 follow-up)

Everything below lives in the existing pgvector database (`VECTOR_DATABASE_URL`) in a new schema,
`agent_rag`, behind `RagStorePort` (§5.3). The Mastra schemas are left alone until P4 removes them
(§14).

### 11.1 Storage: one chunks table, collections as a column

Today every topic (`personal`, `finance`, …) is a separate vector table, and cross-topic search fans
out and compares scores across tables. In the new design, a topic is a **collection**: a value in a
column.

```sql
CREATE TABLE agent_rag.collection (            -- replaces index_schema.embedding_index
  id text PRIMARY KEY,                         -- slug: 'knowledge', 'work', 'kb_records', 'agent_memory'
  label text NOT NULL, description text,
  kind text NOT NULL,                          -- 'documents' (admin-named) | 'derived' (synced from tables)
  min_score real,                              -- optional vector cutoff for this collection (depends on the model)
  is_active boolean NOT NULL DEFAULT true, created_time timestamptz NOT NULL, last_modified_time timestamptz);

CREATE TABLE agent_rag.document (
  id text PRIMARY KEY,                         -- sha256(collection_id || ':' || source_ref)
  collection_id text NOT NULL REFERENCES agent_rag.collection,
  source_ref text NOT NULL,                    -- record:<base>/<table>/<rec> · attachment:<token> · url:<url> · text:<slug>
  title text, content_hash text NOT NULL,      -- sha256 of the extracted text
  status text NOT NULL,                        -- queued | processing | ready | failed
  chunk_count int NOT NULL DEFAULT 0, error text,
  base_id text, table_id text, record_id text, -- real columns, so filters and deletes use an index
  created_time timestamptz NOT NULL, last_modified_time timestamptz,
  UNIQUE (collection_id, source_ref));

CREATE TABLE agent_rag.chunk (                 -- text only; independent of the embedding model
  id bigserial PRIMARY KEY,
  document_id text NOT NULL REFERENCES agent_rag.document ON DELETE CASCADE,
  collection_id text NOT NULL,
  parent_id bigint REFERENCES agent_rag.chunk ON DELETE CASCADE,  -- the section this chunk belongs to
  level smallint NOT NULL,                     -- 0 = section (what is returned), 1 = chunk (what is searched)
  seq int NOT NULL, heading_path text, content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading_path,'') || ' ' || content)) STORED);
CREATE INDEX ON agent_rag.chunk USING gin (tsv) WHERE level = 1;
CREATE INDEX ON agent_rag.chunk (document_id);  CREATE INDEX ON agent_rag.chunk (collection_id, level);

CREATE TABLE agent_rag.embedding_space (        -- one row per embedding model ever used
  slug text PRIMARY KEY,                       -- e.g. 'te3s_1536'
  model text NOT NULL, dimension int NOT NULL, -- providerId/model from agent_setup.embedding_model
  status text NOT NULL,                        -- building | active | retired  (exactly one active)
  created_time timestamptz NOT NULL);

CREATE TABLE agent_rag.embedding_te3s_1536 (    -- one table per space, created by EnsureEmbeddingSpace
  chunk_id bigint PRIMARY KEY REFERENCES agent_rag.chunk ON DELETE CASCADE,
  collection_id text NOT NULL,                 -- copied here, so filtered ANN needs no join
  embedding vector(1536) NOT NULL);
CREATE INDEX ON agent_rag.embedding_te3s_1536 USING hnsw (embedding vector_cosine_ops);
```

- **HNSW, not ivfflat.** Mastra's `PgVector` creates ivfflat indexes by default. An ivfflat index
  built on an empty table has poor recall until it is rebuilt. HNSW works from the first row. Filtered
  searches use pgvector's iterative scan (`SET LOCAL hnsw.iterative_scan = relaxed_order`, pgvector
  0.8 or later). `EnsureInstallation` checks the extension version.
- **Text and vectors are kept apart.** Chunks carry the text and the keyword index. Each embedding
  model gets its own table. Keyword search therefore works with no embedding model configured, and
  switching models never takes search down (§11.5).
- **`'simple'` text search config** because the content may mix languages. An admin can change it per
  collection later; doing so rebuilds the `tsv` column.
- **No `credential` collection.** Secrets are never embedded (D4). The migration (§14) skips that index
  and reports it if it holds any data.
- Collections are created by `collection_create` (registry row only, since no per-collection table is
  needed any more, which removes F4 at the root). `kb_records` and `agent_memory` are seeded as
  `derived`.

### 11.2 Chunking: smaller chunks that follow the document's structure

`ChunkerPort`, about 100 lines, with no Mastra dependency:

1. **Sections (level 0)**: split on markdown headings (`#`–`###`). For plain text, split on blank-line
   runs. A section over 4000 characters is split at paragraph boundaries. Each section keeps its
   `heading_path` (`Q3 Report › Revenue › EMEA`).
2. **Chunks (level 1)**: each section is split into chunks of about **1000 characters with 120
   overlap** at sentence boundaries. A section shorter than 1200 characters becomes a single chunk.
3. **Text that gets embedded** = `"{document title} › {heading_path}\n\n{chunk}"`. Putting the
   document title and heading path in front gives each chunk its context, which is cheap and works well.
4. **Records** (`kb_records`, `agent_memory`): one section per record (`title` + `context` or
   `content`), chunked the same way when long.
5. Optional enrichment (a summary and keywords for each section) goes through `small_model` via
   `ModelPort` (fixes F6). It is off by default.
6. Sizes are constants in `ChunkerPort`, tuned with the evaluation set (§11.6), not guessed.

### 11.3 Ingest: background, idempotent, atomic

```text
rag_ingest(collection, source: {text|attachmentToken|url|recordRef}, title?)
  → upsert document(status=queued) → BullMQ 'rag-ingest' → returns {documentId, jobId, status}
job: extract text (chat-file parsers for pdf/docx/html/md/csv) → content_hash
     → hash unchanged AND every chunk has an embedding in the active space → status=ready, done (no LLM call)
     → chunk → embed in batches of 100 (active space; also the building space, if one exists)
     → ONE transaction: delete the document's chunks (cascade removes embeddings), insert sections,
       chunks and embeddings, update document(status=ready, chunk_count)
```

- **Identity comes from the source, not the name.** `documentId = sha256(collection:source_ref)`.
  Renaming a document changes only `title`, and two documents with the same name no longer overwrite
  each other.
- **Skipping unchanged content** makes the derived sync jobs almost free. A record save that didn't
  change `title` or `context` costs one hash comparison.
- **Atomic replace**, as `PgVector.upsert` already does today: the old chunks stay searchable until
  the new ones are committed.
- `rag_ingest` waits up to about 10 seconds, so small texts come back `ready` within the same turn.
  Otherwise the agent gets `queued` and can call `rag_ingest_status(documentId)`.
- **Derived sync**: `record.create/update/delete` events on knowledge tables (by default, tables
  whose `detectTableProfile` finds `titleFieldId` + `contextFieldId`; the admin can edit the list) and
  on `agent_memory` enqueue the same job with `source_ref = record:<base>/<table>/<rec>`. A delete
  removes the document.

### 11.4 Query: hybrid in one SQL statement, bigger rerank pool, snippets out

```sql
WITH vec AS (SELECT e.chunk_id, row_number() OVER (ORDER BY e.embedding <=> $q) AS r
             FROM agent_rag.embedding_<active> e WHERE e.collection_id = ANY($cols)
             ORDER BY e.embedding <=> $q LIMIT 40),          -- plus the min_score cutoff when the collection has one
     kw  AS (SELECT c.id AS chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, $tsq) DESC) AS r
             FROM agent_rag.chunk c WHERE c.level = 1 AND c.collection_id = ANY($cols) AND c.tsv @@ $tsq
             ORDER BY ts_rank_cd(c.tsv, $tsq) DESC LIMIT 40),
     rrf AS (SELECT chunk_id, sum(1.0 / (60 + r)) AS score FROM (SELECT * FROM vec UNION ALL SELECT * FROM kw) u
             GROUP BY chunk_id)
SELECT ... FROM rrf JOIN agent_rag.chunk c ON c.id = rrf.chunk_id JOIN agent_rag.chunk p ON p.id = c.parent_id
JOIN agent_rag.document d ON d.id = c.document_id ORDER BY score DESC LIMIT 40;
```

- **Reciprocal Rank Fusion** (k = 60) merges the keyword and vector passes, which catches exact
  names, codes and acronyms that vector search alone misses. No embedding model means the keyword pass
  only.
- **The rerank pool is the 40 fused candidates**, not `topK`. Only when `agent_setup.rerank_model` is
  set, the pool goes through AI SDK 6 `rerank()` (Cohere, Voyage, or any provider that supports it)
  and the best `topK` are kept (fixes F7). Without a reranker, the RRF order stands.
- **Small to big**: hits are grouped by their parent section, so two chunks from one section count
  once. What is returned is about the section, not the 1000-character chunk.
- **Snippets out**: `rag_search(query, collections?, topK = 5)` and `knowledge_search(query,
  baseIds?, tables?)` (the same pipeline over `kb_records`, filtered on `base_id`/`table_id`) return
  `{documentId, sectionId, title, headingPath, snippet (≤400 characters around the best match),
  sourceRef, recordRef?, score}`. That is about 0.5k tokens per search instead of about 5k. The agent
  calls `rag_read(sectionId | documentId, range?)` for the full text, or `get_records` for a record.
- Every result says which collections were searched and which failed (no `allSettled` hiding).

### 11.5 Changing the embedding model, without taking search down

Setting a new `agent_setup.embedding_model` creates a new `embedding_space` (`building`) and its
table, then backfills every level-1 chunk in the background (resumable, in batches). New ingests write
to both spaces while the backfill runs. When the backfill finishes, the new space becomes `active` and
the old one `retired` (its table is dropped after 7 days). Searches use the active space the whole
time. Nothing has to be re-ingested by hand, because the text is still in `agent_rag.chunk`.

### 11.6 Measure before tuning

- **Evaluation set**: `apps/nestjs-backend/test/rag-eval/golden.json` holds about 30 entries
  `{question, collection, expected: [source_ref…]}`, written from real knowledge records and documents.
- **Runner**: `pnpm -F @teable/backend rag-eval` ingests the fixtures into a disposable schema, runs
  every question through `rag_search`, and prints **recall@5**, **MRR**, and latency p50/p95 for each
  configuration (keyword only, vector only, hybrid, hybrid + rerank). It borrows the scoring idea from
  `apps/mastra-ai/src/mastra/scorers/knowledge-scorer.ts`.
- **Rule**: chunk sizes, the RRF k, the candidate pool and `min_score` change only with an eval run
  that shows the effect. P4 is done when hybrid recall@5 is at least the baseline (the first run,
  recorded in the file).

---

## 12. API (zod contracts in `packages/openapi/src/agent/`)

| Route | Purpose |
|---|---|
| `POST /api/agent/chat` | start or continue a turn (SSE UI message stream); also carries approval responses |
| `POST /api/agent/runs/:runId/cancel` | stop a run |
| `GET /api/agent/threads?cursor=` · `GET/PATCH/DELETE /api/agent/threads/:id` · `GET /api/agent/threads/:id/messages` | the caller's threads; PATCH renames or archives |
| `GET /api/agent/status` | enabled, installation health, models, Agent base, warnings |
| `POST /api/agent/admin/enable` (creates or re-attaches the Agent space and base) · `POST /api/agent/admin/disable` · `POST /api/agent/admin/verify` · `POST /api/agent/admin/reset` `{confirm: true}` | lifecycle |
| `PUT /api/agent/credentials/:recordId/secret` `{value, expiresAt?}` · `DELETE …/secret` · `POST …/test` | write-only secret entry |
| `GET /api/agent/audit?runId=&cursor=` | read the audit log |

Memory, skills, setup and credential metadata have **no dedicated CRUD routes**. Admins edit them in
the Agent base tables, and the agent uses its tools. That is the point of D3.

---

## 13. Frontend

- **Agent panel** (replaces the chat panel; shown only to admins): built on `useChat` from
  `@ai-sdk/react` (a new dependency, pinned to the AI SDK 6 line) with a transport to
  `/api/agent/chat`. Tool calls render as collapsible steps. Approval cards show Approve and Deny. A
  context chip shows the current base, table and selection, and `/` opens the skill picker. The panel
  keeps the existing file upload (`chat-file`) and voice input.
- **Agent page** `/agent`: thread list (search, archive), full-width chat, and usage per thread.
- **Admin ▸ Agent**: Enable (creates the Agent space and base, §7.1; the dialog says that every admin
  can read every thread there), Restore / Reset when it is in the trash, status and health, model slots with pickers fed by the
  provider registry, toolkits and approval switches (these write to the default `agent_setup` row),
  credentials list with **Set secret** and **Test**, and an audit log viewer. "Open Agent base" is a link.
- **Admin ▸ AI Settings**: the new provider setup UI (§13.1).
- Non-admins: no panel, no route, no menu entry. Teable's field AI features are unchanged.

### 13.1 LLM Provider Setup UI (Admin ▸ AI Settings ▸ Providers)

**What's there today.** `features/app/blocks/admin/setting/components/ai-config/` (about 7.5k lines)
is a 3-step wizard: LLM API, then model pool, then default models. Step 1 makes the admin choose
**either** the Vercel Gateway **or** custom providers (`LLMApiMode = 'gateway' | 'custom'`). The
provider form (`LlmProviderForm.tsx`, 1031 lines) and `LLMApiConfigStep.tsx` (672) save the whole
`aiConfig` blob, keys included, with every change. It has no stable provider id, no env-var keys,
no headers, no per-provider health, and nowhere that shows what uses a provider.

**What changes.** The wizard is replaced by a **provider list** plus a **provider sheet**. The
Gateway becomes one provider preset among the others, so there is no mode switch. The "Default
models" card stays and uses the new shared `ModelPicker`. Status, AI control and app builder cards
are unchanged.

#### Page

```text
AI Settings
┌ Status ─────────────────────────────────────────────────────────────────────────────┐
│ 4 providers · 3 ready · 1 needs attention          Agent: main ✓  small ✓  embed ✓   │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌ Providers ──────────────────────────────────────────────────────── [ + Add provider ] ┐
│ ◉ OpenRouter      openrouter     Key stored  sk-or-…9f2c   38 models   ● Ready    ⋯ │
│ ◉ Ollama (local)  ollama-local   No key                     7 models   ● Ready    ⋯ │
│ ◉ vLLM (gpu-01)   vllm-gpu01     env VLLM_API_KEY           2 models   ● Ready    ⋯ │
│ ○ Groq            groq           env GROQ_API_KEY — not set 3 models   ▲ Not set  ⋯ │
└─────────────────────────────────────────────────────────────────────────────────────┘
┌ Default models (field AI, Teable chat tiers) ── existing card, now with ModelPicker ─┐
```

- **Row**: icon and name, `id` (monospace), key source (`Key stored ··preview`, `env VAR`, `No key`),
  model count, health chip, `⋯` menu. On phone width each row becomes a card, with the same content
  stacked.
- **Health chip**: `Ready` (last test passed), `Untested`, `Not set` (env var missing, or no key
  where one is required), `Error` (last test failed; the tooltip shows the error and the hint),
  `Disabled`. The chip is computed by the backend, never in the browser.
- **`⋯` menu**: Edit · Test now · Refresh models · Duplicate (key not copied) · Disable/Enable ·
  Delete. Delete is blocked while anything uses the provider. The dialog lists the users (for example
  "Agent main model, Default chat model (lg)") with links to reassign them.
- **Empty state**: three preset buttons (OpenRouter, Ollama, OpenAI-compatible), plus "All providers…".

#### Provider sheet (right-side `Sheet`; full screen on phone)

Adding takes three steps. Editing opens the same sheet with **Connection · Models · Advanced** tabs.

```text
1 Choose type                2 Connection                                3 Models
┌──────────────────────┐    ┌────────────────────────────────────────┐   ┌──────────────────────────────────┐
│ [OpenAI] [Anthropic] │    │ Name      [ vLLM (gpu-01)            ] │   │ Fetched from /models  ⟳  🔍 ____ │
│ [Google] [Azure]     │    │ ID        [ vllm-gpu01 ] (fixed after  │   │ ☑ Qwen3-32B      tools vision ▸  │
│ [Bedrock][DeepSeek]  │    │                           saving)      │   │ ☑ Llama-3.3-70B  tools        ▸  │
│ [xAI] [Mistral]      │    │ Base URL  [ http://gpu-01:8000/v1    ] │   │ ☐ Llama-3.2-1B                ▸  │
│ [OpenRouter]         │    │ API key   (•) Paste  ( ) Env var       │   │ + Add model id manually [______] │
│ [Vercel AI Gateway]  │    │           ( ) No key                   │   │ ☑ Keep in sync with /models      │
│ [Ollama] [LM Studio] │    │           [ •••••••••••••••• ]         │   │ [ Test selected ]                │
│ [vLLM] [LiteLLM]     │    │ ▸ Advanced: headers                    │   │                                  │
│ [OpenAI-compatible…] │    │ [ Test connection ]  ✓ 200 · 18 models │   │                                  │
│ [Anthropic-compat…]  │    │                       · 142 ms         │   │                                  │
└──────────────────────┘    └────────────────────────────────────────┘   └──────────────────────────────────┘
                                                                    [ Back ]  [ Save provider ]
```

1. **Choose type**: preset cards from `presets.ts`. A preset sets `type`, the default `baseUrl`, a
   suggested `id`, `fetchModels`, header hints (OpenRouter: `HTTP-Referer`, `X-Title`) and a docs link.
   "OpenAI-compatible" and "Anthropic-compatible" are the custom entries.
2. **Connection**:
   - **ID** is filled in from the name as a slug and checked live for uniqueness. It is read-only once
     saved, because model references depend on it.
   - **Base URL** keeps the existing `analyzeError` hints, such as a missing `/v1` or an Ollama port
     mistake.
   - **API key source** is a radio choice:
     - **Paste**: a password input with `autocomplete="off"` and no reveal button.
     - **Env var**: a name input with a live `set / not set` badge, so the value never reaches the
       browser.
     - **No key**: allowed only for `ollama` and the compatible types.
   - **Advanced, headers**: key/value rows. A value may be `env:VAR`.
   - **Test connection**: sends the draft once to the backend, which calls `/models` (or a 1-token
     completion when there is no `/models`). It shows status, latency and model count, or the error
     with a hint. Saving is allowed without a passing test, but the provider then shows `Untested`.
3. **Models**:
   - The fetched list has search and checkboxes, and "Add model id manually" covers providers without
     a `/models` endpoint. For `aiGateway` this step reuses `GatewayModelPickerDialog` (the catalog
     with pricing).
   - `▸` opens the model config popover: label, context window, max output, pricing. It reuses the
     existing rate fields.
   - **Test selected** runs the existing ability test (`BatchTestModels`) and writes the tool-use,
     vision and reasoning tags into `modelConfigs`. The agent's main model requires `tool-use`.
- **Editing a stored key**: the field shows `Stored · sk-…9f2c   [Replace] [Remove]`. Leaving it
  alone keeps the key. **Replace** swaps in an empty password input. **Remove** sends `apiKey: ""`.
- **Unsaved changes**: closing the sheet with edits asks first, which keeps today's "unsaved gateway
  key" warning.

#### Shared `ModelPicker` (`features/app/components/ai/ModelPicker.tsx`)

A combobox grouped by provider, with search, capability badges and the provider's health. It accepts
a `requires` prop (`['tool-use']` for the agent main model, `embedding` for the embedding slot).
Models that don't qualify are shown disabled with the reason. A model whose provider isn't `Ready`
shows a warning icon. It is used by the Default models card, by Admin ▸ Agent ▸ Models, and later by
field AI. It replaces `AiModelSelect.tsx`.

#### Files (all under 500 lines)

```text
apps/nextjs-app/src/features/app/blocks/admin/ai-setting/providers/
  ProvidersCard.tsx · ProviderRow.tsx · ProviderHealthChip.tsx · DeleteProviderDialog.tsx
  ProviderSheet.tsx · steps/PresetStep.tsx · steps/ConnectionStep.tsx · steps/ModelsStep.tsx
  KeySourceField.tsx · HeadersEditor.tsx · ModelConfigPopover.tsx
  presets.ts · error-hints.ts (moved from LlmProviderForm) · useProviders.ts (react-query)
apps/nextjs-app/src/features/app/components/ai/ModelPicker.tsx
```

Kept and reused: the `LLM_PROVIDERS` icons in `constant.ts`, `BatchTestModels`,
`GatewayModelPickerDialog`, `model-test-utils`. Removed once the new UI reaches parity:
`AISetupWizard`, `LLMApiConfigStep`, `GatewayModelsStep`, `LlmproviderManage`, `LlmProviderForm`,
`AiModelSelect`. i18n keys live under `admin.setting.ai.providers.*` (en and zh). The space-level
BYOK integration UI is untouched.

#### UI rules

- No key ever reaches the browser. Lists use `apiKeyPreview`, and tests send a draft key only from the
  input it was typed into.
- Each provider is saved on its own through the provider endpoints (§6.3), never by PATCHing the
  whole `aiConfig`. Concurrent edits by two admins are caught with `version` (409, then "reload").
- After any save, `ModelPicker` refetches the provider list (one react-query key, `['ai-providers']`).

---

## 14. Migration and retirement

1. Provider migration on boot: give each existing provider an `id` (`<type>`, or `<type>-2`, …),
   encrypt its plain key, and rewrite stored `chatModel` keys from `@teable` to `@<id>`. Old keys stay
   valid through the alias. A configured Gateway key becomes the `vercel-gateway` provider (§6.1),
   with its model pool as that provider's `models`.
2. Old Mastra threads (`store_schema`) are **not migrated**. Those were per-user knowledge chats, and
   the new agent is admin only. They stay in the vector DB until it is cleaned up.
3. Vector data: a one-off P4 script imports whatever exists in Mastra's `vector_schema`. For each
   table it groups rows by `metadata.materialId`, orders them by `chunkIndex`, joins the text back
   together with the 400-character overlap removed, and ingests the result into a collection of the
   same name with `source_ref = legacy:<index>/<docName>`. Re-chunking and re-embedding are needed
   anyway because chunk sizes change. Registry rows with no vector table become empty collections.
   `credential` is skipped and reported. The Mastra schemas are dropped only after the import has been checked.
4. P4 removes: `apps/mastra-ai`, the `MASTRA_*` and `AI_GATEWAY_API_KEY` env vars,
   `features/ai/service/mastra-client.service.ts`, `features/ai/agents/*`, the thread routes in
   `ai.controller.ts`, and `chat-panel/` (replaced by `blocks/agent/`). `features/ai-data` stays,
   because the MCP server and its read-as-user semantics still fit there. Its internal Mastra endpoint
   goes.

---

## 15. Phases

| Phase | Scope | Done when |
|---|---|---|
| P0 Providers | secret cipher, provider `id`/encryption/masking/`apiKeyEnv`/headers/`fetchModels`/`anthropicCompatible`, resolver alias, Gateway-as-provider migration, provider routes (§6.3), Provider Setup UI and `ModelPicker` (§13.1) | Ollama and vLLM added through the UI work side by side; an env-var key shows `Not set` until the var exists; no API response or page contains a stored key (Playwright checks the network log); deleting a provider in use is blocked; an existing Gateway setup shows up as a provider; field AI still works |
| P1 Skeleton | `features/agent` layers, guard, robot user, `AgentExecutionContext` and the permission bypass, Prisma tables, `agent` pack and seeds, `EnsureInstallation` (incl. Agent space, membership reconcile, lock-down checks), enable, status | enable creates the Agent space, base and 6 tables; deleting a field and restarting repairs it; a non-admin added to the space by SQL is removed at the next check; invite and share on the Agent space return 403; non-admin gets 403 everywhere |
| P2 Runtime | `RunTurn`/`ResumeTurn`, context builder, memory/skills/threads/setup/credentials toolkits, persistence, SSE, agent panel and page, approvals, background jobs | a chat persists to the tables; "remember X" creates a memory row that is used next turn; an approval round-trip works |
| P3 Data | data_read/data_write/schema/sql_read/http toolkits, vault and secret entry, SSRF guard, audit viewer | the agent edits a base it has no role in; a delete asks for approval; a skill calls an outside API with a credential it never saw |
| P4 Knowledge | `agent_rag` schema, chunker, ingest jobs and derived sync, hybrid query, embedding spaces, eval runner, legacy import, removal of Mastra and the old chat | hybrid recall@5 ≥ the recorded baseline (§11.6); switching the embedding model keeps search working; `apps/mastra-ai` is deleted |
| P5 Hardening | prompt-injection suite, load test (thread with 500 messages), docs | §16 passes |

---

## 16. Testing

- **Unit (domain)**: `ApprovalPolicy`, `ContextBudget` trimming, memory ranking and deduplication, RRF
  merge, secret cipher round trip and AAD mismatch, model-key alias resolution.
- **Integration**: `EnsureInstallation` against a disposable Postgres (the same recipe as the email
  e2e): fresh install, rerun is a no-op, repair after deleted table or field or a rename, seeding once,
  and an edited built-in skill is kept.
- **Security e2e**: every `/api/agent/**` route as a non-admin, as a PAT, as a share link and as
  anonymous gets 403 or 401. An HTTP request can't reach `agentRun` (no header or body path). Secrets
  never appear in `agent_messages`, audit `args`, tool results or `GET` responses. `http_request` to
  a non-allowed host, to `169.254.169.254` or to `localhost` is refused. On the Agent space and
  base, invitations, invite links, base share links, template publish and moving the base return 403,
  and a non-admin collaborator inserted directly into the database is removed at the next check.
- **Agent behaviour** with AI SDK `MockLanguageModelV3` scripts: tool order, approval pause and
  resume, cancel, a tool error going back to the model, step cap. Plus a small live eval set
  (10 knowledge questions, 5 data edits) run by hand against a real model before each phase is closed.
- **Retrieval**: the §11.6 eval runner (recall@5, MRR) in CI against a disposable schema, plus unit
  tests for the chunker (heading paths, overlap, very long sections), skipping unchanged content, and
  atomic replace (a failed embed leaves the old chunks searchable).

---

## 17. Risks and open questions

| Risk / question | Proposed answer |
|---|---|
| ~~What is "the first database"?~~ | **Decided 2026-10-26**: a dedicated `Agent` base in a system-managed `Agent` space (§7.1) |
| ~~Can non-admins read agent memory and threads?~~ | **Resolved** by the Agent space: membership is reconciled to the admin set; invites and shares are refused |
| ~~Should non-admins keep any AI chat?~~ | **Decided 2026-10-26: no.** The chat panel and the old chat routes are removed for everyone; only the Agent remains |
| An admin's personal access token can read the Agent base through the normal table API | Accepted: admins can read it in the UI anyway. A PAT whose scope covers the Agent space is labelled as such on the token page |
| Another admin can read your threads by opening the Agent base | Accepted: every admin has full access by design. The agent page shows only your own threads, but the table does not hide them. Note this in the enable dialog |
| Message volume in a Teable table | Fine at admin scale; `AgentStorePort` allows a Prisma store for messages later without changing the tools |
| An unrestricted agent plus prompt injection | Approvals, host allowlist, caps, untrusted wrapping, audit (§9.3). Approvals stay on for deletes and schema changes |
| AI SDK 6 approval API changes | Pinned version; `tool-wrapper` is the only file that touches `needsApproval` |
| Losing the embedding key makes vectors unusable | Keyword fallback is always available; reindex jobs are idempotent |
