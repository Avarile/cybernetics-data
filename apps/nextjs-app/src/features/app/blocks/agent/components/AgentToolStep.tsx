import type { ToolUIPart } from 'ai';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { IAgentToolPart } from '../agent-request';
import { toolNameOf } from '../agent-request';
import { ApprovalCard } from './ApprovalCard';

export interface IAgentToolStepProps {
  part: IAgentToolPart;
  busy?: boolean;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** One tool call as a collapsible step; a call waiting for approval shows the approval card. */
export const AgentToolStep = ({ part, busy, onRespond }: IAgentToolStepProps) => {
  const name = toolNameOf(part);
  const waiting = part.state === 'approval-requested' && part.approval?.id;
  return (
    <div className="space-y-2" data-testid={`agent-tool-${name}`}>
      <Tool defaultOpen={part.state === 'output-error'}>
        <ToolHeader
          type={`tool-${name}` as ToolUIPart['type']}
          state={part.state as ToolUIPart['state']}
          title={name}
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput
            output={part.state === 'output-denied' ? undefined : (part.output as never)}
            errorText={part.errorText}
          />
        </ToolContent>
      </Tool>
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
