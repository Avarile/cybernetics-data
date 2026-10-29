import { useSession } from '@cybernetics/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Bot } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { IAgentFocus } from '../state/cockpit-store';
import { useCockpitStore } from '../state/cockpit-store';

/** The cockpit's on/off button, for headers and sidebars; admins only (cockpit design §4.2). */
export const AgentToggle = ({ focus, className }: { focus?: IAgentFocus; className?: string }) => {
  const { t } = useTranslation('common');
  const isAdmin = Boolean(useSession().user?.isAdmin);
  const on = useCockpitStore((s) => s.on);
  const toggle = useCockpitStore((s) => s.toggle);
  if (!isAdmin) return null;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={t('agent.cockpit.toggle', 'Agent cockpit (Ctrl/⌘ J)')}
      aria-pressed={on}
      className={cn(on && 'bg-accent text-accent-foreground', className)}
      onClick={() => toggle(focus ? { focus } : undefined)}
    >
      <Bot className="size-4" />
    </Button>
  );
};
