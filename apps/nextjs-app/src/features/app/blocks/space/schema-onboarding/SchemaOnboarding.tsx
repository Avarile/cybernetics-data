import { useMutation } from '@tanstack/react-query';
import { createBase, updateUserOnboarding } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useBrand } from '../../../hooks/useBrand';
import { SchemaPackWizard } from './SchemaPackWizard';

/**
 * First-run takeover for a new owner of an empty space. Skipping records the choice and
 * falls back to exactly what used to happen: a blank base.
 */
export const SchemaOnboarding = ({ spaceId }: { spaceId: string }) => {
  const { t } = useTranslation(['onboarding', 'common']);
  const router = useRouter();
  const { brandName } = useBrand();

  const skip = useMutation({
    mutationFn: async () => {
      await updateUserOnboarding({ status: 'skipped' });
      return (await createBase({ spaceId, name: t('common:noun.base') })).data;
    },
    onSuccess: (base) => router.push({ pathname: '/base/[baseId]', query: { baseId: base.id } }),
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,theme(colors.sky.500/0.08),transparent_45%),radial-gradient(ellipse_at_top_right,theme(colors.violet.500/0.08),transparent_45%),radial-gradient(ellipse_at_bottom_left,theme(colors.emerald.500/0.07),transparent_45%),radial-gradient(ellipse_at_bottom_right,theme(colors.amber.500/0.07),transparent_45%)]"
      />
      <header className="relative flex items-center justify-between px-4 py-3 sm:px-8">
        <span className="text-sm font-semibold">◆ {brandName}</span>
        <Button variant="ghost" size="sm" disabled={skip.isPending} onClick={() => skip.mutate()}>
          {t('onboarding:skip')}
        </Button>
      </header>
      <main className="relative flex flex-1 flex-col">
        <SchemaPackWizard spaceId={spaceId} mode="onboarding" />
      </main>
    </div>
  );
};
