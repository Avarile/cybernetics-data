import type { GetServerSideProps } from 'next';
import { redirect } from '@/features/app/base-node';

/**
 * The knowledge graph became the `knowledge` preset of the base graph. Old
 * links and bookmarks land there; any focus they carried is kept.
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const { baseId, focus } = context.query;
  const params = new URLSearchParams({ preset: 'knowledge' });
  if (typeof focus === 'string') {
    params.set('focus', focus);
  }
  return redirect(`/base/${baseId}/graph?${params.toString()}`);
};

const KnowledgeGraphRedirect = () => null;

export default KnowledgeGraphRedirect;
