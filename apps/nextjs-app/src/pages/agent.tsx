import type { GetServerSideProps } from 'next';
import ensureLogin from '@/lib/ensureLogin';
import withAuthSSR, { ForbiddenError } from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

/**
 * /agent and /agent?thread=… are deep links (cockpit design §4.4): admins land on the space
 * home with the agent cockpit on.
 */
const Agent = () => null;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const userMe = await ssrApi.getUserMe();
      if (!userMe?.isAdmin) throw new ForbiddenError();
      const thread = typeof context.query.thread === 'string' ? context.query.thread : undefined;
      const query = new URLSearchParams({ agent: 'on', ...(thread ? { thread } : {}) });
      return { redirect: { destination: `/space?${query}`, permanent: false } };
    })
  )
);

export default Agent;
