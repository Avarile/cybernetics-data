import { useQueryClient } from '@tanstack/react-query';
import type { IAgentThreadVo } from '@teable/openapi';
import { updateAgentThread } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { Bot, Power, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { agentQueryKeys } from '../data/agent-api';
import { useThreads } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitStore } from '../state/cockpit-store';
import { ThreadMenu } from '../ui/shell/ThreadMenu';

/** The strip on top: thread menu, focus hint, power (cockpit design §5.2). */
export const AnnunciatorContainer = () => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const chat = useAgentSession();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useThreads(showArchived ? 'archived' : 'active');
  const threads = data?.threads ?? [];
  const focus = useCockpitStore((s) => s.focus);
  const clearFocus = useCockpitStore((s) => s.clearFocus);
  const close = useCockpitStore((s) => s.close);
  const title: string =
    threads.find((th) => th.id === chat.threadId)?.title ??
    (chat.threadId ? '…' : t('agent.cockpit.newThread', 'New conversation'));

  const archive = async (thread: IAgentThreadVo) => {
    await updateAgentThread(thread.id, {
      status: thread.status === 'archived' ? 'active' : 'archived',
    });
    if (thread.id === chat.threadId) chat.startNew();
    void queryClient.invalidateQueries({ queryKey: agentQueryKeys.threads });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <Bot className="size-4" aria-hidden />
      <h1 className="text-sm font-semibold">{t('agent.cockpit.title', 'Agent')}</h1>
      <ThreadMenu
        threads={threads}
        activeId={chat.threadId}
        title={title}
        showArchived={showArchived}
        onShowArchived={setShowArchived}
        onOpen={(id) => void chat.openThread(id)}
        onArchive={(thread) => void archive(thread)}
        onNew={chat.startNew}
      />
      {focus?.tableId && (
        <span className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
          {t('agent.cockpit.focus', 'FOCUS')} · {focus.tableName ?? focus.tableId}
          {focus.rows ? ` · ${focus.rows}` : ''}
          <button type="button" aria-label={t('actions.close', 'Close')} onClick={clearFocus}>
            <X className="size-3" />
          </button>
        </span>
      )}
      <span className="flex-1" />
      <Button
        size="icon-xs"
        variant="ghost"
        title={t('agent.cockpit.off', 'Turn the cockpit off (Ctrl/⌘ J)')}
        onClick={close}
      >
        <Power className="size-4" />
      </Button>
    </header>
  );
};
