import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getAgentAudit, listAgentCredentials } from '@teable/openapi';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

/** Credentials the agent may use: metadata only, never the secret (design §8, D4). */
export const AgentCredentialsCard = () => {
  const { t } = useTranslation('common');
  const { data } = useQuery({ queryKey: ['agent', 'credentials'], queryFn: listAgentCredentials });
  const credentials = data?.credentials ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('agent.admin.credentials', 'Credentials')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'agent.admin.credentialsHelp',
            'The agent asks for a credential with credential_request; the secret is entered here and is only ever sent to the listed hosts.'
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {credentials.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('agent.admin.noCredentials', 'No credentials yet.')}
          </p>
        )}
        {credentials.map((c) => (
          <div
            key={c.id}
            id={`credential-${c.id}`}
            className="flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm"
          >
            <span className="font-medium">{c.name}</span>
            <Badge variant={c.status === 'set' ? 'default' : 'secondary'}>
              {c.status ?? 'missing'}
            </Badge>
            {c.preview && <code className="text-xs text-muted-foreground">{c.preview}</code>}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {c.allowedHosts.join(', ')} · {c.allowedMethods.join(', ')}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

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
