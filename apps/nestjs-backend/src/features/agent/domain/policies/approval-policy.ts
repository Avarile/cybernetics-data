/**
 * ApprovalPolicy (design §9.3): a tool waits for the admin when its category is listed in the
 * profile's `approval_required`, or when the tool always asks (schema deletes).
 */
export const APPROVAL_CATEGORIES = [
  'delete_records',
  'bulk_write',
  'schema_change',
  'delete_schema',
  'http_write',
  'setup_change',
  'skill_change',
  'knowledge_write',
] as const;
export type IApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

/** Writes over this many records count as `bulk_write`. */
export const BULK_WRITE_THRESHOLD = 50;

export interface IApprovalRule<I = unknown> {
  category: IApprovalCategory;
  /** Only some calls need approval (e.g. writes over 50 records); default every call. */
  when?: (input: I) => boolean;
  /** Ask even when the profile does not list the category. */
  always?: boolean;
}

/** `needsApproval` for the AI SDK: false, true, or a per-call check. */
export function approvalFor<I>(
  rule: IApprovalRule<I> | undefined,
  approvalRequired: readonly string[]
): boolean | ((input: I) => boolean) {
  if (!rule) return false;
  if (!rule.always && !approvalRequired.includes(rule.category)) return false;
  const when = rule.when;
  return when ? (input: I) => Boolean(when(input)) : true;
}
