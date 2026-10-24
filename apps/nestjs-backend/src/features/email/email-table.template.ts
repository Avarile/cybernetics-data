/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IFilter, IViewRo } from '@teable/core';
import { FieldType, generateFieldId, SortFunc, ViewType } from '@teable/core';

export type IEmailFieldKey =
  | 'subject'
  | 'from'
  | 'from_name'
  | 'to'
  | 'cc'
  | 'bcc'
  | 'reply_to'
  | 'received_at'
  | 'sent_at'
  | 'snippet'
  | 'body'
  | 'attachments'
  | 'folders'
  | 'is_read'
  | 'is_starred'
  | 'has_attachments'
  | 'importance'
  | 'thread_id'
  | 'message_id'
  | 'in_reply_to'
  | 'mailbox'
  | 'size_bytes'
  | 'deleted_at_source'
  | 'synced_at'
  | 'updated_at';

/** Field key -> field id in the email table, stored on the source so renamed fields keep syncing. */
export type IEmailFieldMap = Partial<Record<IEmailFieldKey, string>>;

interface IEmailFieldSpec {
  key: IEmailFieldKey;
  type: FieldType;
  options?: Record<string, unknown>;
}

const dateFormatting = (timeZone: string) => ({
  formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone },
});

const emailFieldSpecs = (timeZone: string): IEmailFieldSpec[] => [
  { key: 'subject', type: FieldType.SingleLineText },
  { key: 'from', type: FieldType.SingleLineText, options: { showAs: { type: 'email' } } },
  { key: 'from_name', type: FieldType.SingleLineText },
  { key: 'to', type: FieldType.LongText },
  { key: 'cc', type: FieldType.LongText },
  { key: 'bcc', type: FieldType.LongText },
  { key: 'reply_to', type: FieldType.LongText },
  { key: 'received_at', type: FieldType.Date, options: dateFormatting(timeZone) },
  { key: 'sent_at', type: FieldType.Date, options: dateFormatting(timeZone) },
  { key: 'snippet', type: FieldType.LongText },
  { key: 'body', type: FieldType.LongText, options: { showAs: { type: 'markdown' } } },
  { key: 'attachments', type: FieldType.Attachment },
  { key: 'folders', type: FieldType.MultipleSelect, options: { choices: [] } },
  { key: 'is_read', type: FieldType.Checkbox },
  { key: 'is_starred', type: FieldType.Checkbox },
  { key: 'has_attachments', type: FieldType.Checkbox },
  {
    key: 'importance',
    type: FieldType.SingleSelect,
    options: { choices: [{ name: 'low' }, { name: 'normal' }, { name: 'high' }] },
  },
  { key: 'thread_id', type: FieldType.SingleLineText },
  { key: 'message_id', type: FieldType.SingleLineText },
  { key: 'in_reply_to', type: FieldType.SingleLineText },
  { key: 'mailbox', type: FieldType.SingleLineText },
  {
    key: 'size_bytes',
    type: FieldType.Number,
    options: { formatting: { type: 'decimal', precision: 0 } },
  },
  { key: 'deleted_at_source', type: FieldType.Checkbox },
  { key: 'synced_at', type: FieldType.CreatedTime, options: dateFormatting(timeZone) },
  { key: 'updated_at', type: FieldType.LastModifiedTime, options: dateFormatting(timeZone) },
];

/** The field type each managed key was created with; sync skips a field whose type changed. */
export const EMAIL_FIELD_TYPES = Object.fromEntries(
  emailFieldSpecs('UTC').map((spec) => [spec.key, spec.type])
) as Record<IEmailFieldKey, FieldType>;

/** Fields sync keeps up to date after the first import; the rest are written once. */
export const MUTABLE_EMAIL_FIELDS: IEmailFieldKey[] = [
  'is_read',
  'is_starred',
  'folders',
  'deleted_at_source',
];

/** Columns hidden in the default views: identifiers, long text and bookkeeping. */
const HIDDEN_FIELDS: IEmailFieldKey[] = [
  'bcc',
  'reply_to',
  'body',
  'thread_id',
  'message_id',
  'in_reply_to',
  'size_bytes',
  'synced_at',
  'updated_at',
];

export const buildEmailTableTemplate = (timeZone: string) => {
  const specs = emailFieldSpecs(timeZone);
  const fieldMap = Object.fromEntries(specs.map((spec) => [spec.key, generateFieldId()])) as Record<
    IEmailFieldKey,
    string
  >;

  const fields: IFieldRo[] = specs.map((spec) => ({
    id: fieldMap[spec.key],
    name: spec.key,
    type: spec.type,
    ...(spec.key === 'subject' ? { isPrimary: true } : {}),
    ...(spec.options ? { options: spec.options } : {}),
  })) as IFieldRo[];

  const sort = { sortObjs: [{ fieldId: fieldMap.received_at, order: SortFunc.Desc }] };
  const checkboxFilter = (key: IEmailFieldKey, checked: boolean): IFilter => ({
    conjunction: 'and',
    filterSet: [{ fieldId: fieldMap[key], operator: 'is', value: checked ? true : null }],
  });
  const views: IViewRo[] = [
    { name: 'All mail', type: ViewType.Grid, sort },
    { name: 'Unread', type: ViewType.Grid, sort, filter: checkboxFilter('is_read', false) },
    {
      name: 'With attachments',
      type: ViewType.Grid,
      sort,
      filter: checkboxFilter('has_attachments', true),
    },
  ];

  return {
    fields,
    views,
    fieldMap,
    hiddenFieldIds: HIDDEN_FIELDS.map((key) => fieldMap[key]),
  };
};
