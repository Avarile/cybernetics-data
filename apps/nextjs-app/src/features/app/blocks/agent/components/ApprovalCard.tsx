import { Button } from '@teable/ui-lib/shadcn';
import { ShieldQuestion } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export interface IApprovalCardProps {
  approvalId: string;
  toolName: string;
  input: unknown;
  /** Nothing can be answered while a reply is streaming. */
  disabled?: boolean;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** A tool call that waits for the admin (design §9.3): the arguments, Approve and Deny. */
export const ApprovalCard = ({
  approvalId,
  toolName,
  input,
  disabled,
  onRespond,
}: IApprovalCardProps) => {
  const { t } = useTranslation('common');
  const [answered, setAnswered] = useState<boolean | null>(null);
  const answer = (approved: boolean) => {
    setAnswered(approved);
    onRespond(approvalId, approved);
  };
  return (
    <div
      role="group"
      aria-label={t('agent.approval.label', 'Approval needed')}
      className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <ShieldQuestion className="size-4 shrink-0 text-amber-600" />
        <span>{t('agent.approval.title', 'The agent wants to run')}</span>
        <code className="rounded bg-muted px-1 text-xs">{toolName}</code>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 text-xs">
        {JSON.stringify(input, null, 2)}
      </pre>
      <div className="flex gap-2">
        <Button size="xs" disabled={disabled || answered !== null} onClick={() => answer(true)}>
          {t('agent.approval.approve', 'Approve')}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || answered !== null}
          onClick={() => answer(false)}
        >
          {t('agent.approval.deny', 'Deny')}
        </Button>
      </div>
    </div>
  );
};
