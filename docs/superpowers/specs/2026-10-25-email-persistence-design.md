# Email Persistence Module — Design

> Status: agreed 2026-10-25 · Branch: `feat/email-database` · Sending email is out of scope.

## 1. Goal

Add **Create ▸ Email** (below *Microsoft Excel* in the base sidebar Create menu). It creates a
table with a fixed email schema, bound to a mailbox the user connects (Gmail, Microsoft 365 /
Outlook, or IMAP with optional SMTP). New mail is synced into the table as records.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Two new NestJS modules inside `apps/nestjs-backend`, no separate service: `features/user-integration` (credential store) and `features/email` (tables, sync). |
| D2 | Mail accounts are **per user** and reuse the existing user-integration contract (`packages/openapi/src/user-integration`, Settings ▸ Integrations UI). That contract had no backend; P0 builds it. |
| D3 | A user can connect **many** accounts, including several from the same provider. `(user, provider, address)` is unique, so connecting the same address again re-authorizes it. |
| D4 | One email table ↔ one account in v1 (`EmailSource.tableId` unique). One account may feed many tables. Several accounts in one table is a possible later extension. |
| D5 | SMTP is only an optional *outgoing server* block on an IMAP account. It is stored and can be verified, but nothing sends mail yet. |
| D6 | Every base collaborator can read the email records. The wizard says so. |
| D7 | The original HTML and raw `.eml` are **not** stored. The only body kept is markdown (`body`). |
| D8 | Attachments are imported by default and can be toggled (`config.includeAttachments`) in the wizard and in sync settings. Changing the toggle applies to new mail only. |
| D9 | When mail is deleted at the provider, the record is kept and `deleted_at_source = true` is set. |
| D10 | Field names are snake_case, like the schema packs. |

## 3. Architecture

```
Create ▸ Email ─► CreateEmailTableDialog
                    1 account:  GET /api/user-integrations/authorize/:provider   (OAuth popup)
                                POST /api/user-integrations/imap                 (form + test)
                    2 configure folders / range / attachments
                    3 POST /api/base/:baseId/email/tables
EmailController ─► EmailSourceService
                    ├ BaseNodeService.create(Table, template)   ← ordinary table node
                    ├ EmailSource (tableId ↔ integrationId, fieldMap by field id)
                    └ enqueue EMAIL_SYNC_QUEUE {sourceId, mode: backfill}
EmailSyncScheduler (1-minute tick, one instance via lock) → EMAIL_SYNC_QUEUE → EmailSyncProcessor
  lock(source) → adapter.fetch(cursor) → mailparser → turndown/sanitize → EmailRecordMapper
             → RecordOpenApiService.create/updateRecords  (cls user = source owner)
             → EmailMessage index + cursor advance (only after commit)
```

An email table is still `BaseNodeResourceType.Table`, so views, sharing, trash, graph, AI chat
and the API all keep working.

## 4. Data model (main DB, postgres + sqlite migrations)

```prisma
model UserIntegration {          // prefix uin
  id, userId, provider (gmail|outlook|imap), name
  address        String          // lower-cased mailbox address, for D3 uniqueness
  secret         String?         // AES-256-GCM JSON: OAuth tokens | {password, smtpPassword}
  metadata       String?         // JSON: userInfo{email,name}; imap{host,port,secure,username}; smtp{...}?
  status         String          // active | needs_reauth | error
  lastUsedTime, connectedTime, createdTime, lastModifiedTime
  @@unique([userId, provider, address])
}
model EmailSource {              // prefix ems
  id, baseId, tableId @unique, integrationId
  fieldMap String                // {subject: fldX, ...}
  config   String                // {folders[], since, maxMessages, includeAttachments, maxAttachmentMb, intervalMin}
  status   String                // idle | syncing | paused | error | disconnected
  lastSyncedTime, lastError, createdBy, createdTime, lastModifiedTime, deletedTime
}
model EmailSyncCursor {          // prefix esc; one per folder/label
  id, sourceId, folderId, folderName, cursor?, backfill?, lastSyncedTime
  @@unique([sourceId, folderId])
}
model EmailMessage {             // prefix emm; dedupe + tombstones
  id, sourceId, providerMessageId, internetMessageId?, threadId?, recordId?
  folders String?                // JSON: folders/labels this provider id is in
  state String                   // imported | user_deleted | source_deleted
  @@unique([sourceId, providerMessageId])
}
```

`cursor` holds the Gmail `historyId`, the Graph `deltaLink`, or `uidvalidity:lastUid:modseq` for IMAP.
Because of the index table, deleting a record doesn't cause it to be imported again, and IMAP
UIDVALIDITY resets can be matched by Message-ID.

## 5. Email table template

| Field | Type | Notes |
|---|---|---|
| `subject` | singleLineText, primary | `(no subject)` when empty |
| `from` | singleLineText, showAs email | |
| `from_name` | singleLineText | |
| `to`, `cc`, `bcc`, `reply_to` | longText | `Name <addr>, …` |
| `received_at`, `sent_at` | date, `{{timezone}}` | default sort `received_at` descending |
| `snippet` | longText | ~200 characters |
| `body` | longText, showAs markdown | HTML sanitized, then converted to markdown; truncated at ~100k chars |
| `attachments` | attachment | D8; skipped when over the size cap, names noted |
| `folders` | multipleSelect | choices created on write (typecast) |
| `is_read`, `is_starred`, `has_attachments` | checkbox | |
| `importance` | singleSelect | low / normal / high |
| `thread_id`, `message_id`, `in_reply_to` | singleLineText | |
| `mailbox` | singleLineText | account address |
| `size_bytes` | number | |
| `deleted_at_source` | checkbox | D9 |
| `synced_at`, `updated_at` | createdTime, lastModifiedTime | |

Views: **All mail** (IDs hidden), **Unread**, **With attachments**. Sync matches managed fields
by **field id** (`fieldMap`), so users can rename them. A deleted managed field, or one whose
type changed, is skipped with a warning. User-added columns are never touched. After the first
write, sync only overwrites mutable state (`is_read`, `is_starred`, `folders`, `deleted_at_source`).

## 6. Providers

| Provider | Auth | Read | Incremental |
|---|---|---|---|
| Gmail | OAuth2 + PKCE, `openid email profile gmail.readonly`, offline | Gmail REST `messages.get?format=raw` | `history.list` |
| Microsoft | Entra ID OAuth2 + PKCE, `offline_access User.Read Mail.Read`, tenant `common` | Graph `/messages/{id}/$value` | folder `messages/delta` |
| IMAP | host/port/TLS/username/password (app password) | `imapflow` + `mailparser` | UIDVALIDITY + last UID (+ CONDSTORE) |
| SMTP | optional block on the IMAP account; nodemailer `verify()` | — | — |

`gmail.readonly` is a Google *restricted* scope. Internal Workspace apps or "testing" mode work
without review; a public SaaS deployment needs Google's verification (CASA).

Env: `GMAIL_CLIENT_ID/SECRET`, `OUTLOOK_CLIENT_ID/SECRET/TENANT` (the public-settings
provider list already reads the two `*_CLIENT_ID` vars), `BACKEND_INTEGRATION_ENCRYPTION_KEY`
(32-byte base64), `EMAIL_ALLOW_PRIVATE_HOSTS`.

## 7. Sync engine

- **Backfill** is newest first, in batches of ~100, limited by the chosen range and `maxMessages`.
- **Incremental sync** runs on a schedule: an in-process 1-minute tick queues each due source (default every 5 minutes), plus *Sync now*. The tick works with and without Redis, which BullMQ repeatable jobs would not. Push sync comes later.
- **IMAP flag changes** use CONDSTORE when the server has it. Without it, the read/starred bits of the newest 200 messages are kept in the cursor, and only changes are reported.
- **Same email under several ids** (IMAP folders, or a UIDVALIDITY reset) is matched by Message-ID: one record, with one index row per id. A record's `folders` field is the union of its live rows. It gets `deleted_at_source` once no row is still present at the provider.
- **Locking and limits:** a per-source lock, and per-account concurrency limits (Graph allows ~4 requests per mailbox, Gmail IMAP ~15 connections).
- **Writes** run under `cls.run` with `user.id = source.createdBy` and `skipRecordAuditLog`, using `typecast: true` and `fieldKeyType: id`.
- **Token failures:** an `invalid_grant` response sets the integration to `needs_reauth` and its sources to `disconnected`, and sends a notification.
- **Lifecycle:**

| Event | Effect on the source |
|---|---|
| Table moved to trash | paused |
| Table restored | resumed |
| Table permanently deleted | source and index deleted |
| Table duplicated | the copy is a plain table |
| Integration deleted | source set to `disconnected` for good, records kept (a new connection has a new id; create a new email table) |
| Integration reconnected (same address) | disconnected sources resume |

## 8. Security

- **Secrets:** AES-256-GCM with a random 12-byte IV per value, stored as `v1:<iv>:<tag>:<ciphertext>`. The API never returns them; it only returns `hasSecret`.
- **OAuth:** a random `state` kept in the cache for 10 minutes and bound to the user, plus a PKCE S256 verifier. The callback page posts its result only to `PUBLIC_ORIGIN`, using a nonce CSP.
- **IMAP/SMTP hosts** are resolved once and private addresses are rejected (`EMAIL_ALLOW_PRIVATE_HOSTS` turns this off). The client connects to the resolved IP and uses the hostname for TLS SNI, which blocks DNS rebinding.
- **HTML** is sanitized before it is converted to markdown.
- **Permissions:**

| Route group | Required permission |
|---|---|
| Create an email table | `table\|create` |
| Source settings / Sync now | `table\|update` |
| Integration routes (owner only) | `user\|integrations` (for access tokens) |

## 9. API

```
GET    /user-integrations                         list (exists in contract)
PUT    /user-integrations/:id/name                rename (exists)
DELETE /user-integrations/:id                     delete (exists)
POST   /user-integrations/:id/token               OAuth access token, owner only (exists)
GET    /user-integrations/authorize/:provider     OAuth start
GET    /user-integrations/callback/:provider      OAuth callback → postMessage page
POST   /user-integrations/imap                    create/update IMAP(+SMTP) account
POST   /user-integrations/test-connection         test IMAP/SMTP without saving
GET    /user-integrations/:id/folders             (P1)
POST   /base/:baseId/email/tables                 (P1)
GET    /base/:baseId/email/sources                (P1)
GET    /email/sources/:id · PATCH · POST /:id/sync (P1/P3)
```

## 10. Frontend

| Change | Location |
|---|---|
| Create menu: **Email** item (`Mail` icon) below Excel | `BaseNodeAddResourceButton.tsx` |
| Wizard `CreateEmailTableDialog` (account → connect → configure), built like `TableImport.tsx` | `blocks/email/create-email-table/` |
| `ImapConnectForm` (react-hook-form, *Test connection*, collapsible SMTP section) | `blocks/email/create-email-table/` |
| `useOAuthPopup` (postMessage, refetch-on-focus fallback) | `blocks/email/hooks/` |
| `EmailSyncStatus` chip in the table header (last synced, Sync now, settings, Reconnect) | `table-header/TableHeader.tsx` |
| `EmailSourceSettingsDialog`, including the attachments toggle | `blocks/email/` |
| Email tables are created with the 📧 table icon (no extra sidebar query) | `EmailSourceService` |
| `imap` provider, logo and name | `user-integration/utils.ts`, `ProviderLogo.tsx` |
| i18n keys (en, zh) | `packages/common-i18n` |

## 11. Phases

Status 2026-10-25: P0 to P3 are implemented (P0 in e204a5a). The `test/email.e2e-spec.ts` suite runs against a scripted mailbox by default, or a real IMAP server when `EMAIL_E2E_IMAP_PORT` is set.

| Phase | Scope |
|---|---|
| **P0** | Prisma models + migrations; id prefixes; GCM cipher; integration config; `user-integration` backend: list/rename/delete/token, Gmail + Outlook OAuth, IMAP(+SMTP) create + test connection; `imap` in openapi + minimal frontend support. |
| **P1** | Email table template, create endpoint, Create menu, wizard, IMAP adapter (backfill + incremental), sync queue. |
| **P2** | Gmail and Graph adapters. |
| **P3** | Header status, settings, reconnect, notifications, lifecycle listener. |
| **Later** | Push sync, several accounts per table, contact linking, AI fields, sending. |
