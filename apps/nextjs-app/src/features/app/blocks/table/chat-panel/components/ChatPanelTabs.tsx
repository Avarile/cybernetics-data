import { useTranslation } from 'next-i18next';

interface IChatPanelTabsProps {
  activeTab: 'chat' | 'files';
  fileCount: number;
  onTabChange: (tab: 'chat' | 'files') => void;
}

export const ChatPanelTabs = ({ activeTab, fileCount, onTabChange }: IChatPanelTabsProps) => {
  const { t } = useTranslation('common');

  const tabClass = (tab: 'chat' | 'files') =>
    `-mb-px px-4 py-1.5 font-medium transition-colors ${
      activeTab === tab
        ? 'border-b-2 border-primary text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div role="tablist" className="flex shrink-0 border-b text-sm">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'chat'}
        className={tabClass('chat')}
        onClick={() => onTabChange('chat')}
      >
        {t('ai.chat.tabChat', 'Chat')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'files'}
        className={`flex items-center gap-1 ${tabClass('files')}`}
        onClick={() => onTabChange('files')}
      >
        {t('ai.chat.tabFiles', 'Files')}
        {fileCount > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">{fileCount}</span>
        )}
      </button>
    </div>
  );
};
