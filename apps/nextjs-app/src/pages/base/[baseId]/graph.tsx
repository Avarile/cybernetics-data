import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { ReactElement } from 'react';
import { DynamicBaseGraph } from '@/features/app/blocks/base-graph/DynamicBaseGraph';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { IBasePageProps, NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => {
  return <DynamicBaseGraph />;
};

/**
 * Prefetches `base` and `basePermission` only — deliberately not the graph.
 * `fetchQuery` rejects on error, which would turn every backend 404 into a hard
 * 500 and bypass the error UI entirely; and the consumer is `ssr: false`, so a
 * dehydrated graph would be dead weight in the HTML.
 */
export const getServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const queryClient = new QueryClient();
      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseId as string),
          queryFn: ({ queryKey }) =>
            queryKey[1] ? ssrApi.getBaseById(baseId as string) : undefined,
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getBasePermission(queryKey[1]),
        }),
      ]);

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, baseAllConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IBasePageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
