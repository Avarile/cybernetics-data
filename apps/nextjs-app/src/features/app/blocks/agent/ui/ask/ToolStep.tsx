import { useTranslation } from 'next-i18next';
import type { IAgentToolPart } from '../../model/agent-request';
import { toolNameOf } from '../../model/agent-request';
import s from '../theme/cockpit.module.css';
import { ApprovalCard } from './ApprovalCard';

export interface IAgentToolStepProps {
  part: IAgentToolPart;
  busy?: boolean;
  onRespond: (approvalId: string, approved: boolean) => void;
}

const verb = (name: string) =>
  /delete|remove/.test(name)
    ? 'DELETE'
    : /create|update|write|set|add|save|ingest/.test(name)
      ? 'WRITE'
      : /http/.test(name)
        ? 'FETCH'
        : 'READ';

const stateText: Record<string, string> = {
  'input-streaming': '…',
  'input-available': '…',
  'output-available': '✓',
  'output-error': '✕',
  'output-denied': 'DENIED',
  'approval-requested': 'WAITING',
  'approval-responded': '…',
};

/**
 * A tool call that is not part of a search plan, as one line of the run (cockpit design §5.5);
 * the call and its result open on click. A call waiting for approval shows the approval card.
 */
export const AgentToolStep = ({ part, busy, onRespond }: IAgentToolStepProps) => {
  const { t } = useTranslation('common');
  const name = toolNameOf(part);
  const waiting = part.state === 'approval-requested' && part.approval?.id;
  return (
    <div data-testid={`agent-tool-${name}`} className={s.toolRow}>
      <details open={part.state === 'output-error'}>
        <summary>
          <b>{verb(name)}</b> {name} {stateText[part.state] ?? ''}
        </summary>
        <pre>{JSON.stringify(part.input ?? {}, null, 2)}</pre>
        {part.state === 'output-error' && <pre>{part.errorText}</pre>}
        {part.state === 'output-available' && (
          <pre>{JSON.stringify(part.output, null, 2)?.slice(0, 4000)}</pre>
        )}
        {part.state === 'output-denied' && <pre>{t('agent.approval.denied', 'Denied.')}</pre>}
      </details>
      {waiting && (
        <ApprovalCard
          approvalId={part.approval!.id}
          toolName={name}
          input={part.input}
          disabled={busy}
          onRespond={onRespond}
        />
      )}
    </div>
  );
};
