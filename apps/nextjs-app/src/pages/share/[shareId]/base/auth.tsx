import { createQueryClient } from '@cybernetics/sdk/context';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GetServerSideProps } from 'next';
import { BaseShareAuthPage } from '@/features/app/blocks/share/base/BaseShareAuthPage';
import { shareConfig } from '@/features/i18n/share.config';
import { allowAnyFrameAncestor } from '@/lib/allow-any-frame-ancestor';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

const queryClient = createQueryClient();

export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  const { i18nNamespaces } = shareConfig;
  allowAnyFrameAncestor(context.res);
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
});

export default function ShareBaseAuth() {
  return (
    <QueryClientProvider client={queryClient}>
      <BaseShareAuthPage />
    </QueryClientProvider>
  );
}
