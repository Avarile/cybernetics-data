---
name: teable-database-crud
description: Perform Create, Read, Update, and Delete operations against the Teable database. Use this skill when the user asks to query, list, search, create, update, or delete records in any of the following entities: contacts, tasks, projects, departments, goals, roles, applications (SaaS), licences, knowledge, knowledge-type, IT support tickets, contact-type, contact-profession, or daily-task-view.
---

# Teable Database CRUD Skill

## Structure

```
sandbox/
├── SKILL.md                        ← you are here
├── scripts/                        ← executable Node.js helpers (run with: node scripts/<name>.js '<json-args>')
│   ├── get-records.js              ← not used at the moment (reads use the queryRecords tool)
│   ├── create-records.js
│   ├── update-record.js
│   ├── delete-record.js
│   └── lookup-link-id.js           ← not used at the moment (use queryRecords on the linked table)
├── references/                     ← per-table field specs, constraints, filter examples
│   ├── entity-relationships.md
│   ├── contacts.md
│   ├── tasks.md
│   ├── projects.md
│   ├── departments.md
│   ├── goals.md
│   ├── roles.md
│   ├── applications.md
│   ├── licences.md
│   ├── knowledges.md
│   ├── knowledge-type.md
│   ├── it-support-ticket.md
│   ├── contact-type.md
│   ├── contact-profession.md
│   └── daily-task-view.md
└── assets/
    ├── table-ids.json              ← entity name → tableId lookup
    ├── field-ids.json              ← all field IDs per table
    ├── filter-operators.json       ← valid operators per field type
    └── payload-templates.json      ← ready-to-use create/update templates
```

---

## Authentication

All requests require a Bearer token. Read from env:

- `TEABLE_API_TOKEN` — required
- `TEABLE_BASE_URL` — default `http://localhost:3000`

---

## How to Use Scripts

**Reading is not done with scripts.** Use the `listTables`, `describeTable`,
`queryRecords` and `getRecords` tools; they run as the current user and only see the
current base. The scripts below are for writing and need write permission.

Run a write script with a single JSON argument:

```bash
node scripts/create-records.js  '{"tableId":"tblXXX","records":[{"fields":{...}}]}'
node scripts/update-record.js   '{"tableId":"tblXXX","recordId":"recXXX","fields":{...}}'
node scripts/delete-record.js   '{"tableId":"tblXXX","recordId":"recXXX"}'
```

All scripts print JSON to stdout and exit non-zero on error.

Look up `tableId` values in `assets/table-ids.json`.
Look up `fieldId` values in `assets/field-ids.json`.

---

## Workflow Decision Rules

1. **Read references/ before any table operation** — always check the per-table reference for required fields and link constraints before writing.
2. **Always resolve link IDs first** — call `queryRecords` on the linked table, filtering its primary field, to get a target record's `id` before setting any link field.
3. **filter/orderBy use field IDs** — `fieldKeyType=name` applies only to request/response bodies; filter and orderBy must use `fldXXX` IDs from `assets/field-ids.json`.
4. **Never write READ-ONLY fields** — `record_id`, `created_at`, rollup fields are server-computed; the API will reject them.
5. **Batch creates** — `records` array accepts up to 1 000 items per POST.
6. **Paginate large reads** — with `queryRecords`, call again with `skip = nextSkip` while `hasMore` is true.
7. **contacts require internal_contact_type** — this is the only table with a required link on create; query `contact-type` first.

---

## General API Patterns (quick reference)

### Read

```
GET /api/table/{tableId}/record
  ?fieldKeyType=name
  &take=100&skip=0
  &search=<string>
  &filter=<url-encoded-json>
  &orderBy=<url-encoded-json>
  &projection=<fieldName>&projection=<fieldName>
```

Response: `{ "records": [{ "id": "recXXX", "fields": {...} }], "total": N }`

### Create

```
POST /api/table/{tableId}/record
{ "fieldKeyType": "name", "records": [{ "fields": {...} }] }
```

### Update

```
PATCH /api/table/{tableId}/record/{recordId}
{ "fieldKeyType": "name", "record": { "fields": {...} } }
```

### Delete

```
DELETE /api/table/{tableId}/record/{recordId}
```

### Link field values

- Single-link: `{ "id": "recXXX" }`
- Multi-link: `[{ "id": "recXXX" }, { "id": "recYYY" }]`

### Dates

ISO 8601: `"2024-01-15T10:30:00Z"`

---

## Table Quick-Reference

| Entity             | Table ID            | Reference file                   |
| ------------------ | ------------------- | -------------------------------- |
| contacts           | tblBVWS56TLkQqW3J4z | references/contacts.md           |
| tasks              | tblEtuOcO68wvO2nCoM | references/tasks.md              |
| projects           | tbluBET7kwcH7WDUxVf | references/projects.md           |
| departments        | tblLalSqgqccQQ9eehi | references/departments.md        |
| goals              | tblJBmCNhL3D3nqgWl5 | references/goals.md              |
| roles              | tblZJc88eoY1SPWmtdg | references/roles.md              |
| applications       | tbl46utYSpisOZ94FXE | references/applications.md       |
| licences           | tbl9fT4iH6G4GXzdA9B | references/licences.md           |
| knowledges         | tblFH854k0qcvWMaXUx | references/knowledges.md         |
| knowledge-type     | tbl2vKKo0l3RfSvKzM1 | references/knowledge-type.md     |
| it-support-ticket  | tbl8Ule7YoA9LrViroC | references/it-support-ticket.md  |
| contact-type       | tblXWCU7zG6yVPpnH50 | references/contact-type.md       |
| contact-profession | tblSceUZHrMe5psnhCZ | references/contact-profession.md |
| daily-task-view    | tblfVf2gSF1axjKxXAP | references/daily-task-view.md    |

Full relationship map: `references/entity-relationships.md`
