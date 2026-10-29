import type { IAgentThreadVo } from '@teable/openapi';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib/shadcn';
import { Archive, ArchiveRestore, ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { formatUsage } from '../../model/format';

export interface IThreadMenuProps {
  threads: IAgentThreadVo[];
  activeId?: string;
  /** The open thread's title (also when it is not in the list yet). */
  title: string;
  showArchived: boolean;
  onShowArchived: (archived: boolean) => void;
  onOpen: (threadId: string) => void;
  onArchive: (thread: IAgentThreadVo) => void;
  onNew: () => void;
  className?: string;
}

/** The thread dropdown of the annunciator (the cockpit's dataset menu pattern). */
export const ThreadMenu = (p: IThreadMenuProps) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const threads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return p.threads.filter((th) => !q || th.title.toLowerCase().includes(q));
  }, [p.threads, search]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn('ck-menu-button', p.className)} aria-haspopup="listbox">
          <small>{t('agent.cockpit.thread', 'THREAD')}</small>
          <b>{p.title}</b>
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="ck-popover w-80 p-2">
        <div className="flex gap-1">
          <Input
            value={search}
            placeholder={t('agent.page.search', 'Search threads')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            title={t('agent.panel.new', 'New chat')}
            onClick={() => {
              p.onNew();
              setOpen(false);
            }}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <ul role="listbox" className="mt-2 max-h-80 space-y-0.5 overflow-y-auto">
          {threads.map((thread) => (
            <li
              key={thread.id}
              role="option"
              aria-selected={thread.id === p.activeId}
              className={cn(
                'group flex items-center gap-1 rounded px-2 py-1',
                thread.id === p.activeId && 'ck-selected'
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  p.onOpen(thread.id);
                  setOpen(false);
                }}
              >
                <div className="truncate">{thread.title}</div>
                <div className="text-xs opacity-70">
                  {formatUsage(thread)}
                  {thread.activeRun?.status === 'awaiting_approval' &&
                    ` · ${t('agent.page.waiting', 'waiting for you')}`}
                </div>
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100"
                title={
                  thread.status === 'archived'
                    ? t('agent.page.unarchive', 'Restore')
                    : t('agent.page.archive', 'Archive')
                }
                onClick={() => p.onArchive(thread)}
              >
                {thread.status === 'archived' ? (
                  <ArchiveRestore className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
              </Button>
            </li>
          ))}
          {threads.length === 0 && (
            <li className="px-2 py-4 text-center text-xs opacity-70">
              {t('agent.page.noThreads', 'No threads yet')}
            </li>
          )}
        </ul>
        <Button
          size="xs"
          variant="ghost"
          className="mt-1 w-full justify-start"
          onClick={() => p.onShowArchived(!p.showArchived)}
        >
          {p.showArchived
            ? t('agent.page.showActive', 'Show active threads')
            : t('agent.page.showArchived', 'Show archived threads')}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
