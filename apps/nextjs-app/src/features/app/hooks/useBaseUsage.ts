import { useBaseId } from '@cybernetics/sdk/hooks';
import { useIsReadOnlyPreview } from '@cybernetics/sdk/hooks/use-is-readonly-preview';
import { useQuery } from '@tanstack/react-query';
import type { IUsageVo } from '@teable/openapi';
import { getBaseUsage, BillingProductLevel, UsageFeatureLimit } from '@teable/openapi';
import { useIsCloud } from './useIsCloud';
import { useIsEE } from './useIsEE';

// Returned on self-hosted (non-EE, non-Cloud) instances — all features unlocked.
// Typed as IUsageVo so this constant cannot drift from the wire schema and
// narrow the hook's return type below what callers expect.
const SELF_HOSTED_USAGE: IUsageVo = {
  level: BillingProductLevel.Enterprise,
  limit: {
    [UsageFeatureLimit.FieldAIEnable]: true,
    [UsageFeatureLimit.ChatAIEnable]: true,
    [UsageFeatureLimit.ButtonFieldEnable]: true,
    [UsageFeatureLimit.AutomationEnable]: true,
    [UsageFeatureLimit.AuditLogEnable]: true,
    [UsageFeatureLimit.AdminPanelEnable]: true,
    [UsageFeatureLimit.RowColoringEnable]: true,
    [UsageFeatureLimit.UserGroupEnable]: true,
    [UsageFeatureLimit.AdvancedExtensionsEnable]: true,
    [UsageFeatureLimit.AdvancedPermissionsEnable]: true,
    [UsageFeatureLimit.PasswordRestrictedSharesEnable]: true,
    [UsageFeatureLimit.AuthenticationEnable]: true,
    [UsageFeatureLimit.DomainVerificationEnable]: true,
    [UsageFeatureLimit.OrganizationEnable]: true,
    [UsageFeatureLimit.AppEnable]: true,
    [UsageFeatureLimit.CustomDomainEnable]: true,
    [UsageFeatureLimit.MaxRows]: Infinity,
    [UsageFeatureLimit.MaxSizeAttachments]: Infinity,
    [UsageFeatureLimit.MaxNumAutomationRuns]: Infinity,
    [UsageFeatureLimit.MaxNumDatabaseConnections]: Infinity,
    [UsageFeatureLimit.MaxRevisionHistoryDays]: Infinity,
    [UsageFeatureLimit.MaxAutomationHistoryDays]: Infinity,
    [UsageFeatureLimit.APIRateLimit]: Infinity,
    [UsageFeatureLimit.MaxNumAutomationSendEmail]: Infinity,
  },
};

export const useBaseUsage = (props?: { disabled?: boolean }) => {
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseId = useBaseId() as string;
  const isReadOnlyPreview = useIsReadOnlyPreview();

  const { data: baseUsage } = useQuery({
    queryKey: ['base-usage', baseId],
    queryFn: ({ queryKey }) => getBaseUsage(queryKey[1]).then(({ data }) => data),
    enabled: !props?.disabled && (isCloud || isEE) && !isReadOnlyPreview,
  });

  if (!isEE && !isCloud) return SELF_HOSTED_USAGE;

  return baseUsage;
};

export const useBaseUsageWithLoading = (props?: { disabled?: boolean }) => {
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseId = useBaseId() as string;

  const {
    data: baseUsage,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ['base-usage', baseId],
    queryFn: ({ queryKey }) => getBaseUsage(queryKey[1]).then(({ data }) => data),
    enabled: !props?.disabled && (isCloud || isEE),
  });

  if (!isEE && !isCloud) return { baseUsage: SELF_HOSTED_USAGE, loading: false, isFetched: true };

  return { baseUsage, loading: isLoading, isFetched };
};
