# Admin-only agent: implementation report

Branch `feat/agentic-database`, 2026-10-27. Implements `current-design.md` (P0–P5, CYBERDATA steps
01–41). 38 commits from `9036215` to the report commit, nothing pushed. 335 files changed, about
+28,200 / −5,900 lines without the lockfile and `apps/mastra-ai`. Removing Mastra and the old chat
took out another 13,500 lines.

## 1. Status

| Phase | Done when (design §15) | Result |
|---|---|---|
| P0 Providers | Ollama and vLLM side by side, env-var keys, no stored key in any response, Gateway migrated | Done (steps 01–08) |
| P1 Skeleton | enable creates space, base and 6 tables; repair; membership reconcile; lock-down; non-admin 403 | Done (09–17) |
| P2 Runtime | chat persists, "remember X" is used next turn, approval round-trip | Done, live 15/15 (18–25) |
| P3 Data | edits a base it has no role in, delete asks, skill uses a credential it never saw | Done, live (26–30) |
| P4 Knowledge | hybrid recall@5 ≥ baseline, model switch keeps search up, `apps/mastra-ai` deleted | Done (31–38) |
| P5 Hardening | prompt-injection suite, 500-message load test, docs | Done (39–41) |

### What you may want to act on

1. **PM updates are queued, not posted.** The cybernetics-project MCP server disconnected
   mid-session. Comments and state changes for CYBERDATA-87 to 105 (P2–P5) are saved in the
   session scratchpad file `pm-pending.md`, ready to post when it reconnects.
2. **Leftover Redis keys.** Early in the work, about 50 `bull:agent-jobs:*` keys went to your
   platform Redis (127.0.0.1:30490), before the test environment was pinned. They are harmless.
   Say the word and I'll delete them; I left them alone.
3. **Legacy knowledge import on the real vector DB.** By rule, nothing ran against :30898.
   Procedure (§8): dry run first, then the real run, check the result, and only then drop the
   Mastra schemas by hand.
4. **`BACKEND_SECRETS_ENCRYPTION_KEY`** is not set in dev. Secrets then use a key derived from
   `SECRET_KEY`, and the status page warns about it. Set a dedicated key before production.
5. **Existing installations** keep their seeded approval list. The new `knowledge_write` category
   (ingest, collection changes) is on for new installs only. Turn it on in Admin ▸ Agent if you
   want it on yours. `collection_delete`, `delete_table` and `delete_field` always ask.
6. **One e2e failure that predates this work:** `test/mcp.e2e-spec.ts` › "deletes records and
   leaves them restorable" fails because `get_record` on a deleted record returns "Can not get
   record". It fails the same way without these changes, as does `import-base` ("Invalid URL").

## 2. What was built

### P0: Providers (`9036215`…`5ebddea`)

- `SecretCipher`: AES-GCM per purpose (`ai-provider`, `agent-credential`) with associated data
  (AAD), so a ciphertext can't be moved to another row.
- Providers get stable ids, env-var keys (`apiKeyEnv`, with deny-listed patterns), custom headers
  and an `anthropicCompatible` type. Keys are encrypted at rest and only masked previews leave
  the server.
- The model-key resolver works by provider id and keeps `@teable` as an alias. A configured
  Gateway key becomes the `vercel-gateway` provider.
- Provider routes under `/api/admin/ai`. A Provider Setup UI in Admin ▸ AI Settings, a shared
  `ModelPicker` and a Default models card.

### P1: Skeleton (`7ee7a85`…`2f9e3ae`)

- **Agent robot user** and `AgentExecutionContext`. A run is a fresh CLS context with the robot
  user and owner permissions; `PermissionService` honours the bypass only for the robot inside a
  run, and no HTTP path can produce it.
- **Prisma tables** `agent_installation`, `agent_secret`, `agent_run`, `agent_audit_log`.
- **Agent schema pack**: 6 tables, built-in skills and a default profile.
- **`EnsureInstallation`** creates the Agent space and base, then verifies and repairs tables and
  fields, reconciles membership to the admin set, seeds once, and supports restore from the trash.
- **Lock-down** of the Agent space: no invites, invite links, shares, template publishing or
  base moves.
- **Lifecycle routes**: enable, disable, verify, reset and status.

### P2: Runtime (`bad74e6`…`e9ac5d1`)

- **`AgentTableStore`**: the agent's data lives in the Agent base, addressed by pack keys, so
  admin renames don't break it.
- **Policies**: context budget, approval policy, memory ranking.
- **Toolkit registry and tool wrapper**: untrusted-data fencing, approvals through AI SDK
  `needsApproval`, and an audit row per call.
- **Turns**: `RunTurn` and `ResumeTurn` run on `ToolLoopAgent` with a UI message stream. A turn
  gate allows one run per thread, and turns can be cancelled.
- **Toolkits**: memory, skills, threads, setup, credentials.
- **Background jobs** (BullMQ, or the in-process fallback): title, rolling summary, memory
  extraction, usage and cost.
- **Frontend**: the agent panel (context chip, `/` skill picker, approval cards, tool steps), the
  `/agent` page with threads and usage, and Admin ▸ Agent (setup, credentials, audit, restore).

### P3: Data (`9c704a6`…`15e9d1b`)

- **`data_read`**: spaces, bases, tables, describe, query, get, aggregate and search across every
  space.
- **`data_write`**: create, update and delete records, at most 100 per call; deletes go to the
  trash.
- **`schema`**: create and update tables and fields; deletes always ask.
- **`sql_read`**: through the base read-only SQL executor, capped at 200 rows, plus
  `sql_tables`.
- **Secrets**: a vault on `SecretCipher`. Secret values are write-only through
  `PUT /api/agent/credentials/:id/secret` and are never returned.
- **`http_request`** has an SSRF guard. Addresses are resolved and pinned, then private,
  loopback, link-local, metadata, CGNAT and multicast ranges are refused. Redirects are not
  followed. Credentials are injected per host and method, and secrets are scrubbed from
  responses, including base64 and URL-encoded forms.

### P4: Knowledge (`3d71911`…`960c33b`)

| Step | Commit | What |
|---|---|---|
| 31 | `3d71911` | `agent_rag` schema with collections, documents, sectioned chunks and one vector table per embedding space (HNSW); `PgRagStore`, lazy connect, schema DDL under an advisory lock |
| 32 | `b236200` | Structure-aware chunker: heading trail `A › B › C`, ~1000-char chunks with 120 overlap at sentence ends (CJK aware), sections ≤ 4000, records as one section |
| 33 | `dcbedf3` | Ingest jobs: extract (text, chat file or attachment via pdf/docx parsers, URL through the SSRF guard, record) → hash → skip if unchanged → chunk → embed in batches of 100 → one transaction. Derived sync of knowledge tables and `agent_memory` from record events. `agent_setup.knowledge_tables` (empty means auto-detect title + `context`) |
| 34 | `d8ca44c` | Knowledge toolkit: `knowledge_search`, `rag_search`, `rag_read`, `rag_ingest`, `rag_ingest_status`, `collection_list/create/delete`. Hybrid RRF over 40 candidates, optional rerank (AI SDK `rerank()`), small-to-big by section, snippets ≤ 400 chars, `min_score`, failed collections reported |
| 35 | `c9ed6a9` | Embedding model switch: changing `embedding_model` builds the new space in the background while search uses the active one; new ingests write to both; backfill → activate → catch-up; retired tables dropped after 7 days |
| 36 | `abc2d6f` | `pnpm -F @teable/backend rag-eval`: golden set, runner, baseline (§4) |
| 37 | `eb22018` | `POST /api/agent/admin/knowledge/import-legacy {dryRun}`: rebuilds documents from Mastra's overlapping chunks and re-ingests them as `legacy:<index>/<docName>`; skips `credential` |
| 38 | `960c33b` | Removed `apps/mastra-ai`, `MastraClientService`, the old agents, the Mastra thread routes, the chat panel, and the internal ai-data endpoint with its context tokens. `MASTRA_*` env, the dev script, `start.sh` and the Dockerfile no longer reference Mastra |

### P5: Hardening (`c20466c`, `c783620`, this report)

- **Prompt-injection suite** (§5) and **500-message load test** (§6).
- Both turned up a real bug, now fixed (§7, items 1 and 2).

## 3. Architecture as built

```text
interface/        agent-chat, agent-lifecycle, agent-settings controllers; AgentAdminGuard
application/      chat (run, resume, cancel, gate), installation (ensure, seeder, membership,
                  exposure), admin (configure, credentials), threads, status, jobs (turn jobs),
                  knowledge (ingest, search, embedding spaces, legacy import, rag jobs)
domain/           entities, policies (approval, context budget, memory ranking),
                  ports (store, run, model, audit, data, secret/http, rag + source reader)
infrastructure/   store (table repo, codecs, entity specs, deadlock retry), runs, audit, data
                  gateway and writer, secrets vault, outbound http + network policy, llm adapter,
                  knowledge (pg store, query builder, chunker, source reader, sync listener,
                  Mastra legacy reader), jobs (agent-jobs, agent-rag processors)
runtime/          agent runtime, context builder, tool assembler, turn recorder, message mapper
toolkits/         memory, skills, threads, setup, credentials, data_read, data_write, schema,
                  sql_read, http, knowledge
pack/             agent.pack.json (6 tables), defaults, built-in skills
```

The agent's own data (setup, memory, threads, messages, skills, credential metadata) lives in the
Agent base, which admins can read and edit. Runs, audit and secrets live in Prisma tables. Knowledge
lives in `agent_rag` in the vector database.

## 4. Retrieval evaluation (design §11.6)

Corpus: 12 documents (2 in Chinese) and 10 knowledge records, all synthetic company material.
Questions: 32 (paraphrase, exact codes, CJK). Models through AI Gateway:
`openai/text-embedding-3-small`, rerank `cohere/rerank-v3.5`.

| Configuration | recall@5 baseline → now | MRR@5 baseline → now | p50 / p95 ms |
|---|---|---|---|
| keyword only | 0.094 → **0.938** | 0.094 → 0.897 | 2 / 4 |
| vector only | 1.0 → 1.0 | 1.0 → 1.0 | 720 / 920 |
| hybrid | 1.0 → 1.0 | 1.0 → 0.979 | 717 / 900 |
| hybrid + rerank | 1.0 → 1.0 | 0.984 → 0.984 | 1741 / 2207 |

- **Gate.** Hybrid recall@5 must stay at or above the recorded baseline. It passes.
- **Keyword-pass change.** The baseline showed the keyword pass was nearly useless: it required
  every word of the question to match. It now ORs the meaningful terms (stopwords dropped).
  Keyword-only search, the mode when no embedding model is set, went from 9% to 94% recall.
  Hybrid MRR dropped slightly, with about one question now ranking second.
- **Rerank** adds about 1 s and no recall on this set, which supports keeping it off by default.
- **CJK keyword recall is 0.** The `simple` parser treats a CJK run as one token; vectors cover it.
- **The set is too easy.** Hybrid already scores 1.0, so it can't separate configurations.
  Extend it with harder questions drawn from your real knowledge records before tuning anything
  (§10).

## 5. Prompt-injection suite (`test/agent-injection.e2e-spec.ts`, 10/10)

The model is scripted to obey instructions planted in records, documents and pages. The suite
checks that the rails hold anyway:

- The system prompt says untrusted data is never instructions. Record, document and page text
  reaches the next model step wrapped as `untrusted_data`.
- A planted "delete every record" stops at the approval. A denial deletes nothing.
- `delete_table` and `collection_delete` ask even with every approval switched off.
- These are refused:
  - a GET to an unknown host;
  - the metadata IP 169.254.169.254;
  - a credential used against a host it isn't allowed for.
- A POST to an allowed host waits for approval.
- The credential secret never appears in tool output, prompts, `agent_messages` or the audit log.
- `setup_update` needs approval.
- A planted loop is cut at `maxSteps`.
- Refused calls are audited.

## 6. Load: a 500-message thread (`test/agent-load.e2e-spec.ts`, 5/5)

Scripted model, in-process jobs, local disposable Postgres.

| Measure | Result |
|---|---|
| Append 500 messages (batches of 100) | 8.6 s |
| `GET /api/agent/threads/:id/messages` (all 500, in order) | 0.3 s |
| History sent to the model | 201 messages, ~22.6k tokens (budget 24k) |
| Turn latency on the long thread (8 turns) | p50 1.57 s, p95 1.60 s |
| Delete the thread with its 500 messages | 0.7 s |

## 7. Bugs found and fixed along the way

1. **Deadlocks between a turn and the previous turn's background jobs.** Both write linked rows
   in the Agent base, and a quick follow-up message got a 500. Agent table writes now retry on
   Postgres 40P01/40001 (`infrastructure/store/retry.ts`).
2. **Messages older than the 200-message history window were never summarised.** The drop count
   only covered budget drops inside the window. Threads now record `summary_through_seq`, and the
   summary job folds unsummarised older messages in, oldest first, 200 per run, once 10 or more
   are pending.
3. **The in-process fallback queue's `addBulk` silently dropped every job.** This affected any
   caller when Redis is off. Fixed in `local-queue.provider.ts`.
4. **Keyword search needed every word of the question** (§4).
5. **A record's title was embedded twice**, and a document's title once more in front of its own
   top heading. Fixed in `embeddingText`.
6. **A type error introduced in step 36** (`knowledge-search.ts`) was fixed in step 37. Commit
   hooks lint but don't typecheck, so it slipped through one commit.

## 8. Operating notes

| Env var | Meaning |
|---|---|
| `AGENT_RAG_DATABASE_URL` | Knowledge store; falls back to `VECTOR_DATABASE_URL` |
| `VECTOR_DATABASE_URL` | Also the source of the legacy Mastra import |
| `AGENT_HTTP_ALLOWED_HOSTS` | Hosts `http_request` may reach without a credential |
| `AGENT_HTTP_ALLOW_PRIVATE_NETWORKS` | Dev and test only |
| `AGENT_HTTP_TIMEOUT_MS`, `AGENT_HTTP_MAX_RESPONSE_BYTES` | Outbound limits |
| `BACKEND_SECRETS_ENCRYPTION_KEY` | Key for provider keys and agent secrets |
| `AI_GATEWAY_API_KEY` | Default `apiKeyEnv` of the `vercel-gateway` provider (kept, §9) |
| `RAG_EVAL_EMBEDDING`, `RAG_EVAL_RERANK`, `RAG_EVAL_RECORD`, `RAG_EVAL_DATABASE_URL` | Eval runner only |

Removed: `MASTRA_URL`, `MASTRA_API_KEY`, `AI_DATA_CONTEXT_TTL_SECONDS`.

**Legacy import.**
1. As an admin: `POST /api/agent/admin/knowledge/import-legacy {"dryRun": true}`. It reports per
   index: documents, chunks, and whether it would import, is empty, was skipped as a secret, or
   has an invalid name.
2. Run it without `dryRun` and watch the documents become `ready` (`rag_ingest_status`, or
   `collection_list`).
3. After checking, drop `vector_schema`, `index_schema`, `store_schema` and `job_schema` by hand.

**Embedding model.** Set `embedding_model` in Admin ▸ Agent (or with `setup_update`). The new
space builds in the background, and `collection_list` shows its progress. Without an embedding
model, search is keyword-only and says so in its warnings.

**Knowledge tables.** Every table with a primary field and a text field named `context` syncs
automatically. List table ids in `agent_setup.knowledge_tables` to choose them yourself.

**Eval.** `AI_GATEWAY_API_KEY=… pnpm -F @teable/backend rag-eval`. It uses the local disposable
`agent_rag_eval` database; `RAG_EVAL_RECORD=1` records a new baseline.

## 9. Deviations from the design

| Design | As built | Why |
|---|---|---|
| Panel on `useChat` from `@ai-sdk/react` | A hook on `ai`'s `AbstractChat` | Same behaviour without a second copy of `ai` |
| Agent chat keeps file upload | Text only in v1 | The chat API takes text; `rag_ingest` accepts chat-file tokens |
| `oauth2_client_credentials` credentials | Not supported | Not needed for v1 targets |
| — | `sql_tables` added | The model needs physical table and column names to write SQL |
| — | View shares locked down too; AiData schema cache invalidated after schema tools | Gaps found while building |
| Approval categories (§7.2) | Plus `knowledge_write` | Design §8 wants ingest and collection delete to ask |
| §14.4 removes `AI_GATEWAY_API_KEY` | Kept | P0 made it the `vercel-gateway` provider's key |
| Golden set from real records (§11.6) | Synthetic corpus | Keeps personal data out of the repo; extend it with real questions |
| Legacy import as a "script" | Admin route with a dry run | Runs inside the app with its ingest pipeline and audit |
| `agent_setup` | Plus `knowledge_tables`; `agent_threads` plus `summary_through_seq` | §11.3 "admin can edit the list"; bug 7.2 |

## 10. Known limitations and next steps

- **Retrieval.** Extend the golden set with real questions (harder ones, near-duplicates,
  multi-document answers) before changing chunk sizes, RRF k or `min_score`. Consider CJK
  bigrams for the keyword pass.
- **Search scope.** Search is per instance. Knowledge-table sync follows record events, so data
  written with raw SQL isn't seen until the record changes.
- **Stale builds.** A space left in `building` for a model that is no longer configured stops
  receiving writes but keeps its table; only retired spaces are dropped.
- **URL ingest** reads text and HTML. Binary files over HTTP (for example PDF) aren't parsed;
  upload them as files instead.
- **Live check with a real model.** Run the injection suite's scenarios once against a real model
  through the panel before production. The automated suite proves the rails, not the model's
  judgement.
- **Turn latency** of ~1–1.5 s with a mock model is mostly reading the Agent base (history,
  memories, skills). It is fine at admin scale; a Prisma message store is the documented next
  step if it isn't.

## 11. Verification summary

- **Backend unit:** 128 agent tests, and 247 across agent, ai, ai-data, setting and ai-provider.
- **Agent e2e:** 17 suites, 100 tests, run against the disposable Postgres container
  `agent-e2e-pg`.
  - installation, lifecycle and lock-down: 22;
  - store 6, chat 10, admin 4;
  - data-read 6, data-write 4, sql-read 3, credentials 4;
  - rag-store 6, rag-ingest 6, knowledge-toolkit 7, rag-spaces 4, legacy-import 3;
  - injection 10, load 5.
- **Other e2e:** ai-data 11/11 (rewritten).
- **Other unit:** openapi 127/127, frontend agent and admin 29/29.
- **Type checks:** clean for backend, openapi, sdk and nextjs-app.
- **Live, on the dev server** with a scripted model:
  - P2 UI walkthrough 15/15, repeated after the Mastra removal;
  - Admin page 8/8;
  - P3 chat API checks;
  - P4 chat API checks (ingest approval, keyword search, read, collections, legacy dry run).

**Test environment.**
- Disposable Docker Postgres `agent-e2e-pg` on :5432, with the `agent_rag_dev`, `agent_rag_test`
  and `agent_rag_eval` databases.
- Dev server on :3000 and scripted fake models on :18080 to :18082.
- Your k3s databases and Redis were not used, apart from the stray keys in §1.
