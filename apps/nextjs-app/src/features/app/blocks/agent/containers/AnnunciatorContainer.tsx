import { useQueryClient } from '@tanstack/react-query';
import { updateAgentThread } from '@teable/openapi';
import type { IAgentThreadVo, IOverviewDatasetId } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { agentQueryKeys } from '../data/agent-api';
import { useAgentStatus, useThreads } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitStore } from '../state/cockpit-store';
import {
  Annunciator,
  FocusChip,
  PaletteSwitch,
  PowerToggle,
  StatusChip,
  ZuluClock,
} from '../ui/shell/Annunciator';
import { DatasetMenu } from '../ui/shell/DatasetMenu';
import { ThreadMenu } from '../ui/shell/ThreadMenu';
import s from '../ui/theme/cockpit.module.css';

/**
 * The strip on top (cockpit design §5.2): the thread, the overview's dataset and the focus on
 * the left; palette, link state, clock and power on the right.
 */
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
  const stage = useCockpitStore((s) => s.stage);
  const cycle = useCockpitStore((s) => s.cycle);
  const failed = useCockpitStore((s) => s.overviewFailed);
  const cycleEvent = useCockpitStore((s) => s.cycleEvent);
  const setStage = useCockpitStore((s) => s.setStage);
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

  /** A dataset picked from the menu: held on the stage, which goes back to the overview. */
  const pickDataset = useCallback(
    (id: IOverviewDatasetId) => {
      setStage('overview');
      cycleEvent({ type: 'pick', id });
    },
    [setStage, cycleEvent]
  );
  const toggleCycle = useCallback(() => {
    const held = useCockpitStore
      .getState()
      .cycle.holds.some((h) => h === 'paused' || h === 'picked');
    cycleEvent(held ? { type: 'resume' } : { type: 'hold', reason: 'paused' });
  }, [cycleEvent]);

  return (
    <Annunciator
      sources={
        <>
          <span className={s.lbl}>{t('agent.cockpit.thread', 'THREAD')}</span>
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
          <DatasetMenu
            cycle={cycle}
            failed={failed}
            onOverview={stage === 'overview'}
            onPick={pickDataset}
            onToggle={toggleCycle}
          />
          {focusText && <FocusChip text={focusText} onClear={clearFocus} />}
        </>
      }
      link={
        <>
          <PaletteSwitch value={palette} onChange={setPalette} />
          <StatusChip status={status} busy={chat.busy} onLeave={close} />
          <ZuluClock />
          <PowerToggle busy={chat.busy} onOff={close} />
        </>
      }
    />
  );
};
