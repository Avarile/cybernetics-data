# Schema Onboarding — choose your starter data model on first login

Status: **implemented 2026-10-19** (tracked as CYBERDATA-29…40 in the cybernetics workspace)
Branch: `feat-dataschema-onboarding` · Base: `feat-db-setup`
Scope: `/space/[spaceId]` first visit, a new `schema-pack` backend feature, a dev-time extractor.

> **Deviations decided during implementation** (the sections below are the original design):
>
> - **Not one transaction.** Base and table DDL run on the data-DB connection, outside the meta
>   transaction, so §5.5's single `$tx` is impossible. The installer logs everything it creates and
>   undoes it on failure (deletes the new base, or the new tables/fields of an existing base).
> - **Routes.** Install is `POST /api/schema-pack/install` with `spaceId` in the body
>   (`base|create` via `@ResourceMeta`, like create-from-template), not under `/api/space/:id`.
> - **No standalone extractor script.** The source schema is captured through the
>   cybernetics-data MCP (no local server/PAT) into
>   `features/schema-pack/extract/__fixtures__/data-centre.schema.json`, with manual checks noted
>   in the fixture. `pack-map.ts` + `build-packs.ts` live in the backend so the transform is
>   unit-tested, and `UPDATE_PACKS=1 vitest run src/features/schema-pack/extract` regenerates
>   `packs/*.json`.
> - **Seeds.** Finance categories ship flat (the source has no parents). auditlog is optional, off.
> - **Onboarding columns** are `onboarding_status` / `onboarding_time`; existing users are
>   backfilled `legacy`. The space page latches the wizard for the visit so the base created
>   mid-install does not unmount it.
> - **Theme.** This fork's default theme is dark-styled under the `light` class, so pack accents are
>   translucent (`bg-sky-500/10`) instead of light/dark tint pairs.
> - **Re-entry** is also offered per base ("Add schema packs" in the base card menu).

> The previous content of this file (Base Graph design) is in git history:
> `git show HEAD:scripts/customized/developments/current-design.md`.

Every schema fact below was read live from base `data-centre` (`bseJEuE54y5caWO0Xc8`) on
2026-10-18 via the `cybernetics-data` MCP server. Every code path was read from the working tree.

---

## 1. Goal in one paragraph

A brand-new user who opens their space for the first time is not dropped into an empty base.
Instead they see a full-screen, friendly wizard that offers four **schema packs** —
**Progress**, **People**, **Knowledge**, **Finance** — each one a proven slice of the
`data-centre` base. They pick any combination, tweak a couple of options (currency, timezone,
starter rows), preview exactly what will be built, and get a ready-to-use, fully linked base in a
few seconds. When two packs that belong together are picked (e.g. Progress + People), the
cross-links between them (task → assignee) are built too.

---

## 2. What the source base contains, and how it splits into packs

### 2.1 Inventory (21 tables)

| Pack | Tables | Internal relationships |
|---|---|---|
| **Progress** | `goals`, `projects`, `tasks`, *opt.* `project_frameworks` | goal 1─N project (`projects`/`belong_goals`), project 1─N task (`tasks`/`belong_project`) |
| **People** | `contacts`, `companies`, `contact_type`, `contact_profession`, *opt.* `auditlog` | contact N─1 company / type / profession; auditlog N─1 contact (`generated_by_contact`) |
| **Knowledge** | `knowledges`, `knowledge_type` | knowledge N─1 type; knowledge self-tree (`knowledge_parent`/`knowledges`); knowledge N─N `related_knowledge`; type self-tree (`parent_type`/`child_types`) |
| **Finance** | `finance_Accounts`, `finance_Categories`, `finance_Payees`, `finance_Tags`, `finance_Budgets`, `finance_Transactions` | transaction N─1 account, transfer account, category, payee, budget; N─N tags; category self-tree; payee → default category; budget N─1 category |
| *excluded* | `template_table`, `system_info`, `system_status`, `table_references` | internal / instance-specific — never shipped |

`template_table` is not shipped, but it **is** the definition of the *standard field mixin* every
non-finance table carries: `title` (primary), `context` (long text, markdown), `created_at`,
`updated_at`, `deleted_at`, `is_active` (default ✓), `id` (auto number).

### 2.2 Bridges — links that cross packs

Built **only when both packs are selected** (and added later if the missing pack is installed
into the same base — see §5.6).

| Bridge | Field(s) | Kind |
|---|---|---|
| Progress × People | `projects.lead_by` → `contacts` · `tasks.assigned_to` → `contacts` (symmetric `contacts.projects`, `contacts.tasks`) | many-one, two-way |
| Progress × Knowledge | `goals.refer_knowledge`, `projects.refer_knowledge`, `tasks.refer_knowledge` → `knowledges` | many-many, one-way |
| People × Finance | none today | — |
| Knowledge × Finance | none today | — |

### 2.3 Computed fields the installer must rebuild in order

| Table | Field | Kind | Depends on |
|---|---|---|---|
| `finance_Transactions` | `Signed Amount` | formula `IF(OR(Type="Expense",Type="Transfer"), -Amount, Amount)` | `Type`, `Amount` |
| `finance_Transactions` | `Scope` | lookup (single select) | `Account` → `finance_Accounts.Scope` |
| `finance_Accounts` | `Own Txn Total`, `Incoming Transfer Total` | rollup `sum` | the two transaction links |
| `finance_Accounts` | `Net Activity` → `Current Balance` | formulas | rollups, `Opening Balance` |
| `finance_Categories` | `Parent Name` → `Full Path` | lookup → formula | `Parent Category` |
| `finance_Budgets` | `Scope`, `Actual Spent` → `Variance`, `% Used` | lookup, rollup → formulas | `Category`, transactions |

The MCP schema view does not expose lookup/rollup sources; the extractor (§5.2) reads them from
the full field VO (`lookupOptions`), so they are copied exactly rather than guessed here.

### 2.4 Things found in the source that must **not** be copied as-is

| Finding | Why it matters | Proposed handling |
|---|---|---|
| `knowledge_type.credentials` is a plain-text field | Invites storing secrets in clear text in every new user's base | **Drop** from the pack |
| Records in `knowledge_type` (and `contact_type`) include personal and sensitive categories | Seed rows would leak the owner's private data to every new user | **Never** copy records automatically; seed rows are hand-written (§5.3) |
| All date fields hard-code `timeZone: Australia/Melbourne` | Wrong for most users | Installer substitutes the timezone chosen in the wizard |
| All currency fields hard-code `symbol: "$"` | Wrong outside AUD/USD | Installer substitutes the chosen currency |
| `knowledge_type.parent_type` is one-way, and `child_types` points at a symmetric field not present in the table | Broken / orphaned hierarchy pair | Emit one clean two-way `parent_type` ⇄ `child_types` pair |
| `finance_Tags.Color` choice "Organge" | Typo | Fix to "Orange" |
| `projects.progress` uses `finished-reviewing`; `tasks.progress` uses `finished_reviewing` | Inconsistent vocabulary | **Keep as-is** (recommended): the AI chat, MCP tools and the `project-management` skill address these by name — new bases must behave the same as the source |

Table and field **names are kept exactly** (including the capitalised `finance_*` naming) for the
same reason: the AI chat and MCP tooling are written against these names, so a new user's base
works with them out of the box.

---

## 3. User experience

### 3.1 Who sees it, and when

- Shown when **all** are true: the user has never completed or skipped onboarding, the user is
  **owner** of the space, and the space has **no bases**.
- Invited collaborators never see it (they are joining someone else's data).
- Always re-openable later: the space page's **+ Create base** button becomes a split button with
  **"Start from schema packs…"**, which opens the same wizard (steps 2–5) in a large dialog.

### 3.2 Flow

```
 ① Welcome ──► ② Choose packs ──► ③ Personalise ──► ④ Review ──► ⑤ Building ──► ⑥ Ready
                    │                                              │ error
                    └─ "Skip, start empty" ─► empty base           └─► retry (nothing half-built)
```

Steps ②–④ form a 3-dot stepper ("Choose · Personalise · Review"). Back is always allowed and
never loses choices.

### 3.3 Visual language

- **Full-screen takeover** on first login (not a small modal): the moment deserves room. A soft
  radial gradient background built from the four pack accents at ~6 % opacity; a quiet top bar with
  the brand mark (left) and "Skip for now" (right).
- **One accent per pack**, used consistently on the card, the preview cluster, the review tab and
  the final "open" card:

  | Pack | Accent (Tailwind) | Icon (`lucide-react`, already a dependency) | Title | One-line promise |
  |---|---|---|---|---|
  | Progress | `sky` | `Target` | Goals, projects & tasks | Turn big goals into projects and daily tasks, and see what's moving. |
  | People | `violet` | `Users` | Contacts & companies | Remember who's who, how you know them, and who's leading what. |
  | Knowledge | `emerald` | `BookOpen` | Notes & know-how | A tree of everything you've learned, linked to the work it supports. |
  | Finance | `amber` | `Wallet` | Accounts, budgets & spending | Track every dollar across accounts, with budgets that check themselves. |

- Components only from `@teable/ui-lib/shadcn` (Button, Card, Checkbox, Switch, Select, Tabs,
  Tooltip, ScrollArea, Progress, Dialog, Sheet) — no new UI dependency.
- Motion with `tailwindcss-animate` (already in ui-lib): cards fade-and-rise in 40 ms stagger,
  selection is a 150 ms ring + tint, preview edges draw in. Everything collapses to opacity-only
  under `prefers-reduced-motion`.
- Light and dark: tints use `{accent}-50` / `dark:{accent}-950/40`, rings `{accent}-500`; all text
  stays on `foreground` / `muted-foreground` tokens so contrast holds in both themes.

### 3.4 ① Welcome

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ cybernetics                                                  Skip for now  │
│                                                                              │
│                         👋  Welcome, {name}                                  │
│               Let's shape your data centre in under a minute.                │
│                                                                              │
│      Pick the areas of life and work you want to organise — we'll build      │
│      the tables, links and formulas for you. You can add more any time.      │
│                                                                              │
│                           [  Get started  → ]                                │
│                                                                              │
│              ● sky   ● violet   ● emerald   ● amber   (pack dots drift in)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 ② Choose packs — the heart of the flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ cybernetics            ● Choose ─ ○ Personalise ─ ○ Review     Skip for now │
│                                                                              │
│  What do you want to organise?                       ┌─ Your base ─────────┐ │
│  Choose one or more. Recommended: Progress + Knowledge│                     │ │
│                                                       │   (goals)           │ │
│  ┌──────────────────────────┐ ┌──────────────────────┐│     │               │ │
│  │ ◎ Target            [✓] │ │ ◎ Users          [ ] ││  (projects)╌╌╌╌┐   │ │
│  │ Goals, projects & tasks  │ │ Contacts & companies ││     │          ╎   │ │
│  │ Turn big goals into …    │ │ Remember who's who … ││  (tasks)╌╌╌(contacts)│
│  │                          │ │                      ││     ╎      faded    │ │
│  │ goals · projects · tasks │ │ contacts · companies ││  (knowledges)       │ │
│  │ ✓ 10-stage progress      │ │ ✓ types & professions││     │              │ │
│  │ ✓ priorities & deadlines │ │ ✓ who leads what     ││  (knowledge_type)   │ │
│  └──────────────────────────┘ └──────────────────────┘│                     │ │
│  ┌──────────────────────────┐ ┌──────────────────────┐│ 6 tables · 2 packs  │ │
│  │ ◎ BookOpen          [✓] │ │ ◎ Wallet         [ ] ││ + Add People to     │ │
│  │ Notes & know-how         │ │ Accounts, budgets …  ││   assign tasks  [+] │ │
│  │ …                        │ │ …                    │└─────────────────────┘ │
│  └──────────────────────────┘ └──────────────────────┘                       │
│                                                                              │
│  Select all                                               [ Continue → ]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Pack card** (`PackCard`)
- Large tap target, whole card toggles. `role="checkbox"`, `aria-checked`, focus ring; keys
  `1`–`4` toggle cards, `Enter` continues.
- Content: icon in an accent-tinted circle, title, promise, table chips, three "what you get"
  bullets (from the pack catalog, §5.4), and a **"Peek inside"** link that opens a side sheet with
  the field list for each table.
- Selected: accent ring, tinted background, filled check badge; unselected cards keep full colour
  (no greying out — every choice should feel inviting).

**Live preview** (`SchemaPreview`, right column; bottom sheet on mobile)
- A small hand-laid SVG relation map: one cluster per pack in its accent colour, nodes = tables,
  solid edges = internal links.
- **Bridges are the "aha" moment**: when only one side is selected, the bridge is drawn dashed
  and faded, with the missing pack's node as a ghost; selecting the other pack animates the edge
  solid. Under the map, a nudge: *"Add People to assign tasks to contacts [+]"* — one click adds it.
- Footer counter: `N tables · M links · K packs`, computed from the catalog.

`Continue` is disabled with a hint ("Pick at least one") until one pack is selected.
**Default selection: none** — the recommendation is shown as text and one-click chip, not
pre-ticked, so the user makes the choice consciously.

### 3.6 ③ Personalise

```
  Make it yours
  ┌ General ───────────────────────────────────────────────────────────────┐
  │ Base name         [ My data centre                    ]  🧭 icon picker │
  │ Timezone          [ Australia/Melbourne ▾ ]  (detected from browser)    │
  │ Starter rows      (●) Include examples so it doesn't feel empty         │
  └────────────────────────────────────────────────────────────────────────┘
  ┌ ● Progress ────────────────────────┐ ┌ ● Finance ──────────────────────┐
  │ [✓] Project frameworks library     │ │ Currency  [ AUD $ ▾ ]           │
  │     (OKR, PDCA, meeting strategies)│ │ [✓] Budgets  [✓] Tags           │
  └────────────────────────────────────┘ └─────────────────────────────────┘
  ┌ ● People ──────────────────────────┐
  │ [ ] Interaction log (auditlog)     │
  └────────────────────────────────────┘
```

- Only sections for selected packs are shown.
- Optional tables are switches; turning one off also removes fields that depend on it (e.g.
  Budgets off → `finance_Transactions.Budget` and the budget rollups go). The preview updates.
- Core tables of a pack cannot be switched off (keeps the pack coherent and the formulas valid).
- Timezone defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`; currency defaults from
  the browser locale, choices from a fixed allowlist.

### 3.7 ④ Review

```
  Here's what we'll build                     {n} tables · {n} fields · {n} links
  ┌ [● Progress] [● People] [● Knowledge] [● Finance] ─────────────────────────┐
  │  tasks                                                    ▸ 14 fields      │
  │    Aa title   ¶ context   ◉ progress (7)   ◉ priority (5)   📅 started_at   │
  │    📅 finished_at   ↗ belong_project   ↗ assigned_to ⟵ People bridge        │
  │    + 5 standard fields (created_at, updated_at, …)                          │
  │  projects                                                 ▸ 13 fields      │
  │  goals                                                    ▸ 10 fields      │
  └────────────────────────────────────────────────────────────────────────────┘
  ← Back                                                     [ Build my base ✨ ]
```

- Field rows use the same field-type icons as the grid header (`@teable/sdk` field icon map), so
  the user meets the vocabulary they'll see in the table.
- Bridge fields carry a small accent tag naming the other pack.
- The counts in the header are real (from the install plan), not marketing numbers.

### 3.8 ⑤ Building

- The preview map from step ② moves to centre stage and plays an "assembling" loop (nodes pulse
  in accent colour). Beside it, the plan list: *Creating tables → Linking → Formulas & rollups →
  Starter rows*.
- **No fake progress.** The install is one request (§5.5); steps show a running spinner, and
  checkmarks only cascade (600 ms total) once the server confirms success.
- Typical duration 3–10 s. After 20 s a reassurance line appears ("Still working — big packs take
  a moment").
- Failure: the transaction rolls back, so nothing half-built exists. Show the server's message,
  **Try again** (same choices) and **Back to review**.

### 3.9 ⑥ Ready

```
                         ✓  Your data centre is ready
              6 tables are waiting for you. Where do you want to start?

     ┌ ● Progress ──────────┐ ┌ ● Knowledge ─────────┐ ┌ ✦ See it as a graph ─┐
     │ Open tasks →         │ │ Open knowledges →    │ │ Every record, linked │
     └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
                 Tip: ask the AI assistant "add my first project"
```

- One card per installed pack (opens its primary table: `tasks`, `contacts`, `knowledges`,
  `finance_Transactions`), plus **See it as a graph** (the existing base-graph page) when two or
  more packs are installed.

### 3.10 Mobile (< 768 px)

Cards stack in one column; the preview becomes a sticky bottom bar ("6 tables · View map") that
opens a `Sheet`; Personalise sections become an accordion; Review tabs become a select.
Full-screen takeover stays full-screen.

### 3.11 Copy and i18n

New namespace `onboarding` in `packages/common-i18n/src/locales/{en,zh}/onboarding.json`
(other locales fall back to `en`). Pack titles, promises and bullets come from the catalog as
i18n keys, not from the pack JSON, so translators never touch schema files.

---

## 4. Architecture overview

```
 dev time                                   runtime
 ────────                                   ───────
 data-centre base ──► fixture ──► build-packs.ts ──►  packs/*.pack.json  (checked in, PR-reviewed)
 (bseJEuE54y5caWO0Xc8)  (via MCP)  + pack-map.ts          seeds/*.json   (hand-written)
                                                   │
                       GET  /api/schema-pack ◄─────┤  catalog: packs, tables, field summaries, bridges
 Wizard (Next.js) ───► POST /api/space/:spaceId/schema-pack/install
                                                   │  plan (pure) ─► SchemaPackInstaller (one $tx)
                                                   ▼
                                        new base: tables, links, computed fields, views, seed rows
                       PATCH /api/user/onboarding  (completed | skipped)
```

Why a declarative pack spec instead of "duplicate the source base" (what
`BaseService.createBaseFromTemplate` does today):

1. Users pick a **subset**; duplicating copies all 21 tables and would need surgical deletes.
2. Bridges must appear only when both ends exist — a duplicate can't express that.
3. Timezone/currency substitution and the cleanups in §2.4 need a transform step anyway.
4. The source is a **personal, private base**; runtime must not read it on behalf of other users.

---

## 5. Backend design

### 5.1 Pack spec (shared types in `packages/openapi/src/schema-pack/`)

```ts
export type SchemaPackId = 'progress' | 'people' | 'knowledge' | 'finance';

export interface ISchemaPack {
  id: SchemaPackId;
  version: number;                 // bump on any schema change
  tables: ISchemaPackTable[];
}

export interface ISchemaPackTable {
  key: string;                     // stable symbolic id, e.g. 'tasks'
  name: string;                    // exact source name
  icon?: string;
  optional?: boolean;              // switchable in Personalise
  fields: ISchemaPackField[];
  views?: ISchemaPackView[];       // copied from the source table's views
}

export interface ISchemaPackField {
  key: string;                     // e.g. 'tasks.assigned_to'
  name: string;
  type: FieldType;
  isPrimary?: boolean;
  options: unknown;                // field options with every id replaced by a {key} placeholder
  lookup?: { linkField: string; target: string }; // for lookups / rollups
  requiresTables?: string[];       // dropped when any listed table is not installed
}

export interface ISchemaPackBridge {
  packs: [SchemaPackId, SchemaPackId];
  fields: ISchemaPackField[];      // link fields; symmetric side generated by the link type
}
```

- Formula expressions are stored with placeholders: `{finance_Transactions.Amount}` instead of
  `{flde1ox2n7Q30UUP938}`. The installer rewrites them to real field ids.
- `{{timezone}}` and `{{currencySymbol}}` placeholders replace the hard-coded values (§2.4).
- Validated with zod at load time (backend boot) — a bad pack file fails fast in CI, not at a
  user's first login.

### 5.2 Extractor (dev-time) — `apps/nestjs-backend/src/features/schema-pack/extract/`

"Generate the schema from my existing base" happens here, once per change, by a developer:

1. Capture the tables/fields of `bseJEuE54y5caWO0Xc8` through the cybernetics-data MCP into
   `extract/__fixtures__/data-centre.schema.json`. **Schema only — never records.** Note any
   manual checks or inferred values in the fixture's `note`.
2. `build-packs.ts` applies `pack-map.ts`: table → pack, optional tables, excluded fields
   (`credentials`), unmapped tables never shipped (`system_*`, `table_references`,
   `template_table`), fixes from §2.4, and the bridges.
3. It rewrites all ids to keys and emits
   `apps/nestjs-backend/src/features/schema-pack/packs/{progress,people,knowledge,finance}.pack.json`
   plus `bridges.json`; every change it makes is listed in its `report`.
4. `build-packs.spec.ts` is a golden test: committed packs must equal the build output.
   `UPDATE_PACKS=1 pnpm -F @teable/backend exec vitest run src/features/schema-pack/extract`
   rewrites them; review the diff in git.

### 5.3 Seed rows — `apps/nestjs-backend/src/features/schema-pack/seeds/`

Hand-written, generic, small:

| Table | Rows |
|---|---|
| `contact_type` | family, friend, colleague, client, self |
| `knowledge_type` | general, how-to, reference, project lessons, personal (as a tree of 2 levels) |
| `project_frameworks` | OKR goal setting, PDCA project cycle, one-on-one meeting, decision log |
| `finance_Categories` | the 24 generic income/expense categories from the source (Food, Transport, Utilities, Rent & Housing, Business Income, Refunds, …) with parents |
| `finance_Accounts` | "Everyday account" (Checking, Personal), opening balance 0 |
| `goals` → `projects` → `tasks` | one linked example: "Get organised" → "Set up my data centre" → 3 tasks |
| `knowledges` | one "Welcome — how this knowledge base works" note |

Installed only when "Starter rows" is on; each seed row's `context` says it's an example and can be
deleted.

### 5.4 Module — `apps/nestjs-backend/src/features/schema-pack/`

| File | Role |
|---|---|
| `schema-pack.module.ts` | Imports Table/Field/Record/View open-api modules |
| `schema-pack.catalog.ts` | Loads + zod-validates pack JSON at boot; builds the catalog VO |
| `schema-pack.planner.ts` | **Pure** `planInstall(packs, options, catalog, existingTables?) → IInstallPlan` — table list, ordered field phases, bridges, seeds, counts |
| `schema-pack.installer.ts` | Executes a plan inside one `prismaService.$tx` |
| `schema-pack.controller.ts` | The routes below |
| `schema-pack.planner.spec.ts` | Unit tests (§7) |

### 5.5 API

| Method & path | Permission | Body / result |
|---|---|---|
| `GET /api/schema-pack` | logged in | catalog: packs → tables → field summaries (name, type, isComputed), bridges, counts, i18n keys |
| `POST /api/schema-pack/plan` | logged in | `{packs, options}` → plan counts + table/field list (drives Review so the numbers match the install exactly) |
| `POST /api/space/:spaceId/schema-pack/install` | `base\|create` on space | `{packs, options, baseId?}` → `{baseId, tables: {key, id}[]}` |
| `PATCH /api/user/onboarding` | self | `{status: 'completed' \| 'skipped'}` |

Install `options` (zod, at the controller boundary):
`baseName` (1–100 chars), `icon` (single emoji), `timezone` (must be in
`Intl.supportedValuesOf('timeZone')`), `currency` (allowlist), `starterRows` (bool),
`optionalTables` (subset of the selected packs' optional keys). `packs`: non-empty, unique, known
ids. Unknown keys rejected.

Install phases (one transaction, `thresholdConfig.bigTransactionTimeout`, same as template apply):

1. Create base (name, icon) — or use `baseId` when adding packs to an existing base.
2. Create each table **with** its primary and plain fields in one call (so the default
   Name/Count/Status fields are not created and then deleted).
3. Create link fields — internal, then bridges whose both packs are present.
4. Create lookups → rollups → formulas in the planner's topological order, placeholders resolved.
5. Create views from the pack (or keep the default grid).
6. Insert seed rows (if on), resolving links by seed key.
7. If this was first-run onboarding, set the user's onboarding status to `completed`.

Any failure rolls back everything. The response returns only after commit.

### 5.6 Adding packs later

The re-entry wizard calls install with `baseId`. The planner receives the base's existing tables
(matched by **name**), skips tables already present, and adds bridges whose other end now exists
(e.g. People added later → `tasks.assigned_to` appears). A table name that exists with a
conflicting shape is reported in the plan and skipped, never overwritten.

### 5.7 Onboarding state

- Prisma: add `onboardingTime DateTime? @map("onboarding_time")` and
  `onboardingStatus String? @map("onboarding_status")` to `User` (`packages/db-main-prisma`).
- Migration backfills existing users with `status = 'legacy'`, so only users created after the
  release see the wizard.
- Exposed on `IUserMeVo` so SSR and the client can read it.

### 5.8 First-visit routing — `apps/nextjs-app/src/pages/space/[spaceId].tsx`

Today an owner entering an empty space gets a base auto-created and is redirected
(`[spaceId].tsx`, "If owner enters an empty space, auto-create a base and redirect"). Change:

```ts
const me = await ssrApi.getUserMe();
const needsOnboarding = isOwner && basesInSpace.length === 0 && !me.onboardingStatus;
if (needsOnboarding) → render SpaceInnerPage with `showOnboarding` prop (no auto-create)
else (existing behaviour)
```

"Skip for now" calls `PATCH /api/user/onboarding {skipped}` then the existing `createBase` path,
so a skipper gets exactly today's experience. Self-hosted signups have no auto-created space
(`createUserWithSettingCheck` only creates one on cloud) — they reach the wizard after creating
their first space; no change needed there.

---

## 6. Frontend design

```
apps/nextjs-app/src/features/app/blocks/space/schema-onboarding/
  SchemaOnboarding.tsx        full-screen shell (first run) — step state machine
  SchemaPackDialog.tsx        same steps ②–⑥ in a Dialog (re-entry from + Create base)
  steps/WelcomeStep.tsx
  steps/ChoosePacksStep.tsx
  steps/PersonaliseStep.tsx
  steps/ReviewStep.tsx
  steps/BuildingStep.tsx
  steps/ReadyStep.tsx
  components/PackCard.tsx
  components/PackPeekSheet.tsx
  components/SchemaPreview.tsx      SVG relation map; fixed cluster layout per pack
  hooks/useSchemaPackCatalog.ts     react-query GET catalog
  hooks/useInstallPlan.ts           react-query POST plan (debounced on choice change)
  hooks/useInstallSchemaPacks.ts    mutation; invalidates baseAll / space queries
  packTheme.ts                      accent classes + lucide icon per pack id
  state.ts                          wizard state (packs, options, step) — persisted to sessionStorage
```

- Wizard state lives in one `useReducer`; sessionStorage keeps it across an accidental refresh.
- `SchemaPreview` layout is static per pack (no physics) — four quadrants, nodes pre-placed — so
  it is cheap, stable and identical for every user. Bridges are paths between quadrants.
- `SpaceInnerPage.tsx`: render `<SchemaOnboarding />` when `showOnboarding`; turn
  "+ Create base" into a split button with "Start from schema packs…".
- New `ReactQueryKeys.schemaPackCatalog()` and `schemaPackPlan(...)` in `@teable/sdk/config`.

---

## 7. Testing

| Level | What |
|---|---|
| Unit — planner | every one of the 15 pack subsets: table set, bridges present iff both packs, optional-table pruning removes dependent fields, computed fields topologically valid, placeholders all resolvable |
| Unit — catalog | every pack JSON passes zod; no field id literals (`fld…`) survive in options/expressions; no `credentials` field |
| E2E — backend | install each single pack and all four; assert counts; insert a transaction and check `Current Balance`, `Variance`, `% Used`; add People to a Progress-only base and assert bridge fields appear; forced failure leaves no base behind |
| E2E — routing | new user + empty owned space → wizard, no base auto-created; legacy user → today's behaviour; collaborator → no wizard |
| Frontend unit | card toggling (mouse + keys 1–4), bridge preview state, Continue disabled with none selected, error state keeps choices |
| Extractor | snapshot test against a fixture schema JSON (no network) |

---

## 8. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| 1 | Keep source names exactly (`finance_*` casing, `finished-reviewing` vs `finished_reviewing`)? | **Keep** — AI chat and MCP skills depend on them |
| 2 | Ship `auditlog` in People as optional "Interaction log"? | **Yes, optional, off by default** |
| 3 | Show the wizard to existing users once? | **No** — backfill as `legacy`; they can use "Start from schema packs…" |
| 4 | Starter rows on by default? | **On** — an empty base is the least friendly first impression |
| 5 | One base for all packs, or one base per pack? | **One base** — bridges and the graph view need the tables together |
| 6 | Locales at launch | `en` + `zh`, others fall back to `en` |

---

## 9. Files touched (summary)

| Area | Files |
|---|---|
| Extractor | `apps/nestjs-backend/src/features/schema-pack/extract/` (`pack-map.ts`, `build-packs.ts`, spec, fixture) |
| Shared types | `packages/openapi/src/schema-pack/*` (types, zod, route clients) |
| Backend | `apps/nestjs-backend/src/features/schema-pack/**` (module, catalog, planner, installer, controller, packs/, seeds/), register in app module |
| Prisma | `packages/db-main-prisma/prisma/template.prisma` + migration (User onboarding columns) |
| User | `user.service.ts` / user controller: `PATCH /api/user/onboarding`, `IUserMeVo` fields |
| SSR | `apps/nextjs-app/src/pages/space/[spaceId].tsx` |
| Frontend | `blocks/space/schema-onboarding/**`, `blocks/space/SpaceInnerPage.tsx` |
| i18n | `packages/common-i18n/src/locales/{en,zh}/onboarding.json`, `features/i18n/space.config.ts` |
