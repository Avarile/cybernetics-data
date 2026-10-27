import { ReactQueryKeys } from '@cybernetics/sdk';
import { useIsTouchDevice, useTable, useTableId, useViewId } from '@cybernetics/sdk/hooks';
import { useQuery } from '@tanstack/react-query';
import type { IAgentStatusVo } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Bot, ExternalLink, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { Resizable } from 're-resizable';
import { useEffect, useState } from 'react';
import { useChatPanelStore } from '../../components/sidebar/useChatPanelStore';
import { AgentThreadChat } from './AgentChatView';
import { ContextChip } from './components/ContextChip';
import { countSelectedRows, PANEL_DEFAULT_WIDTH, type IGridSelection } from './panel-selection';
import { useAgentSkills, useAgentStatus } from './useAgentData';

const threadKey = (baseId: string) => `agent-thread:${baseId}`;
const readThread = (baseId: string) => {
  try {
    return localStorage.getItem(threadKey(baseId)) ?? undefined;
  } catch {
    return undefined;
  }
};
const writeThread = (baseId: string, threadId?: string) => {
  try {
    if (threadId) localStorage.setItem(threadKey(baseId), threadId);
    else localStorage.removeItem(threadKey(baseId));
  } catch {
    // private mode: the thread just is not remembered
  }
};

/** Why the agent cannot chat right now, or undefined when it can. */
const blockedReason = (
  agent: IAgentStatusVo | undefined,
  t: (key: string, fallback: string) => string
) => {
  if (!agent) return undefined;
  if (!agent.enabled) return t('agent.panel.notEnabled', 'The agent is not enabled yet.');
  if (agent.status !== 'ok') {
    return agent.lastError ?? t('agent.panel.notReady', 'The agent needs setup.');
  }
  return undefined;
};

/** Message shown instead of the chat when the agent cannot run yet. */
const NotReady = ({ text }: { text: string }) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <Bot className="size-8" />
      <p>{text}</p>
      <Button asChild size="sm" variant="outline">
        <Link href="/admin/agent">{t('agent.panel.openSettings', 'Open Admin ▸ Agent')}</Link>
      </Button>
    </div>
  );
};

/** Title and the panel's buttons: new chat, open the page, expand, close. */
const PanelHeader = ({
  threadId,
  isFullscreen,
  isTouchDevice,
  onNew,
  onToggleExpanded,
  onClose,
}: {
  threadId?: string;
  isFullscreen: boolean;
  isTouchDevice: boolean;
  onNew: () => void;
  onToggleExpanded: () => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <Bot className="size-4" />
      <span className="flex-1 truncate text-sm font-medium">{t('agent.panel.title', 'Agent')}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        title={t('agent.panel.new', 'New chat')}
        onClick={onNew}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        asChild
        title={t('agent.panel.openPage', 'Open the Agent page')}
      >
        <Link href={threadId ? `/agent?thread=${threadId}` : '/agent'}>
          <ExternalLink className="size-4" />
        </Link>
      </Button>
      {!isTouchDevice && (
        <Button size="icon-xs" variant="ghost" onClick={onToggleExpanded}>
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      )}
      <Button size="icon-xs" variant="ghost" title={t('actions.close', 'Close')} onClick={onClose}>
        <X className="size-4" />
      </Button>
    </div>
  );
};

/** The agent side panel of a table (design §13); rendered for admins only. */
export const AgentPanel = ({ baseId }: { baseId: string }) => {
  const { t } = useTranslation('common');
  const { status, close, toggleExpanded } = useChatPanelStore();
  const isTouchDevice = useIsTouchDevice();
  const tableId = useTableId();
  const viewId = useViewId();
  const table = useTable();
  const [threadId, setThreadId] = useState(() => readThread(baseId));
  // the thread the chat view was opened with; a thread the chat starts itself must not remount it
  const [opened, setOpened] = useState(threadId);
  const [chatKey, setChatKey] = useState(0);
  const [contextOff, setContextOff] = useState(false);
  const [width, setWidth] = useState(PANEL_DEFAULT_WIDTH);

  const { data: agent } = useAgentStatus(status !== 'close');
  const { data: skills } = useAgentSkills(agent?.tables.agent_skills);
  // closed, the chat is gone: it reopens on the thread it last used, fetched afresh
  useEffect(() => {
    if (status === 'close') setOpened(threadId);
  }, [status, threadId]);
  const { data: gridSelection } = useQuery<IGridSelection | null>({
    queryKey: ReactQueryKeys.gridSelection(baseId),
    queryFn: () => Promise.resolve(null),
    staleTime: Infinity,
    initialData: null,
  });

  if (status === 'close') return null;
  const isFullscreen = status === 'expanded';

  const startNew = () => {
    writeThread(baseId);
    setThreadId(undefined);
    setOpened(undefined);
    setChatKey((k) => k + 1);
  };
  const context =
    contextOff || !tableId ? { baseId } : { baseId, tableId, ...(viewId ? { viewId } : {}) };

  const blocked = blockedReason(agent, t);
  let body;
  if (blocked) {
    body = <NotReady text={blocked} />;
  } else {
    body = (
      <>
        {!contextOff && (
          <ContextChip
            tableName={table?.name}
            selectedCount={countSelectedRows(gridSelection, false)}
            onDismiss={() => setContextOff(true)}
          />
        )}
        <AgentThreadChat
          key={`${opened ?? 'new'}-${chatKey}`}
          threadId={opened}
          context={context}
          skills={skills}
          onThread={(id) => {
            writeThread(baseId, id);
            setThreadId(id);
          }}
          onClear={startNew}
        />
      </>
    );
  }

  const content = (
    <>
      <PanelHeader
        threadId={threadId}
        isFullscreen={isFullscreen}
        isTouchDevice={isTouchDevice}
        onNew={startNew}
        onToggleExpanded={toggleExpanded}
        onClose={close}
      />
      {body}
    </>
  );

  if (isTouchDevice) {
    return <div className={cn('fixed inset-0 z-50 flex flex-col bg-background')}>{content}</div>;
  }
  return (
    <Resizable
      className="ml-1 flex flex-col bg-background"
      size={{ width: isFullscreen ? '100%' : width, height: '100%' }}
      maxWidth={isFullscreen ? '100%' : '60%'}
      minWidth="300px"
      enable={{ left: !isFullscreen }}
      handleClasses={{ left: 'group' }}
      handleStyles={{ left: { width: '4px', left: '0' } }}
      handleComponent={{
        left: (
          <div className="h-full w-px bg-border group-hover:px-[1.5px] group-active:px-[1.5px]" />
        ),
      }}
      onResizeStop={(_e, _dir, _ref, d) => setWidth((prev) => prev + d.width)}
    >
      {content}
    </Resizable>
  );
};
