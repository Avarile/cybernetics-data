# Agent follow-up: implementation report

Branch `feat/agentic-database`, 2026-10-27. Implements the follow-up design in `current-design.md`
(P0–P5): search over every table, `/clear` and server-side `/skill-name`, and the fixes from the
review of 2026-10-27. 26 commits from `c71ad720` to `629680a1` plus this report, nothing pushed.
103 files changed, +3,842 / −1,566 lines (without `.claude-flow/`).

The report on the first implementation (the admin-only agent) is in git history:
`git show 629680a1:scripts/customized/developments/implementation-report.md`.

## 1. Status

| Phase | Content | Result |
|---|---|---|
| P0 Skills | built-in skills upgrade in place, stale copies removed, reserved names, leftovers | Done (3 commits) |
| P1 Security | Agent space off limits to data tools, secret previews, IPv6 guard, membership timer | Done (4) |
| P2 Reliability | disconnects, failed launches, cut-off tool calls, 64 KB parts, summary, lock, cancel race | Done (7) |
| P3 Search everywhere | settings, every table indexed and kept in sync, row lock, tools, eval | Done (5) |
| P4 Chat | `/clear`, fresh thread history, archive and panel fixes, `/skill-name` on the server | Done (2) |
| P5 Small fixes | `sql_read` row cap and timeout, credential retest | Done (2) |

Decisions taken (design §12): search covers every table minus `search_exclude`; nothing is
excluded on day one; attachment contents are not indexed; the two new settings have no admin
screen.

### What you may want to act on

1. **A database migration ships with this branch:** `20261027000000_add_agent_secret_preview`
   (postgres and sqlite) adds `agent_secret.preview`. Deploy runs it with the usual migrate step.
2. **The first agent check after deploy changes the Agent base:** pack version 3 adds
   `search_scope` and `search_exclude` to `agent_setup` and deletes the old
   `agent_credentials.preview` column; seed version 4 upgrades the built-in skills that nobody
   edited (in your k3s data: `knowledge-search` and `rag-search`→`document-search` from v1, and
   `data-navigation` to v2) and deletes the `-v2` copies the old seeding left active.
3. **The first full search sync runs about 30 s after boot.** Until it has finished, `search`
   warns that results may be incomplete. At today's volume (48 tables, about 3,000 records) it
   takes seconds. To exclude a table or base, add its id to `agent_setup.search_exclude`; the
   index follows within seconds.
4. **Your local `cybernetics_k3s` copy is already migrated.** The dev server from an earlier
   session ran on it in watch mode: the migration, pack version 3 and seed version 4 (all six
   skills current) are applied there. One leftover: its `agent_credentials.preview` field
   (`fldEVqc0Wb64LPLp78n`, empty) was not dropped, because the dev server ran a check between the
   commit's two edits and stored the field map without it. A deploy ships both at once, so this
   does not happen there; on the copy, delete the field by hand if you like. That dev server is
   stopped now.
5. **Project tracking:** this round was not tracked in CYBERDATA. The comments for CYBERDATA-87
   to 105 from the first round are still unposted (see the earlier report).
6. **Leftover Redis keys** (about 50 `bull:agent-jobs:*` in your platform Redis, from the first
   round) are still there; nothing in this round touched that Redis.

## 2. What was built

### P0: Skills (`c4af13d5`, `ad64a96e`, `866be88a`)

- A built-in skill whose body is one we shipped (sha256 of earlier bodies in `previous`) is
  upgraded in place and keeps its record id; `renamedFrom` renames it; `name-vN` copies earlier
  seeding added are deleted. An edited skill is never touched; a newer version is offered as an
  inactive `name-vN` row.
- `clear`, `new` and `help` cannot be skill names.
- Comments and test fixtures from the vector-search era are gone.

### P1: Security (`a24c4fd1`, `ab510f07`, `11c150dd`, `5195cb7e`)

- Record and schema writes refuse any base in the Agent space. Before, an update of up to 50
  records (no approval) could rewrite `agent_credentials.allowed_hosts` and then send the secret
  to another host.
- The secret preview moved from the `agent_credentials` table (readable by the agent) to
  `agent_secret`; `credential_list` no longer returns it. Fields a pack retires are deleted on the
  next check by the id stored for them (`RETIRED_AGENT_FIELDS`).
- IPv6 addresses are parsed into groups; mapped (including the `::ffff:7f00:1` form the URL parser
  produces), SIIT, compatible, NAT64 and 6to4 addresses are judged by the IPv4 address inside;
  Teredo, documentation, site-local and local-use NAT64 ranges are refused.
- The Agent space members are reconciled with the instance admins every 15 minutes (a timer with
  a tick lock, like the email sync scheduler), and changes are audited.

### P2: Reliability (`793bb945` … `42144a82`)

| Fix | What it was |
|---|---|
| E1 | A closed tab or Stop recorded the run as `done`; now `cancelled`. The chat route reads the stream to its end with its own pump; the SDK's pipe stopped after 4 of 200 chunks on a closed socket |
| E2 | A turn that could not start (no model) left its run `running` for good |
| E3 | A tool call cut off by a stop was saved without a result; providers refuse such history, so every later turn of the thread would fail. Now saved, and read back, as `output-error` |
| E4 | A message over 64 KB was replaced by one marker text; `fitParts` now drops tool outputs first and keeps text, calls and approvals |
| E5 | The rolling summary marked up to 200 messages as summarised but read only the newest 30,000 characters of them, and waited for 10 new ones |
| E6 | The thread lock was released without checking the owner; now a token and `CacheService.delIfEquals` |
| E7 | A cancel landing while an approval was answered was overwritten; run changes are now conditional (`IRunStorePort.transition`) |

### P3: Search over every table (`80faf8c8`, `3ccfdcd5`, `be6a8b45`, `552e8f4b`, `78ce0d15`)

See §3 for how it works. In short: every table outside the Agent space (minus `search_exclude`)
is indexed into a new `records` collection; knowledge tables stay in `kb_records`; the index
follows record changes, field changes, table deletes and settings changes; a full sync runs after
boot, daily and on demand. `search` results name their table and base. `search_everywhere` finds
names only now. The always-loaded `data-navigation` skill tells the agent to call `search` first.

### P4: Chat (`bbcbe975`, `5b64295e`)

- `/clear` (or `/new`) starts a new conversation on the page and in the panel, stopping a reply
  that is still streaming; the picker offers it above the skills.
- A thread's messages are fetched afresh whenever its chat opens (`AgentThreadChat`); before,
  going back to a thread showed its history as first loaded, with approval ids the server no
  longer knew.
- Archiving the open thread on the Agent page starts a new chat; the side panel reopens on the
  thread its chat last used.
- A message starting with `/name` of an active skill (any invocation, `manual` included) puts
  that skill's body into the turn's system prompt, instead of hoping the model calls `skill_load`.

### P5: Small fixes (`c1735f56`, `c59a45b9`)

- `sql_read` wraps the query on its own lines, so a trailing `-- comment` no longer removes the
  row limit; an unclosed `/*` is refused; queries stop after 15 s, also in the executor's
  read-only check, which runs the whole query first.
- A credential marked `invalid` can be tested again and set back to working; the test takes an
  optional path (API and a field next to Test in Admin ▸ Agent ▸ Credentials).

## 3. Search over every table, as built

```text
record / field / table events ─► KnowledgeSyncListener ─► rag jobs ─► KnowledgeSync ─► agent_rag
agent_setup change (2 s quiet) ─┘        (field changes: 2 s quiet)      │
KnowledgeSyncScheduler (boot +30 s if due, daily) ─► sync job ───────────┘
admin POST /api/agent/admin/knowledge/sync ─► KnowledgeSync.syncAll (409 while one runs)
```

- **Which table goes where** (`SearchTables`): the memory table → `agent_memory`; a knowledge
  table (configured in `knowledge_tables`, or a primary field plus a text field named `context`)
  → `kb_records`; with `search_scope` `all`, any other table → `records`. Tables in the Agent
  space or in `search_exclude` (table or base ids) are never indexed. Tables are known by id;
  names are looked up when results are returned.
- **What a record reads as** (`recordText`): its text cells, formatted as the UI shows them
  (`CellFormat.Text`), read in batches with one field query per batch. Title: the primary field.
  Knowledge tables: the `context` field. Other tables: every field with a value as
  `Field name: value`, bookkeeping fields (auto number, created/modified time and by, button)
  left out; values over 20,000 characters are cut. A set `deleted_at` removes the record.
- **Jobs:** `ingest-records` (a batch of up to 200 records from one event), `remove`,
  `sync-table`, `remove-table`, `sync`. Unchanged records cost a hash comparison; documents of
  vanished records, of tables no longer searched and of tables that moved collection are deleted.
  `agent_rag.sync_state` records each table's last sync and the full sync (row `*`).
- **Concurrency:** one full sync at a time (cache lock); one asked for meanwhile runs again after
  it. `replaceChunks` locks the document row, so two re-indexes of one record run one after the
  other (six at once used to leave five copies).
- **Settings:** `search_scope` (`all` or `knowledge`, empty means `all`) and `search_exclude`, in
  `agent_setup`, changeable with `setup_update` (needs `setup_change` approval) or by editing the
  table.

## 4. Search evaluation (`test/rag-eval`, `pnpm -F @teable/backend rag-eval`)

46 questions: the 32 from before (documents and knowledge records) and 14 on three ordinary
tables (tasks, contacts, emails; some rows share words with the documents on purpose; codes,
names and Chinese). Each is asked in its own collection and, as `search` does by default, across
all of them (mixed).

| Set | recall@5 | MRR@5 | p95 |
|---|---|---|---|
| Documents and knowledge records (gated at 0.969 / 0.914) | 0.969 | 0.914 | 3 ms |
| Ordinary records (gated at recall 0.9) | 1.0 | 0.964 | 3 ms |
| All 46, own collection | 0.978 | 0.929 | 4 ms |
| All 46, across all collections | 0.978 | 0.887 | 3 ms |

Indexing every table does not lower recall; across collections some documents move down a place
(MRR 0.929 → 0.887) but stay in the top five. The one miss is the old "I lost my laptop on the
train" paraphrase, which shares no word with its document.

## 5. Bugs found along the way

Beyond the review's list:

- **The old seeding left dead instructions active.** Seeding never upgraded a built-in, and its
  "inactive" `-v2` copies came out active because `is_active` defaults to true and a false
  checkbox is an empty cell. Your k3s data had `knowledge-search` and `rag-search` v1 (calling
  removed tools) active next to their v2 copies.
- **The preview leaked through the table too** (D2), not only through `credential_list`.
- **A stopped turn was recorded as `done`** (E1); the "hang" the review described was real in
  principle but rarely reached.
- **Concurrent re-indexes duplicated chunks**, reproduced with six at once.
- **A field rename was not seen by a sync within 30 s**: the reader cached field lists.
- **A record kept its first title** in the index after it was renamed.
- **Old Agent homes fed the agent its own transcripts**: on the e2e database, earlier test
  installs left Agent spaces whose `agent_messages` tables were indexed and outranked real
  results. Every base of the current Agent space is now excluded (§7 for the rest).
- **`sql_read` ran every query twice without a time limit**: the executor's read-only check
  executes the full query before the real run.

## 6. Deviations from the design

Recorded in `current-design.md` (as-built notes under §7, before §8 and before §10). The main
ones: E1 and E3 were fixed differently than planned (signal → `cancelled`; error results instead
of `ignoreIncompleteToolCalls`), D2 needed a migration, D4 has no event listener (`user.delete`
is never emitted and deactivated users cannot sign in), job de-duplication uses in-process
debouncing and a re-run flag instead of BullMQ job ids, and the whole Agent space is excluded
from search.

## 7. Known limitations and next steps

- **Agent homes in other spaces** (left if someone deletes the `agent_installation` row by hand)
  are indexed like any table: the schema pack leaves no marker to tell them apart. Your k3s data
  has one Agent space, so this does not apply there today.
- **Lookups and formulas** that change through edits in another table are caught by the daily
  sync; whether Teable also emits record events for them was not checked.
- **The full sync is one record at a time** within each batch. Fine at today's 3,000 records;
  at hundreds of thousands it would take minutes and could batch its writes.
- **Mixed ranking:** a per-collection weight in `buildSearchQuery` could lift documents back up
  if the agent's answers show it is needed.
- **Attachments** are indexed by file name only.
- **Tests:** two agent e2e suites in one vitest process sometimes end in a Prisma engine panic
  after all tests passed (exit 134). Run alone they pass; not traced further.
- **Settings UI:** `search_scope` and `search_exclude` are edited in `agent_setup` or by the agent.

## 8. Verification summary

All on the disposable `agent-e2e-pg` database, with `BACKEND_CACHE_REDIS_URI` and
`BACKEND_PERFORMANCE_CACHE` blanked; the k3s database and the platform Redis were not used.

| Check | Result |
|---|---|
| Typecheck: backend, frontend, openapi | clean |
| Backend unit tests (`src/features/agent`, `src/cache`) | 156 passed |
| Frontend unit tests (agent and admin blocks) | 33 passed |
| Agent e2e, all 16 suites | 111 passed |
| Search eval | §4, gates met |
| New tests that fail without their fix (checked) | Agent space write block (D1), stop during a tool call (E3), concurrent re-index (row lock), sql_read slow query |
| Redis compare-and-delete (E6) | checked against a throwaway `redis:7.4-alpine` container, then removed |
| Real data | the new seed plan dry-run against the k3s copy's skill rows, then applied there by the dev server: 4 search skills → 2, original records kept |
