import { useQueryClient } from '@tanstack/react-query';
import type { IAgentThreadVo } from '@teable/openapi';
import { updateAgentThread } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { agentQueryKeys } from '../data/agent-api';
import { useAgentStatus, useThreads } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitStore } from '../state/cockpit-store';
import {
  Annunciator,
  FocusChip,
  Mark,
  PaletteSwitch,
  PowerToggle,
  Spacer,
  StatusChip,
  ZuluClock,
} from '../ui/shell/Annunciator';
import { ThreadMenu } from '../ui/shell/ThreadMenu';

/** The strip on top: threads, focus, link state, palette, clock, power (cockpit design §5.2). */
export const AnnunciatorContainer = () => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const chat = useAgentSession();
  const { data: status } = useAgentStatus();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useThreads(showArchived ? 'archived' : 'active');
  const threads = data?.threads ?? [];
  const focus = useCockpitStore((s) => s.focus);
  const clearFocus = useCockpitStore((s) => s.clearFocus);
  const close = useCockpitStore((s) => s.close);
  const palette = useCockpitStore((s) => s.palette);
  const setPalette = useCockpitStore((s) => s.setPalette);
  const selectSearch = useCockpitStore((s) => s.selectSearch);
  const title: string =
    threads.find((th) => th.id === chat.threadId)?.title ??
    (chat.threadId ? '…' : t('agent.cockpit.newThread', 'New conversation'));

  const startNew = () => {
    selectSearch(undefined);
    chat.startNew();
  };
  const archive = async (thread: IAgentThreadVo) => {
    await updateAgentThread(thread.id, {
      status: thread.status === 'archived' ? 'active' : 'archived',
    });
    if (thread.id === chat.threadId) startNew();
    void queryClient.invalidateQueries({ queryKey: agentQueryKeys.threads });
  };
  const focusText = focus?.tableId
    ? `${focus.tableName ?? t('agent.cockpit.table', 'TABLE')}${focus.rows ? ` · ${focus.rows} ${t('agent.cockpit.rows', 'ROWS')}` : ''}`
    : undefined;

  return (
    <Annunciator>
      <Mark />
      <ThreadMenu
        threads={threads}
        activeId={chat.threadId}
        title={title}
        showArchived={showArchived}
        onShowArchived={setShowArchived}
        onOpen={(id) => {
          selectSearch(undefined);
          void chat.openThread(id);
        }}
        onArchive={(thread) => void archive(thread)}
        onNew={startNew}
      />
      {focusText && <FocusChip text={focusText} onClear={clearFocus} />}
      <Spacer />
      <StatusChip status={status} busy={chat.busy} onLeave={close} />
      <PaletteSwitch value={palette} onChange={setPalette} />
      <ZuluClock />
      <PowerToggle busy={chat.busy} onOff={close} />
    </Annunciator>
  );
};
