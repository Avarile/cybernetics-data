import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AgentPage } from '@/features/app/blocks/agent/AgentPage';
import { AgentLayout } from '@/features/app/layouts/AgentLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR, { ForbiddenError } from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

/** The agent's own page; instance admins only (design §9.1, §13). */
const Agent: NextPageWithLayout = () => <AgentPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const userMe = await ssrApi.getUserMe();
      if (!userMe?.isAdmin) throw new ForbiddenError();
      return { props: { ...(await getTranslationsProps(context, 'common')) } };
    })
  )
);

Agent.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <AgentLayout {...pageProps}>{page}</AgentLayout>;
};

export default Agent;
