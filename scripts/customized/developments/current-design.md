# Agent follow-up: search over every table, `/clear`, and the review fixes

Status: **designed 2026-10-27; P0 in progress**. Branch: `feat/agentic-database`.
The previous content of this file (the admin-only agent design, now implemented) is in git
history: `git show e6a3eb4:scripts/customized/developments/current-design.md`. What was built is
in `implementation-report.md`.

Every "today" statement was read from the working tree on 2026-10-27 (HEAD `e6a3eb4`). Paths are
relative to `apps/nestjs-backend/src/features/agent/` unless they start with `apps/` or
`packages/`. Data figures come from the local copy of k3s (`agent-e2e-pg`, db `cybernetics_k3s`).

---

## 1. Summary

The review of 2026-10-27 found that search only sees knowledge tables, that the skill seeding left
dead `rag_search`/`knowledge_search` instructions active, and a set of reliability and security
bugs. This plan covers all of it:

| Part | What changes |
|---|---|
| A. Skills | Built-in skills upgrade in place; the stale v1/v2 duplicates are cleaned up; `rag-search` becomes `document-search` (§3) |
| B. Search over everything | Every table outside the Agent base is indexed, minus an exclusion list; sync becomes a background job that follows schema changes (§4) |
| C. Slash commands | `/clear` starts a fresh thread; `/skill-name` loads that skill on the server instead of hoping the model does (§5) |
| D. Security fixes | Agent-base tables are off limits to data tools; credential previews and SSRF gaps closed; admin membership reconciled on a schedule (§6) |
| E. Reliability fixes | Disconnects, failed launches, cut-off tool calls, oversized messages, summary gaps, lock and cancel races (§7) |
| F. Frontend thread state | Stale history, archive reset, panel reopen (§8) |
| G. Smaller fixes | `sql_read` wrapper, credential test, leftovers (§9) |

Phases and order are in §10, tests in §11, open questions in §12.

---

## 2. Current state

### 2.1 Search

- One `search` tool (`toolkits/knowledge/knowledge.toolkit.ts:232`). PostgreSQL full text over the
  `agent_rag` schema in the main database. Chunks carry a `tsvector`: title and heading path
  weighted A, text D (`infrastructure/knowledge/pg-rag-store.ts:221`). GIN index on level-1 chunks.
  CJK runs indexed as character pairs (`rag-query.ts:122`).
- Query: stopwords dropped, each word ORed, last word also a prefix, quoted input uses websearch
  syntax; `ts_rank_cd`, 40 candidates, grouped by section, top 5 as ~400-character snippets.
- Collections: `kb_records` (knowledge tables), `agent_memory`, `knowledge` (documents).
- Which tables: `infrastructure/knowledge/knowledge-tables.ts:339`. Either the table ids in
  `agent_setup.knowledge_tables`, or (empty list) any table with a primary field plus a text field
  named `context`. Every other table is skipped.
- Sync: record events queue one ingest job per record (`knowledge-sync.listener.ts`). A full sync
  runs **once per process**, on the first search (`knowledge-ingest.ts:153`), one record per
  `getRecordsById` call. `KnowledgeSyncListener.invalidate()` is never called. The `sync` job type
  exists in `rag-jobs.processor.ts:38` but nothing queues it.
- `data_read.search_everywhere` (`infrastructure/data/unrestricted-data-gateway.ts:171`) is a second,
  live search: names of spaces, bases and tables, plus 3 rows from each of the first 10 tables of
  one base. It overlaps with `search` and misses most data.

Volume today: 48 tables in 3 bases, about 3,000 records, 12 MB of table data; 399 documents in
`kb_records`. Indexing everything is small.

### 2.2 Skills and slash commands

- `/name` is only a picker in `apps/nextjs-app/.../agent/components/AgentComposer.tsx:21`; the text
  goes to the server as is. The system prompt says "a message that starts with /name asks for that
  skill" (`runtime/context-builder.ts:56`); the model has to call `skill_load` itself. `manual`
  skills are not in the catalogue, so the model does not know them.
- Seeding (`application/installation/agent-seeder.ts:22`) never upgrades a built-in. A newer
  version is added as `name-vN` with `is_active: false`, but `is_active` is a checkbox with
  `defaultValue: true` (`pack/agent.pack.json`), so the row comes out active. Seeding only runs
  when `seededVersion < AGENT_SEED_VERSION` (`pack/agent-defaults.ts:43`, now 2).

The k3s copy holds right now:

```text
knowledge-search     v1 active  body calls knowledge_search (tool gone)
knowledge-search-v2  v2 active
rag-search           v1 active  body calls rag_search (tool gone)
rag-search-v2        v2 active
```

---

## 3. Part A: skills that upgrade cleanly

### 3.1 Upgrade in place when the admin has not edited the skill

- `pack/builtin-skills.ts`: each built-in keeps the sha256 of every body it ever shipped
  (`shipped: { version: number; bodyHash: string }[]`), plus `renamedFrom?: string[]`.
- `planSkillSeeds` gets the stored `body` (add it to the projection in `AgentSeeder.seed`) and
  returns three kinds of action:
  - `create`: no row with this name (or any `renamedFrom` name). Active.
  - `upgrade`: a `source = builtin` row with an older version whose body hash is in `shipped`.
    Update body, description, toolkits, category, invocation, version (and name, for a rename) in
    place. The record id stays, so links from `agent_setup.always_skills` keep working.
  - `offer`: the row was edited. Add `name-vN` inactive, as today.
- Clean-up of the current state, in the same pass: when both `name` (unedited) and `name-vN`
  (`source = builtin`, body equal to the shipped vN) exist, upgrade `name` and delete `name-vN`.
- Bump `AGENT_SEED_VERSION` to 3 so existing installs run the seeder once.

### 3.2 Writing an inactive row

Teable turns `false` into an empty cell and then applies the field default (`true`) on create. The
seeder creates the row and then updates `is_active` to `false` in a second call (updates do not
apply defaults). Covered by an e2e test against a real table, since this is Teable behaviour. The
same rule goes into a note in `infrastructure/store/entity-specs.ts` for any future create with a
false checkbox.

### 3.3 Names

- `rag-search` becomes `document-search` (`renamedFrom: ['rag-search']`), description unchanged.
- `skillNameSchema` (`toolkits/skills/skills.toolkit.ts:12`) refuses reserved names: `clear`,
  `new`, `help` (§5).

---

## 4. Part B: search over every table

### 4.1 Decision

Index every table into the existing full-text store, rather than searching tables live at query
time. A live search would hit all 48 tables per query with an unindexed text match, could not
rank results across tables, and would get slower as data grows. The index keeps one ranked query,
snippets and CJK matching, and costs a few MB at today's volume.

### 4.2 Settings (`agent_setup`, pack change)

| Field | Type | Meaning |
|---|---|---|
| `search_scope` | singleSelect `all` · `knowledge` | `all` (default): every table outside the Agent base. `knowledge`: today's behaviour |
| `search_exclude` | longText, one id per line | Base ids (`bse…`) or table ids (`tbl…`) never indexed, e.g. tables with secrets or HR data |
| `knowledge_tables` | unchanged | Which tables are *knowledge* tables (collection `kb_records`); others go to `records` |

Files: `pack/agent.pack.json` (bump `AGENT_PACK_VERSION`; the installation check adds missing
fields), `infrastructure/store/entity-specs.ts`, `domain/entities.ts` (`IAgentProfile`),
`toolkits/setup/setup.toolkit.ts` (`setup_update` accepts both; still needs `setup_change`
approval), `application/admin/contracts` and the agent status view if it lists settings.

### 4.3 Collections

- New derived collection `records` ("All tables: records of every other table, kept in sync"),
  seeded in `infrastructure/knowledge/rag-schema.ts` with `ON CONFLICT DO NOTHING`, and added to
  `builtinCollections` in the knowledge toolkit.
- Each table belongs to exactly one collection: the memory table → `agent_memory`; a knowledge
  table → `kb_records`; any other included table → `records`. Nothing is indexed twice.
- `search` without `collections` searches every active collection, so it covers everything.
  `/knowledge-search` keeps `collections: ["kb_records"]` and stays focused.

### 4.4 Which tables (`knowledge-tables.ts`, renamed `SearchTables`)

`resolve(tableId)`:

1. Table or base deleted → none.
2. Memory table → `agent_memory`.
3. Agent base → none.
4. In `search_exclude` (table id or its base id) → none.
5. Knowledge table (configured id, or detected by a `context` field when the list is empty) →
   `kb_records`, watching title, context and `deleted_at` as today.
6. `search_scope = all` → `records`, watching every field (`watch: null`).
7. Otherwise none.

Tables are always identified by id. Names are never stored in the index (§4.7), so renaming a
table, base or field never breaks search.

### 4.5 Record text (`infrastructure/knowledge/record-text.ts`, new)

Knowledge tables keep today's text (title plus `context`). For `records`:

- Read with `cellFormat: CellFormat.Text` (`record.service.ts:218` uses each field's
  `cellValue2String`), so dates, numbers, currency, selects, users and links read as in the UI.
- Title: the primary field. Body: one `Field name: value` line per non-empty field, in field order.
- Left out: the primary field (already the title), `button`, `autoNumber`, `createdTime`,
  `lastModifiedTime`, `createdBy`, `lastModifiedBy`, and a `deleted_at` field. Attachments by
  file name only (reading file contents is out of scope, §12).
- Included: formula, rollup and lookup values (lookups often carry the linked record's name).
- Each value is capped at 20,000 characters; the record keeps the existing
  `MAX_DOCUMENT_CHARS` limit.
- A record whose `deleted_at` is set is removed from the index, as today.

`source-reader.ts` `readRecord` calls this for one record; the sync calls it for a page (§4.6).

### 4.6 Keeping the index current

**Sync state.** New table `agent_rag.sync_state` (`table_id` PK, `collection_id`,
`status` idle·running·failed, `records`, `last_full_sync`, `error`), created in `rag-schema.ts`.

**Jobs** (all on the existing `rag-jobs` queue):

| Job | Queued when | Does |
|---|---|---|
| `sync` | the agent is enabled; boot (30 s delay); `setup_update` changes scope, exclusions or knowledge tables; nightly (BullMQ repeatable) | Works out the target tables, queues `sync-table` for each, removes documents of tables no longer targeted |
| `sync-table` | `sync`; `TABLE_CREATE`; `TABLE_FIELD_CREATE/UPDATE/DELETE` (field names are in the text); table restored from trash | Reads the table a page (500) at a time with text cells; compares each record's hash with the stored hashes (one query per page); re-chunks only what changed; then removes documents of that table whose record is gone |
| `ingest-records` | record create or update event | One job per event with all its record ids; reads them in one `getRecordsById` call |
| `remove-table` | `TABLE_DELETE` | Deletes every document with that `table_id` |
| `remove` | record delete event | As today |

- Job ids `sync` and `sync-table:<tableId>` deduplicate across replicas, so one replica runs
  each sync.
- `setup_update` and the schema listeners call `SearchTables.invalidate()` (today never called).
- `search` stops starting syncs and stops waiting 10 s. When any `sync_state` row is `running`,
  the result carries a warning ("indexing N tables; results may be incomplete").
- The nightly sync also catches lookup and formula values that changed through edits in other
  tables (check during build whether Teable already emits record events for those; if so, the
  nightly run is only a safety net).

**Concurrency** (also fixes review bug 11). `replaceChunks` starts its transaction with
`SELECT … FROM agent_rag.document WHERE id = ? FOR UPDATE`, re-reads the hash under the lock and
skips when it is already current. Two jobs for one record then run one after the other instead of
writing two chunk sets.

### 4.7 Tool and result changes

- `search` description: "every table (records), knowledge records, documents and memories".
  Inputs unchanged (`collections`, `baseIds`, `tables`, `topK`).
- Each result with a `recordRef` gains `table` and `base` names, looked up at query time from
  `table_meta` and `base` for the ids in the page of results (one query). Renames show up at once.
- `search_everywhere` (`data_read`): keeps the space, base and table *name* search; the per-base
  row scan goes, and the description points to `search` for records.
- Ranking: no collection boost at first. If the eval (§11) shows knowledge records pushed down
  by ordinary records, add a weight per collection in `buildSearchQuery`.

### 4.8 Skills

- `data-navigation` (always loaded) gains: "To find something by words anywhere, call `search`
  first; then read the record with `get_records`."
- `knowledge-search`, `document-search` unchanged apart from §3.

### 4.9 Cost and privacy

- Every included cell's text is copied into `agent_rag` in the main database. At today's volume
  that is a few MB plus the GIN index; measure with `pg_total_relation_size` after the first sync.
- The agent can already read every table, so the index exposes nothing new to the agent. It does
  surface sensitive values more easily, which is what `search_exclude` is for. The plan's default
  is `all`; see §12 for the alternative.

---

## 5. Part C: slash commands

### 5.1 `/clear` (frontend; starts a new thread)

- `components/AgentComposer.tsx`: a fixed list of commands (`clear`: "Start a new conversation")
  shown above the skills in the picker. An exact `/clear` (or `/new`) calls a new `onClear` prop
  instead of `onSend`.
- `AgentChatView.tsx`: passes `onClear` through. While a reply runs, it stops the run first
  (`onStop`), then clears.
- `AgentPanel.tsx`: `onClear` = `startNew`. `AgentPage.tsx`: `onClear` = `openThread()` plus a
  `chatKey` bump (the same helper as the `+` button, §8).
- Old threads stay listed and searchable with `thread_search`. Pinned memories still load in the
  new thread.

A "reset marker inside the same thread" (keep old messages above a divider) is not planned: it
needs a thread field, context-builder and summary changes and a new endpoint, about ten files, for
little gain over a new thread.

### 5.2 `/skill-name` handled on the server

- `application/chat/run-turn.usecase.ts`: when the message starts with `/name` and `name` is an
  active skill (any invocation, including `manual`), the turn loads it and `ContextBuilder` adds
  `## Skill requested by the admin: <name>` with its body to the system prompt for this turn. The
  rest of the message is the request.
- An unknown `/name` goes to the model unchanged.
- `context-builder.ts:56`: the line "A message that starts with /name asks for that skill" goes,
  since the server handles it now.
- Result: `/knowledge-search …` always follows the skill, and `manual` skills become usable.

---

## 6. Part D: security fixes

| # | Fix | Files |
|---|---|---|
| D1 | **Agent base off limits to data tools.** `UnrestrictedDataWriter.resolve` and every schema operation refuse a table or base where `isAgentHome` (`infrastructure/agent-home.ts:25`) is true: "Use the memory, skills, setup and credential tools for the agent's own tables." Reads stay allowed. The agent's own toolkits use `AgentTableStore`, which is unaffected | `infrastructure/data/unrestricted-data-writer.ts`, `unrestricted-data-gateway.ts` (schema), injection e2e |
| D2 | **No secret preview to the model.** `credential_list` drops `preview`; the admin UI keeps it | `toolkits/credentials/credentials.toolkit.ts:29` |
| D3 | **SSRF address check.** Build the blocked ranges with `net.BlockList` (IPv4 and IPv6 subnets). Turn any IPv4-mapped form (`::ffff:7f00:1` as well as dotted) into IPv4 before checking. Add `64:ff9b::/96` (NAT64), `2002::/16` (6to4), `::/96` | `infrastructure/http/network-policy.ts:33`, `outbound-http.spec.ts` |
| D4 | **Admin membership kept current.** Nothing in the app changes `isAdmin` today, but users are deactivated or deleted. Reconcile the Agent space membership on `USER_DELETE`, on deactivation, and every 15 minutes (repeatable job on `agent-jobs`) | `application/installation/membership.ts`, a listener, `application/jobs/agent-jobs.ts` |

---

## 7. Part E: reliability fixes

| # | Problem (review id) | Fix | Files |
|---|---|---|---|
| E1 | Client disconnect leaves the turn hung: lock held about 5.5 min, run stuck `running` (High 2) | Replace `pipeUIMessageStreamToResponse` with a small pump: set `UI_MESSAGE_STREAM_HEADERS`, read `stream.pipeThrough(new JsonToSseTransformStream())` to the end, and write to `res` only while it is open. The stream is always fully read, so `onFinish` always runs. `close` still aborts the run | `interface/agent-chat.controller.ts:68`, new `interface/ui-stream-pump.ts` |
| E2 | A failed launch leaves the run `running` (Medium 6) | In `TurnGate.launch`'s catch: mark the run `failed` with the error, then release. Needs `RUN_STORE_PORT` in `TurnGate` | `application/chat/turn-gate.ts:125` |
| E3 | A tool call cut off by Stop poisons the thread (High 4) | When a turn ends aborted, `TurnRecorder` rewrites tool parts left in `input-streaming`/`input-available` as `output-error` "stopped before it finished". `message-mapper` does the same on read, for threads already affected | `runtime/turn-recorder.ts`, `runtime/message-mapper.ts` |
| E4 | Messages over 64 KB lose everything (High 3) | Shrink instead of drop: replace tool outputs largest first with `{ omitted: true, chars: N, note: "call the tool again for the full result" }` until the parts fit. Text, tool calls and approval requests are always kept | `infrastructure/store/agent-table-store.ts:38` |
| E5 | Summary skips messages (Medium 5) | Pick the batch by size: oldest first, until the transcript budget (30k chars) is full; `summaryThroughSeq` = the last message included. Drop the "10 new messages" wait. Queue the job with id `summary:<threadId>` so turns in quick succession run it once | `application/jobs/turn-jobs.ts:74,128-151` |
| E6 | Lock release does not check the owner (Low) | Store the run id as the lock value; release only when the value still matches | `turn-gate.ts:74-84`, `cache.service.ts` if it lacks a compare-and-delete |
| E7 | Cancel and resume race (Low) | Status changes become conditional (`updateMany where status in …`): resume only moves `awaiting_approval → running`, so a `cancelled` run stays cancelled | `infrastructure/runs/prisma-run-store.ts`, `resume-turn.usecase.ts:63`, `cancel-run.usecase.ts` |

---

## 8. Part F: frontend thread state

| # | Problem | Fix | Files |
|---|---|---|---|
| F1 | A → B → A shows A's old history and stale approval ids | Invalidate `agentQueryKeys.messages(threadId)` when a turn finishes; `staleTime` 0 for messages; mount the chat only once the refetch has finished (`isFetchedAfterMount`), since `useChat` reads its initial messages once | `useAgentData.ts:30`, `useAgentChat.ts`, `AgentPage.tsx`, `AgentPanel.tsx` |
| F2 | Archiving a just-started thread on the Agent page does not reset the chat | One `startNew()` helper that clears `opened` and bumps `chatKey`; used by `+`, archive and `/clear` | `AgentPage.tsx:93-103` |
| F3 | Close and reopen the panel shows the wrong thread | When the panel closes, set `opened` to the latest `threadId`, so reopening mounts the thread the chat last used | `AgentPanel.tsx:122-176` |

---

## 9. Part G: smaller fixes

- **`sql_read` wrapper** (`toolkits/sql-read/sql-read.toolkit.ts:25`): wrap with newlines,
  `select * from (\n${body}\n) as agent_query limit N`, so a trailing `-- comment` cannot swallow
  the limit. Refuse an unclosed `/*`. Set `statement_timeout` for the query.
- **Credential test** (`application/admin/manage-credentials.usecase.ts:74`,
  `infrastructure/http/outbound-http.ts:140`): the test may use a credential whose status is
  `invalid` (an `allowInvalid` option only the test passes), so a passing test sets it back to
  `set`. The admin can give a test path (default `/`) in the request and the UI.
- **Leftovers:** "no embedding model" comment in `toolkits/toolkit.types.ts:53`, "vector +
  full-text" in `domain/policies/memory-ranking.ts:5`, `rag_search` in
  `toolkits/builtin-toolkits.spec.ts:190-203` and `rag-search` in
  `apps/nextjs-app/.../agent/agent.spec.tsx:120`.

---

## 10. Phases

One commit per step, as before. Each phase ends with tsc, unit tests and the affected e2e suites.

| Phase | Steps | Why this order |
|---|---|---|
| P0 Skills | §3 (upgrade in place, inactive write, rename, reserved names, seed version 3); §9 leftovers | Small; removes the dead instructions the model sees today |
| P1 Security | D1, D2, D3, D4 | D1 is the one real exposure; the others are short |
| P2 Reliability | E1, E2, E3, E4, then E5, E6, E7 | E1–E4 can break a thread or lock it |
| P3 Search everywhere | settings and collection; `SearchTables`; record text; sync state and jobs; schema listeners; row lock; tool/result changes; `search_everywhere` trim; skill text; eval | Biggest change; it builds on the P0 skills and the P2 job fixes |
| P4 Slash commands and frontend | §5.1 `/clear`, §5.2 server-side skills, F1–F3 | Frontend work together; `/clear` reuses the F2 helper |
| P5 Small fixes | `sql_read`, credential test | Independent |

---

## 11. Testing

- **Unit:** `planSkillSeeds` (create / upgrade / offer / clean-up / rename); `SearchTables.resolve`
  for each rule in §4.4; record text (field types left out, caps, text format); `buildSearchQuery`
  unchanged; shrinking parts (approvals kept); summary batch selection; `isBlockedAddress` for the
  new IPv6 forms; `limitedSql` with comments.
- **e2e** (disposable `agent-e2e-pg` only; blank `BACKEND_CACHE_REDIS_URI` and
  `BACKEND_PERFORMANCE_CACHE` first):
  - seeder on a base holding the current v1/v2 rows ends with one active row per skill;
  - create a table, write a record, find it with `search`; rename a field and find the new name;
    exclude the table and see its documents go; delete the table and see them go;
  - data tools refuse writes to Agent-base tables; injection suite still passes;
  - disconnect mid-stream: run ends `cancelled`, lock released, next message accepted;
  - Stop during a tool call, then a second turn in the same thread succeeds.
- **Eval:** add golden queries for ordinary records (a task, an email, a contact, a CJK record) to
  `test/rag-eval`. Gate: knowledge queries keep recall@5 ≥ 0.969 and MRR@5 ≥ 0.914 with every
  table indexed; new queries reach recall@5 ≥ 0.9.
- **Manual on the k3s copy:** full sync time and index size for 48 tables, then `/clear`,
  `/knowledge-search …` and a search for a record outside the knowledge tables in the UI.

---

## 12. Decisions (2026-10-27)

The user accepted the defaults below; nothing is open.

1. **Default scope:** everything except `search_exclude` (`search_scope = all`), not opt-in.
2. **Exclusions on day one:** none; `search_exclude` starts empty.
3. **Attachment contents:** not indexed in this plan (file names only).
4. **Settings UI:** none for now; `search_scope` and `search_exclude` are set through
   `setup_update` (with approval) or by editing `agent_setup`.
