import { useInfiniteQuery } from '@tanstack/react-query';
import { getAgentAudit } from '@teable/openapi';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

/** What the agent did, for whom, newest first (design §9.3). */
export const AgentAuditCard = () => {
  const { t } = useTranslation('common');
  const [runId, setRunId] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['agent', 'audit', runId],
    queryFn: ({ pageParam }) =>
      getAgentAudit({ ...(runId ? { runId } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('agent.admin.audit', 'Audit log')}</CardTitle>
        <Input
          value={runId}
          placeholder={t('agent.admin.filterRun', 'Filter by run id')}
          onChange={(e) => setRunId(e.target.value.trim())}
        />
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">{t('agent.admin.time', 'Time')}</th>
                <th className="py-1 pr-2">{t('agent.admin.tool', 'Action')}</th>
                <th className="py-1 pr-2">{t('agent.admin.result', 'Result')}</th>
                <th className="py-1">{t('agent.admin.summary', 'Summary')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t align-top">
                  <td className="whitespace-nowrap py-1 pr-2">
                    {new Date(i.createdTime).toLocaleString()}
                  </td>
                  <td className="py-1 pr-2 font-mono">{i.tool}</td>
                  <td className="py-1 pr-2">{i.status}</td>
                  <td className="max-w-xs truncate py-1" title={i.args}>
                    {i.resultSummary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('agent.admin.more', 'Load more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
