import { Maximize2, MessageSquare, Minimize2, Trash2, X } from '@teable/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IChatPanelHeaderProps {
  status: 'open' | 'expanded';
  isTouchDevice: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
  onClearSession: () => void;
  agentLabel?: string;
  onClearAgent?: () => void;
}

export const ChatPanelHeader = ({
  status,
  isTouchDevice,
  onClose,
  onToggleExpanded,
  onClearSession,
  agentLabel,
  onClearAgent,
}: IChatPanelHeaderProps) => {
  const { t } = useTranslation('common');
  const fullscreenLabel =
    status === 'expanded' ? t('ai.chat.exitFullscreen') : t('ai.chat.fullscreen');

  return (
    <div className="flex shrink-0 items-center justify-between px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{t('ai.chat.title', 'AI Chat')}</span>
        {agentLabel && (
          <div className="flex min-w-0 max-w-[160px] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            <span className="truncate">{agentLabel}</span>
            {onClearAgent && (
              <button
                type="button"
                className="ml-0.5 shrink-0 hover:text-primary/70"
                onClick={onClearAgent}
                title={t('ai.chat.switchToLocal', 'Switch to Local AI')}
                aria-label={t('ai.chat.switchToLocal', 'Switch to Local AI')}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              title={t('ai.chat.clearSession', 'Clear session')}
              aria-label={t('ai.chat.clearSession', 'Clear session')}
            >
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('ai.chat.clearSessionTitle', 'Clear conversation?')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  'ai.chat.clearSessionDescription',
                  'This will permanently delete all messages in this session. This action cannot be undone.'
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel', 'Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={onClearSession}>
                {t('actions.delete', 'Delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {!isTouchDevice && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleExpanded}
            title={fullscreenLabel}
            aria-label={fullscreenLabel}
          >
            {status === 'expanded' ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          title={t('actions.close')}
          aria-label={t('actions.close')}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
};
