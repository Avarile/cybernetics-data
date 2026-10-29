# Agent cockpit: a full-screen agent that plans its searches and shows them

Status: **designed 2026-10-30, not started.** Decisions waiting for the admin are in §14. Branch:
`feat/voice-conversation`.
The previous content of this file (voice conversation, as built) is in git history:
`git show 18999448:scripts/customized/developments/current-design.md`.

Every "today" statement was read from the working tree on 2026-10-30 (HEAD `18999448`). Paths are
relative to `apps/nextjs-app/src/features/app/blocks/agent/` (frontend) or
`apps/nestjs-backend/src/features/agent/` (backend) unless they start with `apps/` or `packages/`.
The reference design is `/home/avarile/Documents/agentic-centre/ai-cockpit/` ("the cockpit").

---

## 1. Summary

The agent stops being a chat panel. It becomes the **Agent Cockpit**: one full-screen surface,
switched on and off, in the cockpit's glass-instrument look. When the admin asks something, the
agent first works out what they mean (and asks if it can't tell), then makes a search plan over the
tables, runs it step by step, and the screen shows each table as it is searched, with every record
it finds landing as a card in that table's lane.

| Part | What changes | § |
|---|---|---|
| A. Full screen | One overlay over the whole app, on/off only; no side panel, no resize, no expand | 4 |
| B. Cockpit screen | Annunciator strip, a stage (search board, constellation), the ask rail; MONO and CYBERPUNK palettes | 5 |
| C. Answer protocol | Intent → clarify or plan → run the plan table by table → answer, enforced on the server | 6 |
| D. Stream and storage | New data parts for plan, steps, hits, clarify and lens; search runs kept in Prisma for replay | 7 |
| E. Voice | Kept as built; new spoken pointers for the board and for questions back to the admin | 8 |
| F. Modules and layers | Backend: a `search` domain slice inside the existing layers. Frontend: everything in one folder, split into six layers with enforced import rules | 9, 10 |

API changes are in §11, files and phases in §12, tests in §13, decisions in §14, risks in §15.

---

## 2. Current state

### 2.1 Frontend

- Two shells host the same chat (`AgentChatView.tsx`):
  - `AgentPanel.tsx` (217 lines): a resizable side panel, mounted only in
    `apps/nextjs-app/src/features/app/blocks/table/Table.tsx:134` for admins. It has three sizes
    (`open`, `expanded`, `close`) from `useChatPanelStore`, which lives **outside** the agent folder
    (`apps/nextjs-app/src/features/app/components/sidebar/useChatPanelStore.ts`, persisted in
    `LocalStorageKeys.ChatPanel`). It remembers one thread per base in localStorage.
  - `AgentPage.tsx` (181 lines): `/agent` (`apps/nextjs-app/src/pages/agent.tsx`, `AgentLayout`),
    a thread list plus a full-width chat.
- Openers: the table header button (`table-header/TableHeader.tsx:192,227`, `toggleVisible`) and
  the grid's "add to chat" record menu (`view/grid/GridViewBaseInner.tsx:642,687`, which puts the
  selection in `ReactQueryKeys.gridSelection(baseId)` and calls `open()`). No other code uses
  `useChatPanelStore`.
- Chat state: `useAgentChat.ts` wraps the AI SDK `AbstractChat` (`ai` 6.0.169) in a
  `StoreChatState` that React subscribes to. The instance lives inside the component, so closing
  the panel or navigating away unmounts it, and the cleanup calls `chat.stop()`: the reply stops.
- Rendering uses the shared `@/components/ai-elements/*` (Conversation, Message, Tool, Reasoning)
  and `components/AgentToolStep.tsx`, `ApprovalCard.tsx`, `ContextChip.tsx`, `AgentComposer.tsx`
  (skill picker on `/`, `/clear`).
- Voice (`voice/`, about 1,500 lines plus specs): `VoiceListener`, `SpeechQueue`, two engines,
  `buildSpeechScript` with pointers (table, code, form, error), `useVoiceConversation`,
  `VoiceSwitch`, `VoiceComposer`, `VoiceSettings`, and `voice-store.ts` (zustand, persisted engine
  and browser voice).
- The app has no `d3` (only `d3-force-3d`); `motion` 12 and `zustand` 4.5 are installed. No
  `next/font` is used anywhere.

### 2.2 Backend

- The agent module is already layered: `domain/` (entities, policies, ports), `application/`
  (use cases), `infrastructure/` (Prisma, Teable tables, BullMQ, HTTP), `interface/`
  (controllers), `runtime/` (one turn), `toolkits/` (tools by toolkit) and `pack/` (seeded tables,
  skills, defaults). About 10,000 lines.
- A turn (`runtime/agent-runtime.ts`): `ContextBuilder` builds the system prompt, `ToolAssembler`
  wraps the profile's toolkits (`wrapTool`: run as the agent principal, cap, mark untrusted, audit),
  and a `ToolLoopAgent` streams through `createUIMessageStream`. The first chunk is a transient
  `data-run` part. Steps are saved as they finish (`TurnRecorder`); `agent_messages.parts` is capped
  at 64 KB per message (`infrastructure/store/fit-parts.ts`).
- Reading data: `data_read` (`list_*`, `describe_table`, `query_records` by field name with Teable
  filters, `get_records`, `aggregate`, `search_everywhere`), `sql_read`, and `knowledge.search`
  (PostgreSQL full text over every table, kept in sync; no vectors, by the admin's decision of
  2026-10-27).
- Nothing plans a search or tells the UI which table is being searched: the model calls tools in
  whatever order it likes, and the UI shows each call as a collapsible JSON step.
- `ai` 6.0.169 supports `prepareStep` (per-step `activeTools`, `toolChoice`), `hasToolCall` stop
  conditions, and data parts with ids (a later chunk with the same id replaces the part).
- Runs and audit rows are in Prisma (`AgentRun`, `AgentAuditLog`); threads, messages, memories and
  skills are rows in the Agent base.

### 2.3 The data in the example

Read live from `data-centre` (`bseJEuE54y5caWO0Xc8`) on 2026-10-30. Every table has `title`
(primary), `context` (markdown), `created_at`, `updated_at`, `deleted_at`, `is_active`, `id`
(auto number).

| Table | Own fields | Links |
|---|---|---|
| `goals` | `deadline` | `projects` (one→many), `refer_knowledge` (many→many, one-way) |
| `projects` | `progress` (backlog … finalized, onhold, cancelled) | `belong_goals` → goals, `lead_by` → contacts, `tasks` (one→many), `refer_knowledge` (one-way) |
| `tasks` | `progress`, `priority` (urgent … can wait), `started_at`, `finished_at` | `belong_project` → projects, `assigned_to` → contacts, `refer_knowledge` (one-way) |
| `contacts` | `email`, `firstname`, `lastname`, `mobile` | `contact_type`, `contact_profession`, `contact_company`, `tasks`, `projects` (back-links of `assigned_to`, `lead_by`) |
| `knowledges` | — | `knowledge_type`, `knowledge_parent` / `knowledges` (tree), `related_knowledge` (many→many) |

So "people of a project" means `projects.lead_by` plus `tasks.assigned_to` of its tasks, and
"knowledge of a project" means `refer_knowledge` on the project and on its tasks. `refer_knowledge`
is one-way: a knowledge record doesn't know who refers to it.

### 2.4 The reference: what we take from the cockpit

The cockpit is a static page (TypeScript, D3 7.9 from a CDN) that draws Cybernetics data as a
radial constellation, with an "ask" panel that sends questions to Claude with read-only tools; the
chart follows what the tools retrieve.

| Cockpit | Agent cockpit |
|---|---|
| Deck: annunciator strip on top, stage in the middle, instrument rail on the right | Same grid (§5.1) |
| Dataset menu (WORK, GOALS, KNOWLEDGE, FINANCE, CUSTOM) | Thread menu; the "dataset" of a turn is its search plan |
| Link chip and diagnostics panel, zulu clock | Agent status chip (model, health, last error) and its panel; same clock |
| MONO and CYBERPUNK palettes over shared tokens; Tektur, Martian Mono, IBM Plex Sans | Same tokens, palettes and fonts, scoped to the overlay |
| Ask panel: input, trace, answer, lens ANSWER / RETRIEVED / FULL MAP, NEW, suggestion chips | Ask rail: transcript, plan legs (the trace), answer, lens ANSWER / RETRIEVED / ALL, NEW, chips |
| Constellation: `d3.cluster` / `d3.tree`, bundled edges, rotation, lens, render budget of 900 | Constellation view of the retrieved records (§5.4), ported, not reinvented |
| Readout with up to seven KPIs | Readout per intent, e.g. tasks by progress, people, knowledge (§5.6) |
| Branch vectors (mix bars per branch), flight log | Mix bar in each lane header; run log |
| Symbology: dot, hub, diamond actor, ring, halo; colour by meaning, not by hue | Same marks on cards and nodes |
| Keyboard: `1`–`4`, `[` `]`, `Esc`, `T`, `0`, `F` | Adapted (§5.8) |
| Not taken: demo signal, the spec article under the deck, QUICK/THOROUGH tier, Claude sampling on the viewer's account | — |

---

## 3. Goals and non-goals

Goals:

1. The agent is one full-screen component with exactly two states, on and off (Feature 1).
2. The screen follows the cockpit's layout, look and interaction model (Feature 2).
3. Voice keeps working exactly as built (Feature 2.1).
4. Data questions follow intent → clarify or plan → table-by-table search → answer (Feature 2.2).
5. While a table is searched its lane is visible, and every hit arrives as its own card (Feature 2.3).
6. Clear modules and layers on both sides, with the import rules checked by tests (Feature 3).
7. All frontend agent code, state included, lives in one folder (Feature 3).

Non-goals: non-admin access (still admin-only); new write powers (writes keep their approvals);
vector search; changing the admin settings page (`blocks/admin/agent/`); a light palette.

---

## 4. Part A: full screen, on and off

### 4.1 Behaviour

- The cockpit is a fixed overlay over the whole viewport (`position: fixed; inset: 0`, above the
  app's own layers), rendered in a portal. It has two states, **on** and **off**. There are no
  other sizes, no resize handle, no expand or minimise button.
- **On**: from the toggle button (§4.2), the shortcut `Mod+J`, a deep link (§4.4) or "add to
  chat" on grid rows.
- **Off**: the same toggle (the power button in the annunciator, or `Mod+J`). `Esc` never turns
  it off; it closes menus and clears the lens first (§5.8), so a stray `Esc` doesn't hide a
  conversation.
- While on, the page underneath is inert (`inert` on the app root): no grid shortcuts, no focus
  behind the overlay. The overlay is a modal dialog to assistive tech (`role="dialog"`,
  `aria-modal`, labelled "Agent cockpit"), focus moves to the composer on open and back to the
  toggle on close.

### 4.2 Entry points

- `AgentToggle` (exported from the agent folder): an icon button with the on/off state, placed in
  the table header where the chat button is today, and in the space and admin sidebars, for admins
  only.
- Grid "add to chat" calls `openAgentCockpit({ focus: { baseId, tableId, viewId, recordIds } })`
  instead of writing `gridSelection` and opening the panel.
- `useChatPanelStore`, `LocalStorageKeys.ChatPanel` and the panel are deleted (§12, P3).

### 4.3 The session survives off, and navigation

Today a closed panel stops the reply. Here, **off only hides**:

- The live chat (the `AbstractChat` instance), the board and the thread id live in a module-level
  session store (`state/session-store.ts`, §10.2), not in a component. Turning off, switching
  pages or moving between layouts keeps the reply streaming and the search running.
- Off pauses what can't run unseen: the microphone pauses and speech stops (the voice hook already
  pauses when `hidden`; "cockpit off" becomes one more source of `hidden`), the constellation stops
  rotating, and stagger animations finish instantly.
- The annunciator toggle shows a busy dot while a hidden reply is still running.
- Stop ends the reply, not the session. The session ends on NEW, `/clear`, switching thread,
  sign-out or closing the tab.

### 4.4 Routes

- `AgentCockpitHost` is mounted once in each layout that has a session (`BaseLayout`,
  `SpaceLayout`, `SettingLayout`, `AdminLayout`) and renders the overlay for admins when it is on.
- `/agent` and `/agent?thread=<id>` stay as deep links: the page's `getServerSideProps` keeps the
  admin check and redirects to `/space?agent=on&thread=<id>`; the host reads that query, turns the
  cockpit on with the thread and removes the query. `AgentLayout` and `AgentPage.tsx` go away; the
  page file stays in `pages/` because Next.js routing needs it there.

### 4.5 Focus hint

The cockpit opened from a table sends `context.baseId/tableId/viewId` as today, plus `recordIds`
for "add to chat". The annunciator shows it as a chip (`FOCUS · TASKS · 3 ROWS ✕`), replacing
`ContextChip`; dismissing it sends no context. It stays a hint, never a limit.

---

## 5. Part B: the cockpit screen

### 5.1 Layout

```text
┌ ANNUNCIATOR ─────────────────────────────────────────────────────────────────────────────┐
│ ◇ AGENT  THREAD ▾ Cockpit progress   FOCUS · TASKS · 3 ✕   ● LIVE · MODEL   MONO│CYBERPUNK  30 OCT 2026 · 04:12:09Z  ⏻ │
├──────────────────────────────────────────────────────────────────────┬──────────────────┤
│ STAGE                                          [ BOARD │ CONSTELLATION ] │ ASK THE AGENT    │
│ PROJECT PROGRESS · "Cybernetics Cockpit"                               │ ▸ How is the…    │
│ 1 PROJECT · 14 TASKS · 3 PEOPLE · 5 KNOWLEDGE  (readout + KPIs)        │ PLAN             │
│ ┌ 01 PROJECTS ─┐ ┌ 02 TASKS ────┐ ┌ 03 CONTACTS ─┐ ┌ 04 KNOWLEDGES ┐   │ 01 projects ✓ 1  │
│ │ ▣ card       │ │ ▣ card       │ │ ◆ card       │ │ ░ SEARCHING…  │   │ 02 tasks    ✓ 14 │
│ │              │ │ ▣ card       │ │ ◆ card       │ │               │   │ 03 contacts ▶ 2  │
│ │              │ │ ▣ card …     │ │              │ │               │   │ 04 knowledges ·  │
│ └──────────────┘ └──────────────┘ └──────────────┘ └───────────────┘   │ answer · lens    │
│ legend                                                     run log ▾   │ composer · voice │
└──────────────────────────────────────────────────────────────────────┴──────────────────┘
```

- Grid like the cockpit's `.deck`: annunciator row, then stage and a right rail of about
  360–420 px. On screens under 900 px the rail becomes a bottom sheet over the stage (§5.9).
- The stage shows the **selected search**: the latest turn's by default, or the one whose plan the
  admin clicks in the transcript.

### 5.2 Annunciator strip

From left to right: product mark; **thread menu** (the cockpit's dataset dropdown pattern: a
listbox with the current thread, search, NEW, archived toggle, archive/restore per row, usage per
thread as `formatUsage` today); focus chip; **status chip** (`● LIVE · <model>`, `NEEDS SETUP`,
`ERROR`; click opens a diagnostics panel with installation health, toolkits, last error and a
link to Admin ▸ Agent, the way the cockpit's link chip opens its diag panel); palette switch;
zulu clock; power toggle.

When the agent isn't enabled or not healthy, the stage shows the reason and the Admin ▸ Agent
link (today's `NotReady`), and the composer is disabled.

### 5.3 Stage: the search board (Feature 2.3)

The board is the main view and the one that satisfies "show the table being searched".

- **One lane per table** of the plan, in plan order, laid out left to right (horizontal scroll if
  they don't fit; two steps on the same table share one lane with both step chips).
- A lane **appears when its step starts**, not before. Pending steps are listed in the plan legs
  only. The running lane has the active frame (route colour, a blinking `SEARCHING…` line, as the
  cockpit's busy note); finished lanes keep their cards.
- **Lane header**: step number and table name (`02 TASKS`), what the step does
  (`linked from PROJECTS · tasks`), the count (`14` or `50 of 132`), a mix bar of the cards' tones
  (the cockpit's branch vector), and "open table" (turns the cockpit off and opens the grid).
- **Cards**: every hit is its own card, appended under the previous one as it arrives, so the lane
  grows card by card (the stack in §14 D9). The server sends each hit as its own chunk (§7.1); the
  client staggers the entrance (60 ms apart, at most 1.5 s per lane, then the rest at once; none
  under reduced motion).
- **Card content** (§6.7): key line (`TASK · #42` and a state badge in its tone), title, up to four
  fields (priority, person, dates), a snippet of `context`, and provenance (`via PROJECT Cybernetics
  Cockpit · tasks`). Archived records, when included, are faint and labelled.
- **Hover** a card: the card it came from and the cards that came from it light up in the other
  lanes (the cockpit's hover trace); others dim. **Click**: pins that trace. **Open**: the record in
  its table.
- **Lens** (the cockpit's ANSWER / RETRIEVED / FULL MAP): `ANSWER` keeps the records the answer
  cites bright and dims the rest; `RETRIEVED` shows everything found; `ALL` drops the lens. During
  the search the lens is `SEARCHING` (everything so far).
- A step that needs a choice (§6.4) shows its candidates in the anchor lane with a `PICK` button on
  each card; the same choice appears as the clarify card in the rail.
- An empty step shows `NO RECORDS` in its lane; a failed one shows the error code, like the
  cockpit's link panel.

### 5.4 Stage: the constellation

A second view of the same retrieved records, switched with `BOARD │ CONSTELLATION` or `V`. It is
the cockpit's chart, ported:

- Graph contract from the cockpit's `types.ts` / `graph.ts` (`GNode`, `GLink`, `finishGraph`,
  `toneOf`, `sizeOfPriority`), the render budget (`limit.ts`, 900 nodes plus links, "+N more"),
  the rotator (`rotate.ts`, one turn per four minutes, held while hovering) and the layout of
  `tree.ts` (cluster for BUNDLE, tree for TREE, bundled edges with `curveBundle.beta(0.85)`).
- The board becomes a graph by the plan's structure (`model/graph/from-board.ts`): context steps
  (goals) are branches, the anchor's records hang under them (or are branches themselves), linked
  steps hang under the record they were followed from, actor tables (contacts) sit on a `PEOPLE`
  branch as diamonds with links (assigned, leads), knowledge sits on a `KNOWLEDGE` branch with refer
  links as edges.
- Rendering is React SVG; d3 only computes (`d3-hierarchy`, `d3-shape`) and zooms (`d3-zoom`,
  `d3-selection`). The view is loaded with `next/dynamic`, so the board doesn't pay for d3.
- The lens, hover tooltip, `T` (bundle/tree), `0` (reset zoom) and `[` `]` work as in the cockpit.

### 5.5 The ask rail

The cockpit's ask panel grown into a conversation:

- **Transcript** of the thread. Each turn: the question; its **plan legs** (the cockpit's trace,
  an FMS legs page: one row per step with table, how it was reached, count and state; collapsed
  once the answer arrives; clicking it puts that search on the stage); the answer as markdown
  (the shared Streamdown renderer); tool steps that aren't part of a plan as one-line rows
  (`READ tasks · 12`) that expand to their JSON; **clarify cards** (§6.4) and **approval cards**
  (as today, restyled).
- Under the latest answer: lens buttons `ANSWER n`, `RETRIEVED n`, `ALL`, and `NEW`.
- **Composer**: input, send/stop, the `/` skill picker and `/clear` (moved from `AgentComposer`),
  and the voice controls exactly as today: `VoiceSwitch`, `VoiceComposer` in place of the input
  while voice is on, `VoiceSettings`.
- **Suggestion chips** before the first question, per intent (§6.2), with names from recently
  updated projects and goals when the status call has them.

### 5.6 Readout, legend and run log

- **Readout** (top-left of the stage, as the cockpit's): the intent and anchor
  (`PROJECT PROGRESS · "Cybernetics Cockpit"`), then up to seven numbers computed on the client
  from the cards (`model/metrics.ts`). Project progress: tasks finished, in progress, backlog, on
  hold, people, knowledge, `% done`. Other intents: count per table. Under a lens it counts the
  lens.
- **Legend** at the bottom-left: the marks used on this board.
- **Run log** (the cockpit's flight log), collapsible at the bottom-right: every tool call of the
  current run with UTC time, verb (`PLAN`, `SEARCH`, `FOLLOW`, `READ`, `WRITE`, `ASK`) and a
  summary; rows from a hidden run light up when the cockpit is turned back on.

### 5.7 Look and motion

- **Palettes**: the cockpit's tokens (`--void`, `--glass`, `--bezel`, `--ink`, `--route`,
  `--target`, `--caution`, …) in `ui/theme/cockpit.module.css`, scoped to the overlay root, never
  to `:root`, so the app's theme is untouched. MONO is the default; CYBERPUNK refills the same
  tokens. Dark only, as the cockpit ("instrument lighting"). The choice is kept per browser.
- **Meaning by tone**: settled (done, finalized), active (in progress), next (todo, preparing),
  backlog, caution (on hold, overdue, past deadline: halo ring), faint (cancelled, archived). The
  mapping is the cockpit's `toneOf` (by words in the select value), so any status-like select
  works without configuration.
- **Fonts**: Tektur (display numbers), Martian Mono (data, labels), IBM Plex Sans (answer text),
  through `next/font/google` so they are self-hosted at build time.
- **Motion**: only for real changes. Cards enter with a short rise (stagger above); a lane's count
  ticks; the running lane's frame pulses. The constellation follows the cockpit's motion rules
  (glide only under 400 elements, flowing dashes, rotation). `prefers-reduced-motion`: no
  stagger, no pulse, no rotation, positions jump.

### 5.8 Keyboard

| Key | Action |
|---|---|
| `Mod+J` | Cockpit on / off (works everywhere in the app) |
| `/` | Focus the composer (when not typing) |
| `Esc` | Close a menu or panel; else clear a pinned trace; else set the lens to ALL. Never turns off |
| `V` | Board ↔ constellation |
| `[` `]` | Previous / next lane (board) or actor (constellation) |
| `T`, `0` | Bundle ↔ tree, reset zoom (constellation) |
| `F` | Browser full screen for the overlay (Fullscreen API), as the cockpit's `F` |
| `Mod+Shift+O` | NEW conversation |

Keys don't fire while typing in an input, as in the cockpit's `keydown` guard.

### 5.9 Narrow screens and touch

Under 900 px: annunciator collapses to mark, thread menu, status dot, power; lanes become tabs
(one lane visible, swipe between); the ask rail is a bottom sheet with the composer always
visible; the constellation is hidden behind the view switch. 16 px side gutters, no horizontal
page scroll (lanes scroll inside the stage).

---

## 6. Part C: how the agent answers (Feature 2.2)

### 6.1 The protocol

```text
admin message
   │
   ▼
[intent]  the model decides what is asked ──── unclear ───► clarify (card with options) ─► turn ends
   │ data needed                                                ▲
   ▼                                                            │ anchor ambiguous / empty
[plan_search] server builds the plan (recipe or custom steps), emits it, runs it step by step:
   step 1 anchor search ─► step 2 follow links ─► step 3 … ─► results to the model
   │
   ▼
[answer]  text answer citing records; highlight_records sets the ANSWER lens;
          follow-up reads, writes (with approval) or another plan_search allowed
```

- No data needed ("hi", "how do skills work"): the model answers directly; no plan, no board.
- The protocol is enforced on the server, not only asked for in the prompt (§6.8).

### 6.2 Intents and recipes

Recipes name tables and fields **by name** and are resolved against the live schema when used, as
the cockpit's presets are, so they hold no ids and survive renames of other fields. A table or
field a recipe expects but can't find is skipped and listed in the plan's `missing`.

| Intent | Example question | Steps (anchor first) |
|---|---|---|
| `project_progress` | "How is the cockpit project going?" | 1 `projects` search → 2 `tasks` via `projects.tasks` → 3 `contacts` via `tasks.assigned_to` + `projects.lead_by` → 4 `knowledges` via `projects.refer_knowledge` + `tasks.refer_knowledge` → 5 `goals` via `projects.belong_goals` (context) |
| `goal_progress` | "Am I on track for the Q4 goal?" | 1 `goals` → 2 `projects` via `goals.projects` → 3 `tasks` via `projects.tasks` → 4 `contacts` → 5 `knowledges` via all three `refer_knowledge` |
| `task_lookup` | "Where is the TTS task at?" | 1 `tasks` → 2 `projects` via `belong_project` → 3 `contacts` via `assigned_to` → 4 `knowledges` via `refer_knowledge` |
| `person_work` | "What is Alice working on?" | 1 `contacts` → 2 `tasks` via `contacts.tasks` (open ones first) → 3 `projects` via `contacts.projects` + `tasks.belong_project` |
| `knowledge_lookup` | "What do I know about Docker?" | 1 `knowledges` search → 2 `knowledges` via `related_knowledge`, `knowledge_parent` → 3 `projects`, `tasks` that refer to them (reverse `refer_knowledge`) |
| `finance_query` | "How much did I spend on food?" | 1 `finance_Transactions` filter (date window, category) → 2 `finance_Categories` → 3 `finance_Payees`; an `aggregate` in the result |
| `record_lookup` | any other table | 1 full-text anchor over all searchable tables → 2 one hop over the anchor's links |
| `custom` | anything else | steps given by the model, validated against the relation graph (§6.5) |
| `action` | "Mark the TTS task done" | the anchor step to find the target, then the write tool (with its approval) |

The recipes live in `domain/search/recipes.ts`. Adding an intent is adding one entry.

### 6.3 The example in full: "How is the Cybernetics Cockpit project going?"

1. **Intent**: `project_progress`, anchor text "Cybernetics Cockpit". The model calls
   `plan_search({ intent: 'project_progress', anchor: { text: 'Cybernetics Cockpit' } })`.
2. **Plan** (emitted first, shown as legs, no lane yet):
   `s1 projects · search "Cybernetics Cockpit"`, `s2 tasks · via projects.tasks`,
   `s3 contacts · via tasks.assigned_to, projects.lead_by`,
   `s4 knowledges · via projects.refer_knowledge, tasks.refer_knowledge`,
   `s5 goals · via projects.belong_goals (context)`.
3. **s1 runs**: the `PROJECTS` lane appears and blinks. Title match plus full-text find one
   project; its card lands. One clear hit, so the anchor is chosen (§6.6).
4. **s2 runs**: `TASKS` lane appears. The ids in the project's `tasks` link cell are fetched
   (100 per call); each task lands as a card, with progress tone and priority.
5. **s3 runs**: `CONTACTS`. Ids from every task's `assigned_to` and the project's `lead_by`,
   deduplicated; each person is a card with "assigned 6 tasks · leads the project".
6. **s4 runs**: `KNOWLEDGES`, from `refer_knowledge` of the project and its tasks.
7. **s5 runs**: `GOALS`, the project's goal with its deadline (halo if passed).
8. The model gets a compact result (§6.6), writes the answer (progress, what's in flight, what's
   on hold, who does what, relevant notes), and calls `highlight_records` with the records it cites.
   The lens switches to `ANSWER`.

### 6.4 Asking the admin (clarify)

The model calls `clarify` when:

- the intent is unclear ("show me the cockpit" — the project, the goal, or the knowledge entry?);
- a required anchor is missing ("how is the project going?" with no project in focus or history);
- the anchor step is ambiguous or empty (§6.6). The run stops after the anchor and the next model
  step is **forced** to `clarify` (`toolChoice`), with the candidates as options.

`clarify({ question, reason: 'intent' | 'anchor' | 'missing', options: [{ label, detail?,
recordRef? }] })` emits a `data-clarify` part and ends the turn (`stopWhen: hasToolCall('clarify')`).
The rail shows a clarify card: the question, up to six option buttons (record options show the
record's card line), and "or type your answer". Clicking sends a normal message whose text is the
label and whose `choice` field (§11) names the option. The server passes the choice to the model as
`[chose projects rec… "Cybernetics Cockpit"]`, and the next plan pins that record as the anchor
(`source: { kind: 'records' }`), so the search isn't repeated by text.

### 6.5 The plan model

Shared types (zod in `packages/openapi/src/agent/search.ts`, §9.4):

```ts
type ISearchIntent = 'project_progress' | 'goal_progress' | 'task_lookup' | 'person_work'
  | 'knowledge_lookup' | 'finance_query' | 'record_lookup' | 'custom' | 'action';

interface ISearchPlan {
  id: string;                       // the AgentSearch id
  intent: ISearchIntent;
  summary: string;                  // "Progress of project Cybernetics Cockpit"
  baseId: string;
  steps: ISearchStep[];
  missing: string[];                // recipe tables/fields not found
}
interface ISearchStep {
  id: string;                       // s1, s2, …
  table: { id: string; name: string };
  role: 'anchor' | 'related' | 'actor' | 'context';
  purpose: string;                  // "tasks of the project"
  source: IStepSource;
  limit: number;                    // cards to show (default 50, anchor 10)
}
type IStepSource =
  | { kind: 'search'; text: string; filter?: unknown }               // anchor: title + full text
  | { kind: 'records'; recordIds: string[] }                         // anchor pinned by a choice
  | { kind: 'filter'; filter: unknown; orderBy?: IOrder[] }          // e.g. transactions this month
  | { kind: 'follow'; from: { stepId: string; field: string }[] }    // link cells of earlier steps
  | { kind: 'reverse'; from: { stepId: string; field: string }[] };  // this table's link field points at earlier records
interface IStepState {
  stepId: string;
  status: 'pending' | 'running' | 'done' | 'empty' | 'needs_choice' | 'skipped' | 'failed' | 'cancelled';
  found: number;                    // records the step reached
  shown: number;                    // cards sent (≤ limit)
  error?: string;
}
```

Validation (`domain/search/planner.ts`, pure): every `follow` field must be a link field on the
source step's table that points at this step's table; every `reverse` field a link on this table
pointing at the source's table; steps only reference earlier steps; at most 8 steps; tables in the
Agent space, system tables (`system_info`, `system_status`, `auditlog`, `table_references`,
`template_table`) and `search_exclude` are refused. A custom plan that fails validation comes back
to the model as a tool error naming the bad field, with the table's links listed.

### 6.6 Running a plan

`RunSearch` (`application/search/run-search.usecase.ts`) runs the steps in order. Each step: emit
`running`, read, emit every hit as its own chunk, emit the final state, save the step to the log.

- **Anchor `search`**: (1) a primary-field `contains` query on the table (precise, cheap) and (2)
  the full-text index (`KnowledgeSearch`, `tableIds: [table]`, records and kb_records), merged,
  deduplicated and ranked (exact title first, then full-text rank, then recency); top 10.
- **Anchor choice** (`domain/search/anchor-choice.ts`, pure): one case-insensitive exact title →
  chosen; else one hit, or a top rank at least twice the second → chosen; else, for single-entity
  intents (`*_progress`, `task_lookup`, `person_work`), `needs_choice` with up to six candidates
  and the run stops; list intents (`knowledge_lookup`, `finance_query`, `record_lookup`) keep all.
  No hits → `empty`, the run stops, and the model may retry once with other words or clarify.
- **`follow`**: the ids in the source records' link cells (`get_records` returns them by field
  name), deduplicated in source order, fetched 100 at a time. `found` is the full count; only
  `limit` cards are sent. Each card carries `via` (source step, record and field).
- **`reverse`**: a query on this table filtered by the link field against the source ids
  (`hasAnyOf`/`isAnyOf`; which operator Teable accepts for each link relationship is checked in P1).
- **Archived** records (`is_active` false or `deleted_at` set) are left out unless the question
  asks for them; then they are faint cards.
- **Budgets**: 15 s per step, 60 s per run, abort on Stop; at most 3 `plan_search` calls per turn;
  at most 500 cards per run.
- **What the model gets back** (capped by the existing `maxResultChars`, marked untrusted): per
  step `{ table, status, found, records: [{ id, title, fields }] }` with up to six short fields per
  record (values cut to 200 characters) and no `context` bodies. For detail it calls `get_records`
  in the answer phase.

### 6.7 Cards

`domain/search/card-projection.ts` (pure) turns a record (fields by name) and its table schema
into a card, the way the cockpit's "automatic encoding" does:

- **title**: the primary field; **key**: the table's short name and the auto number (`TASK · #42`).
- **tone**: the first single select named like status, progress, state or stage, through `toneOf`;
  **size**: a priority select or an amount field.
- **fields** (up to four): priority, the link to a person, the first date (deadline, due,
  started_at, finished_at), an amount; link values as titles.
- **snippet**: the first 200 characters of `context` (or the first long text), markdown stripped.
- **alert**: deadline or due date passed and not done.
- **never shown**: fields whose names match credential, password, secret, token, api key, private
  key (the cockpit's `SECRET` rule) and attachments.

```ts
interface ISearchCard {
  key: string;                       // `${stepId}:${recordId}`
  recordId: string; tableId: string; table: string;
  title: string; short: string | null;
  tone: 'ink' | 'route' | 'target' | 'caution' | 'dim' | 'faint' | 'none';
  alert?: boolean; archived?: boolean;
  badges: { label: string; tone: string }[];
  fields: { name: string; value: string }[];
  snippet?: string; date?: string;
  via?: { stepId: string; recordId: string; field: string };
  links?: { field: string; ids: string[] };  // for the constellation's edges
}
```

### 6.8 Enforcement

`domain/search/turn-protocol.ts` (pure) keeps the phase of the turn and answers `prepareStep`:

| Phase | Entered when | Active tools |
|---|---|---|
| `intent` | a new admin message | `clarify`, `plan_search`, and the toolkits that don't read data (memory, skills, threads, setup, credentials) |
| `choice` | a step returned `needs_choice` | only `clarify` (`toolChoice` forced) |
| `answer` | a plan ran | everything the profile allows, plus `highlight_records` |

- Data tools (`data_read`, `sql_read`, `knowledge.search`, `data_write`, `schema`, `http`) are not
  offered before a plan has run in this turn, so the model can't skip the plan.
- A turn resumed after approvals starts in `answer` (approvals only happen there); the phase is
  read back from the last assistant message's parts (a `data-search-plan` part with a finished
  status), so nothing new is stored for it.
- The protocol can be switched off in `agent_setup.search_protocol` (`plan` default, `free`), for
  models that cope badly. With `free` every tool is always offered and the prompt section below
  still asks for plans.
- The system prompt gets a fixed `## How you answer` section (placed before memories, so the
  prompt-cache prefix stays stable): the protocol, the intent list with one line per recipe, the
  clarify rules, and "cite the records you used with highlight_records".

### 6.9 Follow-ups and writes

- In the `answer` phase the model may call `plan_search` again (for example, "and what about its
  budget?"); the new steps add lanes to the same board (same search id, numbered on).
- Writes (`data_write`, `schema`) keep their approval cards. A write intent first finds its
  target through the anchor step, so the admin sees the record being changed as a card.

---

## 7. Part D: stream and storage

### 7.1 Data parts

| Part | Id | Stored in the message? | Payload |
|---|---|---|---|
| `data-run` (exists) | — | no (transient) | `{ threadId, runId }` |
| `data-search-plan` | search id | yes; replaced as steps progress | `{ searchId, plan, states: IStepState[], status }` — a few KB |
| `data-search-step` | `${searchId}:${stepId}` | no (transient) | `IStepState` with the step's lane header |
| `data-search-hit` | `${searchId}:${card.key}` | no (transient) | `{ searchId, stepId, card }` |
| `data-search-lens` | search id | yes | `{ searchId, recordKeys, view? }` |
| `data-clarify` | clarify id | yes | `{ clarifyId, question, reason, options }` |
| `data-choice` (user message) | — | yes | `{ clarifyId, optionId, recordRef? }` |

- Hits are transient because a run can produce hundreds of cards and `agent_messages.parts` is
  capped at 64 KB. The plan part stays small and is the message's record of the search.
- The frontend receives transient parts in `onData` (as `data-run` today) and feeds them to the
  board reducer (§10.3); stored parts come in `message.parts`.

### 7.2 One turn

```text
browser                     AgentChatController   AgentRuntime / ToolLoopAgent        RunSearch
  │ POST /api/agent/chat ─────────►│ RunTurn ──────────────►│ prepareStep: phase intent
  │◄── data-run ───────────────────┤                        │ model → plan_search(...)
  │                                │                        │─────────────────────────────► plan
  │◄── data-search-plan (planned) ─┼────────────────────────┼──────────── sink ◄────────────┤
  │◄── data-search-step s1 running ┼────────────────────────┼──────────── sink ◄── step s1  │
  │◄── data-search-hit × n ────────┼────────────────────────┼──────────── sink ◄────────────┤
  │◄── data-search-step s1 done ───┤   … s2, s3, s4, s5 …   │                               │
  │◄── data-search-plan (done) ────┤                        │◄── compact result ────────────┘
  │                                │                        │ prepareStep: phase answer
  │◄── text deltas ────────────────┤                        │ model → answer text
  │◄── data-search-lens ───────────┤                        │ model → highlight_records
  │◄── finish ─────────────────────┘                        │ TurnRecorder saves the message
```

The tools can write to the stream because the runtime gives them a `DeferredUiSink`
(`infrastructure/search/ui-stream-sink.ts`) through the tool context: it buffers until the UI
stream's `writer` exists (inside `createUIMessageStream`'s `execute`) and then writes through it.
Tools only run after that point, so in practice nothing is buffered; the buffer only makes the
order safe.

### 7.3 Persistence and replay

A new Prisma model in the main database, next to `AgentRun`:

```prisma
model AgentSearch {
  id               String    @id @default(cuid())
  runId            String    @map("run_id")
  threadRecordId   String    @map("thread_record_id")
  intent           String
  // the plan (JSON): steps, sources, tables
  plan             String
  // per step: state and the cards sent (JSON, at most 500 cards in all)
  steps            String    @default("[]")
  // record keys the answer cites (JSON)
  lens             String?
  // planned | running | done | needs_choice | failed | cancelled
  status           String    @default("planned")
  createdTime      DateTime  @default(now()) @map("created_time")
  lastModifiedTime DateTime? @updatedAt @map("last_modified_time")

  @@index([threadRecordId])
  @@index([runId])
  @@map("agent_search")
}
```

- Saved after every step, so a stopped run or a closed tab keeps what was found.
- **Replay**: opening an old thread, the board loads the latest search through
  `GET /api/agent/searches/:searchId` (the id is in the stored `data-search-plan` part). Cards are
  the snapshot taken at search time; the lane header offers "refresh" (re-run the stored plan with
  the same anchor records, a new search id, no model call).
- Deleting a thread deletes its searches (`ManageThreads.delete`); archived threads keep them.

### 7.4 Limits

Cards per step 50 (anchor 10), cards per run 500, snippet 200 characters, four fields per card,
`data-search-plan` part under 8 KB, `AgentSearch.steps` under 1 MB.

---

## 8. Part E: voice (kept)

- Unchanged: the switch and its lock, listening with the 3-second silence send, the half-duplex
  mic, ElevenLabs and browser voices, the Auto engine, approvals by click only, the voice hint in
  the prompt, every class in `voice/` and its specs.
- New pointer kinds in `buildSpeechScript`:
  - `board`: when a plan finishes, "I found 14 tasks, 2 people and 5 notes. They're on the board."
    once per search (the counts come from the plan part, not the model).
  - `choice`: a clarify card is read as its question plus "Please pick one of these 3, or just
    say it." Option labels are read when there are three or fewer.
- Clarify is **voice-friendly**, unlike approvals: the mic stays on, and whatever the admin says is
  sent as the answer. The client matches the words to an option label and sends `choice` when
  exactly one matches; otherwise the words go as free text.
- `IVoicePhase` gains `searching` (a plan is running: "Searching tasks…" with the running table),
  shown by `VoiceComposer`.
- Cockpit off pauses the mic and stops speech (§4.3).
- The voice files move with the rest (§10.1) but keep their names and tests.

---

## 9. Part F: modules and layers (Feature 3)

### 9.1 Principles

- **Layers depend downward only.** Pure model at the bottom, framework at the top. A lower layer
  never imports a higher one.
- **Modules are vertical slices** inside the layers (search, voice, threads, constellation), each
  with its own small public surface.
- **One contract** between frontend and backend: zod schemas in `packages/openapi`.
- **Rules are tested**: a `layers.spec.ts` on each side reads the imports and fails on a wrong
  direction (simple, no ESLint plugin needed).

### 9.2 Backend

The agent module keeps its layers; the search slice is added to each.

```text
apps/nestjs-backend/src/features/agent/
├── domain/                                pure TypeScript: no Nest, Prisma or AI SDK
│   ├── search/                            NEW
│   │   ├── search.types.ts                plan, step, source, state, card (inferred from the openapi zod)
│   │   ├── relation-graph.ts              table schemas → link edges (field, from, to, relationship, one-way)
│   │   ├── recipes.ts                     the intent catalog, by table and field names
│   │   ├── planner.ts                     recipe or custom steps + anchor + graph → validated plan
│   │   ├── anchor-choice.ts               chosen | needs_choice | empty
│   │   ├── card-projection.ts             record + schema → card (tone, badges, snippet, secrets out)
│   │   ├── tone.ts                        toneOf, sizeOfPriority (ported from the cockpit)
│   │   └── turn-protocol.ts               phase → active tools, forced clarify
│   └── ports/
│       ├── schema-catalog.port.ts         NEW: resolve the data base, table schemas by name, links
│       ├── search-log.port.ts             NEW: create, save step, set lens, get, list by thread
│       └── search-events.port.ts          NEW: plan, step, hit, lens, clarify → somewhere
├── application/search/                    NEW: use cases over ports only
│   ├── plan-search.usecase.ts             schemas → planner → log → emit plan
│   ├── run-search.usecase.ts              the executor (§6.6)
│   └── get-search.query.ts                replay and list for the UI
├── infrastructure/search/                 NEW: adapters
│   ├── schema-catalog.ts                  over the data gateway; 60 s cache, cleared on table/field events
│   ├── prisma-search-log.ts               AgentSearch
│   └── ui-stream-sink.ts                  DeferredUiSink over the UI stream writer
├── toolkits/investigate/                  NEW toolkit id `investigate`
│   └── investigate.toolkit.ts             clarify, plan_search, highlight_records
├── runtime/                               changed: prepareStep + stopWhen (agent-runtime), "How you answer"
│                                          section (context-builder), data-choice → model text (message-mapper)
└── interface/
    └── agent-search.controller.ts         NEW: GET searches (§11)
```

Rules (checked by `agent/layers.spec.ts`):

| Layer | May import |
|---|---|
| `domain` | nothing in the agent module outside `domain` |
| `application` | `domain` |
| `infrastructure` | `domain`, `application` types |
| `toolkits` | `domain`, `application`, `toolkits` |
| `runtime` | `domain`, `toolkits`, `infrastructure` |
| `interface` | `application`, `domain` types |

Today's code doesn't follow these everywhere: `application` imports `infrastructure`
(`execution-context`, `run-registry`, `agent-home`, `search-tables`, `chunker`, `pg-rag-store`)
and `runtime` (`ui-parts`, `agent-runtime`); `toolkits` import `infrastructure` (`search-tables`,
`execution-context`); `interface/agent-settings.controller` imports `execution-context`. The spec
starts with today's imports frozen in an allow-list (it fails on any new one), the search slice
adds none, and the old ones are left for a later clean-up.

The `investigate` toolkit joins `TOOLKIT_IDS` and the default `agent_setup.toolkits`; the seed
version goes up by one, and installations get it through the existing pack upgrade. Two optional
`agent_setup` fields come with it: `search_protocol` (`plan` | `free`) and `data_base_id` (pins the
base the recipes use; empty means "the base outside the Agent space with the most recipe tables").

### 9.3 Frontend: one folder, six layers

Everything agent-specific moves under `blocks/agent/`, state included. Outside it remain only what
Next.js or other features need: the page file `pages/agent.tsx`, the layouts that mount the host,
the admin settings page `blocks/admin/agent/`, and shared libraries (`@teable/ui-lib`, the shared
Streamdown renderer in `@/components/ai-elements/message`).

```text
apps/nextjs-app/src/features/app/blocks/agent/
├── index.ts                         public surface: AgentCockpitHost, AgentToggle, openAgentCockpit
├── model/                           L1 pure TypeScript: types, reducers, mappings; no React, no fetch
│   ├── search-board.ts              board reducer: plan/step/hit/lens events → IBoard
│   ├── transcript.ts                UIMessage[] → transcript items (text, plan legs, clarify, approval, tool rows)
│   ├── agent-request.ts             (moved) request body, approvals, choice
│   ├── cards.ts                     card display helpers (badges, dates, provenance text)
│   ├── metrics.ts                   readout numbers per intent
│   ├── lens.ts                      ANSWER / RETRIEVED / ALL / SEARCHING sets
│   ├── keymap.ts                    key → command
│   └── graph/                       constellation, ported from the cockpit
│       ├── types.ts  finish-graph.ts  tone.ts  limit.ts  rotate.ts
│       ├── from-board.ts            board → graph by the plan's structure
│       └── layout.ts                d3-hierarchy + d3-shape, pure
├── data/                            L2 data access: HTTP and the stream; no components, no stores
│   ├── agent-api.ts                 openapi calls + query keys (status, threads, messages, skills, searches)
│   ├── agent-chat.ts                AgentChat (AbstractChat) + StoreChatState + transport (from useAgentChat)
│   └── stream-events.ts             onData chunk → validated board event (openapi zod)
├── state/                           L3 state: zustand stores and the live session
│   ├── cockpit-store.ts             on/off, view, palette (persisted), lens, pinned trace, selected search
│   ├── session-store.ts             the live session: thread id, AgentChat, board; survives off and navigation
│   └── voice-store.ts               (moved from voice/)
├── hooks/                           L4 application hooks: state + data for the UI
│   ├── useAgentSession.ts  useSearchBoard.ts  useThreads.ts  useAgentStatus.ts
│   ├── useCockpitKeys.ts   useStagger.ts      useConstellation.ts
├── voice/                           the voice slice, as built (engines, queue, listener, script, hook, UI)
├── ui/                              L5 presentational: props in, callbacks out; no stores, no fetch
│   ├── theme/   cockpit.module.css  palettes.module.css  fonts.ts  Symbol.tsx
│   ├── shell/   CockpitFrame  Annunciator  ThreadMenu  StatusChip  DiagPanel  ZuluClock  PaletteSwitch  PowerToggle
│   ├── stage/   SearchBoard  TableLane  RecordCard  Readout  Legend  Constellation  StandbyStage
│   ├── ask/     AskRail  Transcript  PlanLegs  ClarifyCard  ApprovalCard  ToolRow  AnswerBlock  LensSwitch  Composer  Suggestions
│   └── log/     RunLog
└── containers/                      L6 wiring: hooks → ui, one per region
    ├── AgentCockpitHost.tsx         mounted by layouts; admin check; portal; inert background
    ├── AgentCockpit.tsx             the overlay: frame, keys, focus
    ├── AnnunciatorContainer.tsx  StageContainer.tsx  AskContainer.tsx
    └── AgentToggle.tsx              the on/off button used by headers and sidebars
```

| Layer | May import (inside the folder) | Outside the folder |
|---|---|---|
| `model` | `model` | `@teable/openapi` types and zod, `ai` types, d3 compute packages |
| `data` | `model` | `@teable/openapi`, `ai` |
| `state` | `model`, `data` | `zustand` |
| `hooks` | `model`, `data`, `state`, `voice` | React, `@tanstack/react-query`, `@cybernetics/sdk` hooks |
| `voice` | `model`, `state` (its store) | React, ui-lib |
| `ui` | `model` (types and pure helpers), `ui` | React, ui-lib, `motion`, i18n |
| `containers` | everything above | Next.js router, portals |

Specs sit next to the files, as today (`*.spec.ts`, `*.spec.tsx`); `layers.spec.ts` at the folder
root.

### 9.4 Shared contract

`packages/openapi/src/agent/search.ts` (new, exported from `agent/index.ts`):

- zod: `searchIntentSchema`, `searchPlanSchema`, `searchStepSchema`, `stepSourceSchema`,
  `stepStateSchema`, `searchCardSchema`;
- the data part payloads: `searchPlanPartSchema`, `searchStepPartSchema`, `searchHitPartSchema`,
  `searchLensPartSchema`, `clarifyPartSchema`, `choicePartSchema`;
- `agentSearchVoSchema` (replay), `agentSearchListVoSchema`, routes `AGENT_SEARCH`,
  `AGENT_THREAD_SEARCHES`, and the calls `getAgentSearch`, `listAgentThreadSearches`.

The backend's `domain/search/search.types.ts` re-exports the inferred types, so both sides compile
against the same shapes and the frontend validates every stream chunk before it reaches a store.

---

## 10. State management (frontend)

### 10.1 Stores

| Store | Holds | Lifetime | Persisted |
|---|---|---|---|
| `cockpit-store` | `on`, `view` (board, constellation), `palette`, `lens`, pinned trace, selected search id, focus hint | app session | `palette` only (localStorage) |
| `session-store` | the live session (§10.2) | until NEW, `/clear`, thread switch or sign-out | thread id (sessionStorage, to reopen after reload) |
| `voice-store` | as today | as today | engine, browser voice |
| React Query | status, threads, stored messages, skills, replayed searches | cache | no |

### 10.2 The live session

```ts
interface IAgentSession {
  threadId?: string;
  chat: AgentChat;                 // AbstractChat with its StoreChatState (moved from useAgentChat)
  board: IBoard;                   // model/search-board.ts
  runId?: string;
  dispose(): Promise<void>;        // stop the stream, cancel the run
}
```

- `session-store` holds at most one session. `openThread(id)` disposes the current one and
  creates a new one from the thread's messages (fetched fresh, as `AgentThreadChat` does today).
- `AgentChat.onData` routes chunks: `data-run` → run id and thread id (as today);
  `data-search-*` and `data-clarify` → `stream-events.ts` (zod check) → `board` reducer.
- Components subscribe with selectors (`useSessionStore(s => s.board.lanes)`), so a hit
  re-renders only its lane.

### 10.3 The board reducer

`model/search-board.ts`, pure, tested on its own:

```ts
type IBoardEvent =
  | { type: 'plan'; plan: ISearchPlan; states: IStepState[] }
  | { type: 'step'; state: IStepState }
  | { type: 'hit'; stepId: string; card: ISearchCard }
  | { type: 'lens'; recordKeys: string[] }
  | { type: 'replay'; search: IAgentSearchVo }
  | { type: 'reset' };

interface IBoard {
  searchId?: string;
  plan?: ISearchPlan;
  lanes: ILane[];                  // one per table, in plan order, created on the first `running`
  cards: Map<string, ISearchCard>; // by key; a hit already present is ignored (replays are safe)
  answer: Set<string>;             // lens keys
  status: 'idle' | 'running' | 'needs_choice' | 'done' | 'failed' | 'cancelled';
}
```

`replay` builds the same board from `GET /api/agent/searches/:id`, so a live board and a reopened
one are the same object.

---

## 11. API changes

| Change | Where |
|---|---|
| `IAgentChatRo.message.choice?: { clarifyId, optionId }` | `packages/openapi/src/agent/chat.ts`; `RunTurn` stores it as a `data-choice` part |
| `GET /api/agent/searches/:searchId` → `IAgentSearchVo` | `interface/agent-search.controller.ts`, `AgentAdminGuard` |
| `GET /api/agent/threads/:threadId/searches` → list (id, intent, summary, status, time) | same |
| Stream: the data parts of §7.1 | `runtime/`, `infrastructure/search/ui-stream-sink.ts` |
| `agent_setup.search_protocol`, `agent_setup.data_base_id` (optional) | pack seed v+1 |
| Prisma `AgentSearch` + migration | `packages/db-main-prisma` |

---

## 12. Files and phases

One commit per step, as before; lower-case commit subjects; tsc before each commit.

| Phase | Content | Done when |
|---|---|---|
| **P0 Contract and storage** | `packages/openapi/src/agent/search.ts`; Prisma `AgentSearch` + migration; search-log port and Prisma adapter; replay endpoints; backend `layers.spec.ts` | openapi builds, migration applies on the disposable DB, endpoints return 404/200 in e2e |
| **P1 Search domain** | `relation-graph`, `recipes`, `planner`, `anchor-choice`, `card-projection`, `tone`, `turn-protocol`, with unit tests on a fixture of the live `data-centre` schema; spike: the link filter operator for `reverse` | the §6.3 plan comes out of the planner for the fixture; all domain specs pass |
| **P2 Search on the server** | `SchemaCatalog`, `PlanSearch`, `RunSearch`, `DeferredUiSink`, `investigate` toolkit, `prepareStep` / `stopWhen`, prompt section, `data-choice` mapping, seed v+1 | e2e on the disposable DB runs §6.3 through the tools (no model) and through a mock model (AI SDK mock provider) that must plan before reading |
| **P3 Folder and full screen** (Feature 1) | move files into the six layers without changing behaviour; `session-store`, `cockpit-store`; `AgentCockpitHost`, `AgentToggle`, `openAgentCockpit`; mount in layouts; `/agent` deep link; delete `AgentPanel`, `AgentPage`, `AgentLayout`, `useChatPanelStore`, `ContextChip`; frontend `layers.spec.ts` | the existing chat works inside the full-screen overlay, on/off only, survives off and navigation; all old specs pass after the move |
| **P4 Cockpit shell and ask rail** | theme, fonts, tokens, palettes; annunciator, thread menu, status chip and diag panel; transcript, plan legs, clarify card, approval card, tool rows, composer with voice; run log; i18n keys | the screen of §5.1 minus the board, with today's features |
| **P5 Search board** | `stream-events`, board reducer, lanes, cards, stagger, hover trace, lens, readout metrics, replay | §6.3 shows lane by lane, card by card; reopening the thread shows the same board |
| **P6 Voice additions** | `board` and `choice` pointers, `searching` phase, clarify by voice, off pauses voice | voice specs pass, new cases included |
| **P7 Constellation** | port graph, limit, rotate, layout from the cockpit; `from-board`; view switch; lens; lazy load | the §6.3 search draws as a radial tree with people and knowledge links |
| **P8 Manual run and as-built** | the matrix in §13.3; as-built notes in this file | admin signs off |

Files deleted: `AgentPanel.tsx`, `AgentPage.tsx`, `AgentChatView.tsx` (split into containers and
`ui/ask`), `components/AgentMessageView.tsx`, `components/AgentToolStep.tsx`,
`components/ContextChip.tsx`, `panel-selection.ts`, `useAgentChat.ts` (into `data/agent-chat.ts`
and `state/session-store.ts`), `useAgentData.ts` (into `data/agent-api.ts` and `hooks/`),
`apps/nextjs-app/src/features/app/layouts/AgentLayout.tsx`,
`apps/nextjs-app/src/features/app/components/sidebar/useChatPanelStore.ts` and its
`LocalStorageKeys.ChatPanel` entry.

New dependencies (frontend): `d3-hierarchy`, `d3-shape`, `d3-zoom`, `d3-selection`,
`d3-interpolate` and their `@types`, exact versions pinned; no `d3` bundle.

---

## 13. Testing

### 13.1 Backend

- Domain units: planner (every recipe against the schema fixture; custom plans with a bad field,
  a forward reference, a system table), relation graph (one-way links, back-links), anchor choice
  (exact, dominant, tie, empty), card projection (tone mapping, secret fields dropped, snippet
  cut), turn protocol (phases, forced clarify, resume after approvals).
- Application: `RunSearch` with a fake gateway and sink: event order (plan, running, hits, done),
  caps, archived filter, abort mid-step, log saved after each step, compact result size.
- e2e (the disposable `agent-e2e-pg` database, never the K3s dev DB or the platform Redis; blank
  `BACKEND_CACHE_REDIS_URI` and `BACKEND_PERFORMANCE_CACHE`; at most two agent suites per vitest
  process): create the five tables with links,
  run `plan_search` for §6.3 directly, then through `POST /api/agent/chat` with a mock model;
  check the stream parts, the `AgentSearch` row, the replay endpoint, and that a data tool called
  in the `intent` phase is not offered.
- `layers.spec.ts`.

### 13.2 Frontend (vitest, `@/test-utils`)

- Model: board reducer (lanes appear on `running`, duplicate hits ignored, replay equals live),
  transcript mapping, metrics, lens, `from-board`, `limit` (port the cockpit's
  `tests/limit.test.mjs` and `rotate.test.mjs`).
- Components: `TableLane` renders cards in arrival order and counts; `ClarifyCard` sends the
  choice; `AgentCockpit` on/off with the toggle and `Mod+J`, `Esc` never turns it off; the session
  keeps streaming while off; focus goes to the composer and back.
- Voice: the existing specs, moved, plus `board` and `choice` pointers and the `searching` phase.
- `layers.spec.ts`.

### 13.3 Manual matrix

Chrome, Firefox, Safari; 1440 px, 1024 px, 390 px; MONO and CYBERPUNK; reduced motion on; voice
on in Chrome (real mic); a project with 100+ tasks (caps and "50 of 132"); an ambiguous project
name; turning off mid-search and back on; switching pages mid-reply; reopening an old thread.

---

## 14. Decisions to confirm

Defaults are what this design assumes.

| # | Decision | Default |
|---|---|---|
| D1 | "Full screen" means a full-viewport overlay over the app; `F` additionally offers the browser's Fullscreen API | yes |
| D2 | Off hides but keeps the reply and the search running; mic and speech pause | yes (today, closing stops the reply) |
| D3 | `Esc` never turns the cockpit off; only the toggle and `Mod+J` do | yes |
| D4 | The side panel, `/agent`'s own layout and `useChatPanelStore` are removed; `/agent` is a deep link | yes |
| D5 | Dark only, MONO default, CYBERPUNK option, cockpit fonts via `next/font` | yes |
| D6 | The protocol is enforced on the server (tools hidden until a plan ran), with `search_protocol: free` as the escape hatch | yes |
| D7 | One `plan_search` call plans **and** runs the whole plan (one model round trip), rather than one model call per step | yes |
| D8 | Recipes are code, by table and field names; no recipes table in v1 | yes |
| D9 | In a lane, each new card goes under the previous one (top to bottom, staggered). The alternative is a pile, new card on top | top to bottom |
| D10 | Archived records are left out unless asked for | yes |
| D11 | "Same folder" = all agent code under `blocks/agent/` in layer sub-folders; the page file, layouts, admin settings and shared libraries stay outside | yes |
| D12 | The constellation view is included, after the board (P7) | yes |
| D13 | Clarify can be answered by voice; approvals stay click-only | yes |
| D14 | The recipe base is detected (outside the Agent space, most recipe tables), pinnable in `agent_setup.data_base_id` | yes |
| D15 | Goals is a fifth, context step in the project-progress recipe, after the four steps of the goal text | yes |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Weaker models loop or call `plan_search` with bad custom steps | validation errors name the field and list the links; 3 plans per turn; `free` mode |
| Two extra phases add latency before the first words | the plan streams at once, lanes fill while the model waits; one model round trip for plan + run (D7) |
| A project with hundreds of tasks floods the board and the model | 50 cards per step, `found` counts all; compact results without bodies; render budget on the constellation |
| Recipes break when the admin renames `tasks` or `belong_project` | `missing` shows on the readout ("not found: tasks.belong_project"); custom plans still work |
| `reverse` link filters differ by relationship in Teable | P1 spike; until it passes, `knowledge_lookup` skips step 3 |
| The overlay fights the grid's global key handlers | the background is `inert` while on; the cockpit's keys stop propagation |
| Hidden-but-running sessions leak memory or keep the stream after sign-out | one session at most; disposed on sign-out, NEW, thread switch |
| Build needs Google Fonts reachable (`next/font/google`) | fall back to `@fontsource` packages if the build host is offline |
| d3 adds weight | compute-only modules, lazy-loaded with the constellation |
| Transient hits are lost if the browser drops mid-run | the board reloads from `AgentSearch`, saved after each step |
| Migration on the K3s database | additive table only; `prisma migrate deploy` is safe there (never `migrate dev` or `reset`) |
