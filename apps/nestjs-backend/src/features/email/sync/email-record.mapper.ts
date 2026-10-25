import type { IAttachmentItem } from '@cybernetics/core';
import type { IEmailFieldKey, IEmailFieldMap } from '../email-table.template';
import type { IParsedEmail } from './email-parser';

export interface IEmailRecordInput {
  parsed: IParsedEmail;
  mailbox: string;
  folders: string[];
  isRead?: boolean;
  isStarred?: boolean;
  threadId?: string;
  receivedAt?: Date;
  size: number;
  /** null when attachments are not imported */
  attachments: IAttachmentItem[] | null;
}

export interface IEmailStateInput {
  folders?: string[];
  isRead?: boolean;
  isStarred?: boolean;
  deletedAtSource?: boolean;
}

/** Keys without a usable field (deleted, or its type changed) are left out. */
const toFields = (values: Partial<Record<IEmailFieldKey, unknown>>, fieldMap: IEmailFieldMap) => {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values) as [IEmailFieldKey, unknown][]) {
    const fieldId = fieldMap[key];
    if (fieldId && value !== undefined) {
      fields[fieldId] = value;
    }
  }
  return fields;
};

// empty strings and false are stored as empty cells, like the UI does
const text = (value?: string) => value || null;
const checked = (value?: boolean) => (value ? true : null);

export const toEmailRecordFields = (input: IEmailRecordInput, fieldMap: IEmailFieldMap) => {
  const { parsed } = input;
  return toFields(
    {
      subject: parsed.subject,
      from: text(parsed.from?.address),
      from_name: text(parsed.from?.name),
      to: text(parsed.to),
      cc: text(parsed.cc),
      bcc: text(parsed.bcc),
      reply_to: text(parsed.replyTo),
      received_at: (input.receivedAt ?? parsed.sentAt)?.toISOString() ?? null,
      sent_at: parsed.sentAt?.toISOString() ?? null,
      snippet: text(parsed.snippet),
      body: text(parsed.body),
      ...(input.attachments === null
        ? {}
        : { attachments: input.attachments.length ? input.attachments : null }),
      folders: input.folders.length ? input.folders : null,
      is_read: checked(input.isRead),
      is_starred: checked(input.isStarred),
      has_attachments: checked(parsed.hasAttachments),
      importance: parsed.importance,
      thread_id: text(input.threadId),
      message_id: text(parsed.messageId),
      in_reply_to: text(parsed.inReplyTo),
      mailbox: input.mailbox,
      size_bytes: input.size,
      deleted_at_source: null,
    },
    fieldMap
  );
};

export const toEmailStateFields = (input: IEmailStateInput, fieldMap: IEmailFieldMap) =>
  toFields(
    {
      ...(input.folders ? { folders: input.folders.length ? input.folders : null } : {}),
      ...(input.isRead === undefined ? {} : { is_read: checked(input.isRead) }),
      ...(input.isStarred === undefined ? {} : { is_starred: checked(input.isStarred) }),
      ...(input.deletedAtSource === undefined
        ? {}
        : { deleted_at_source: checked(input.deletedAtSource) }),
    },
    fieldMap
  );
