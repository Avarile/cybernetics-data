import { FieldType } from '@teable/core';
import {
  buildEmailTableTemplate,
  EMAIL_FIELD_TYPES,
  MUTABLE_EMAIL_FIELDS,
} from './email-table.template';
import { toEmailRecordFields, toEmailStateFields } from './sync/email-record.mapper';

describe('email table template', () => {
  const template = buildEmailTableTemplate('Australia/Sydney');

  it('creates one field per key, with subject as the primary field', () => {
    const ids = Object.values(template.fieldMap);
    expect(new Set(ids).size).toBe(ids.length);
    expect(template.fields.map((f) => f.id)).toEqual(ids);
    expect(template.fields.filter((f) => (f as { isPrimary?: boolean }).isPrimary)).toEqual([
      expect.objectContaining({ name: 'subject', type: FieldType.SingleLineText }),
    ]);
    template.fields.forEach((field) => expect(field.name).toMatch(/^[a-z_]+$/));
  });

  it('uses the time zone for dates and sorts views newest first', () => {
    const receivedAt = template.fields.find((f) => f.name === 'received_at')!;
    expect(receivedAt.options).toMatchObject({ formatting: { timeZone: 'Australia/Sydney' } });
    template.views.forEach((view) =>
      expect(view.sort?.sortObjs).toEqual([
        { fieldId: template.fieldMap.received_at, order: 'desc' },
      ])
    );
    expect(template.views.map((v) => v.name)).toEqual(['All mail', 'Unread', 'With attachments']);
  });

  it('hides only template fields', () => {
    const ids = new Set(Object.values(template.fieldMap));
    template.hiddenFieldIds.forEach((id) => expect(ids.has(id)).toBe(true));
    expect(template.hiddenFieldIds).not.toContain(template.fieldMap.subject);
  });

  it('keeps the type table in step with the fields', () => {
    template.fields.forEach((field) =>
      expect(EMAIL_FIELD_TYPES[field.name as keyof typeof EMAIL_FIELD_TYPES]).toBe(field.type)
    );
    expect(MUTABLE_EMAIL_FIELDS.every((key) => key in template.fieldMap)).toBe(true);
  });
});

describe('email record mapper', () => {
  const { fieldMap } = buildEmailTableTemplate('UTC');
  const parsed = {
    subject: 'Hi',
    from: { address: 'a@example.com', name: '' },
    to: 'b@example.com',
    cc: '',
    bcc: '',
    replyTo: '',
    sentAt: new Date('2026-10-24T10:00:00Z'),
    messageId: '<m@x>',
    body: 'Hello',
    snippet: 'Hello',
    importance: 'normal' as const,
    attachments: [],
    hasAttachments: false,
  };

  it('maps a message by field id and stores empty values as empty cells', () => {
    const fields = toEmailRecordFields(
      {
        parsed,
        mailbox: 'me@example.com',
        folders: ['Inbox'],
        isRead: false,
        size: 10,
        attachments: [],
      },
      fieldMap
    );
    expect(fields[fieldMap.subject]).toBe('Hi');
    expect(fields[fieldMap.from_name]).toBeNull();
    expect(fields[fieldMap.is_read]).toBeNull();
    expect(fields[fieldMap.folders]).toEqual(['Inbox']);
    expect(fields[fieldMap.received_at]).toBe('2026-10-24T10:00:00.000Z');
    expect(fields[fieldMap.attachments]).toBeNull();
  });

  it('leaves attachments alone when they are not imported, and skips unusable fields', () => {
    const { attachments: _a, subject: _s, ...partial } = fieldMap;
    const fields = toEmailRecordFields(
      { parsed, mailbox: 'me@example.com', folders: [], size: 1, attachments: null },
      partial
    );
    expect(fields).not.toHaveProperty(fieldMap.attachments);
    expect(fields).not.toHaveProperty(fieldMap.subject);
  });

  it('writes only the state that was observed', () => {
    expect(toEmailStateFields({ isStarred: true }, fieldMap)).toEqual({
      [fieldMap.is_starred]: true,
    });
    expect(toEmailStateFields({ folders: [], deletedAtSource: true }, fieldMap)).toEqual({
      [fieldMap.folders]: null,
      [fieldMap.deleted_at_source]: true,
    });
  });
});
