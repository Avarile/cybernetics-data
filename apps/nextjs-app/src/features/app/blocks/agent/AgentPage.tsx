import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IAgentThreadVo } from '@teable/openapi';
import { listAgentThreads, updateAgentThread } from '@teable/openapi';
import { Button, Input, cn } from '@teable/ui-lib/shadcn';
import { Archive, ArchiveRestore, ArrowLeft, Bot, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { AgentThreadChat } from './AgentChatView';
import { agentQueryKeys, useAgentSkills, useAgentStatus } from './useAgentData';

/** Tokens and cost of a thread, for the list. */
export const formatUsage = (t: Pick<IAgentThreadVo, 'tokensIn' | 'tokensOut' | 'costUsd'>) => {
  const tokens = (t.tokensIn ?? 0) + (t.tokensOut ?? 0);
  const k = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  return t.costUsd ? `${k} tok · $${t.costUsd.toFixed(4)}` : `${k} tok`;
};

const ThreadRow = ({
  thread,
  active,
  onOpen,
  onArchive,
}: {
  thread: IAgentThreadVo;
  active: boolean;
  onOpen: () => void;
  onArchive: () => void;
}) => {
  const { t } = useTranslation('common');
  const archived = thread.status === 'archived';
  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
        active && 'bg-accent'
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="truncate">{thread.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatUsage(thread)}
          {thread.activeRun?.status === 'awaiting_approval' &&
            ` · ${t('agent.page.waiting', 'waiting for you')}`}
        </div>
      </button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100"
        title={archived ? t('agent.page.unarchive', 'Restore') : t('agent.page.archive', 'Archive')}
        onClick={onArchive}
      >
        {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
      </Button>
    </li>
  );
};

/** /agent: the admin's threads and a full-width chat (design §13). */
export const AgentPage = () => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const threadId = typeof router.query.thread === 'string' ? router.query.thread : undefined;
  // the thread the chat view was opened with; a thread the chat starts itself must not remount it
  const [opened, setOpened] = useState(threadId);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  const status = showArchived ? 'archived' : 'active';
  const { data: agent } = useAgentStatus();
  const { data: skills } = useAgentSkills(agent?.tables.agent_skills);
  const { data: list } = useQuery({
    queryKey: [...agentQueryKeys.threads, status],
    queryFn: () => listAgentThreads({ status }),
  });

  const threads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list?.threads ?? []).filter((th) => !q || th.title.toLowerCase().includes(q));
  }, [list, search]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: agentQueryKeys.threads });
  const show = (id?: string) =>
    void router.replace(id ? { pathname: '/agent', query: { thread: id } } : '/agent', undefined, {
      shallow: true,
    });
  /** Switch the chat to another thread. */
  const openThread = (id: string) => {
    setOpened(id);
    show(id);
  };
  /** A new conversation: `+`, `/clear`, or archiving the open thread. */
  const startNew = () => {
    setOpened(undefined);
    show(undefined);
    // also when no thread was open yet (a reply had just started one)
    setChatKey((k) => k + 1);
  };
  const archive = async (thread: IAgentThreadVo) => {
    await updateAgentThread(thread.id, {
      status: thread.status === 'archived' ? 'active' : 'archived',
    });
    if (thread.id === threadId) startNew();
    refresh();
  };

  return (
    <div className="flex h-screen min-h-0 w-full">
      <aside className="flex w-72 shrink-0 flex-col border-r max-md:hidden">
        <div className="flex items-center gap-2 border-b p-3">
          <Button size="icon-xs" variant="ghost" asChild title={t('agent.page.back', 'Back')}>
            <Link href="/">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <Bot className="size-5" />
          <h1 className="flex-1 text-base font-semibold">{t('agent.page.title', 'Agent')}</h1>
          <Button
            size="icon-xs"
            variant="ghost"
            title={t('agent.panel.new', 'New chat')}
            onClick={startNew}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="space-y-2 p-2">
          <Input
            value={search}
            placeholder={t('agent.page.search', 'Search threads')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            size="xs"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived
              ? t('agent.page.showActive', 'Show active threads')
              : t('agent.page.showArchived', 'Show archived threads')}
          </Button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === threadId}
              onOpen={() => openThread(thread.id)}
              onArchive={() => void archive(thread)}
            />
          ))}
          {threads.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t('agent.page.noThreads', 'No threads yet')}
            </li>
          )}
        </ul>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <AgentThreadChat
          key={`${opened ?? 'new'}-${chatKey}`}
          threadId={opened}
          skills={skills}
          disabled={agent ? !agent.enabled || agent.status !== 'ok' : false}
          onThread={(id) => {
            show(id);
            refresh();
          }}
          onTurnFinished={refresh}
          onClear={startNew}
        />
      </main>
    </div>
  );
};
