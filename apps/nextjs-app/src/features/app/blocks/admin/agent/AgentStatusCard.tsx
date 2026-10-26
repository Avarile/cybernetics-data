import type { IAgentStatusVo } from '@teable/openapi';
import { disableAgent, enableAgent, resetAgent, restoreAgent, verifyAgent } from '@teable/openapi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { availableActions, type IAgentAction } from './agent-admin.helpers';

const run: Record<IAgentAction, () => Promise<IAgentStatusVo>> = {
  enable: enableAgent,
  disable: disableAgent,
  verify: verifyAgent,
  restore: restoreAgent,
  reset: () => resetAgent({ confirm: true }),
};

/** Status, health, warnings and the lifecycle buttons (design §7.1, §13). */
export const AgentStatusCard = ({
  status,
  onChanged,
}: {
  status?: IAgentStatusVo;
  onChanged: (status: IAgentStatusVo) => void;
}) => {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState<IAgentAction | null>(null);
  const [confirm, setConfirm] = useState<'enable' | 'reset' | null>(null);

  const labels: Record<IAgentAction, string> = {
    enable: t('agent.admin.enable', 'Enable'),
    disable: t('agent.admin.disable', 'Disable'),
    verify: t('agent.admin.verify', 'Check now'),
    restore: t('agent.admin.restore', 'Restore from trash'),
    reset: t('agent.admin.reset', 'Reset'),
  };
  const act = async (action: IAgentAction) => {
    setBusy(action);
    try {
      onChanged(await run[action]());
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const health = status?.health as
    | {
        admins?: number;
        revoked?: Record<string, number>;
        repaired?: { tables: string[]; fields: string[] };
      }
    | null
    | undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('agent.admin.status', 'Status')}</CardTitle>
        {status && (
          <Badge
            variant={status.status === 'ok' ? 'default' : 'secondary'}
            data-testid="agent-status"
          >
            {status.enabled ? status.status : t('agent.admin.off', 'off')}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status?.enabled && (
          <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
            <span>
              {t('agent.admin.lastCheck', 'Last check')}:{' '}
              {status.lastVerifiedTime ? new Date(status.lastVerifiedTime).toLocaleString() : '—'}
            </span>
            <span>
              {t('agent.admin.members', 'Admins with access')}: {health?.admins ?? '—'}
            </span>
          </div>
        )}
        {status?.warnings.map((w) => (
          <div
            key={`${w.code}-${w.message}`}
            className="flex items-start gap-2 text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{w.message}</span>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          {availableActions(status).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={
                action === 'enable' ? 'default' : action === 'reset' ? 'destructive' : 'outline'
              }
              disabled={busy !== null}
              onClick={() =>
                action === 'enable' || action === 'reset' ? setConfirm(action) : void act(action)
              }
            >
              {busy === action ? '…' : labels[action]}
            </Button>
          ))}
          {status?.baseId && status.status === 'ok' && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/base/${status.baseId}`}>
                <ExternalLink className="mr-1 size-4" />
                {t('agent.admin.openBase', 'Open Agent base')}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? labels[confirm] : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'enable'
                ? t(
                    'agent.admin.enableHelp',
                    'This creates an Agent space and base. Every instance admin becomes an owner of it and can read every conversation, memory and skill there.'
                  )
                : t(
                    'agent.admin.resetHelp',
                    'This starts over with a new, empty Agent base. The old base stays in the Agent space with all its data.'
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action) void act(action);
              }}
            >
              {confirm ? labels[confirm] : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
