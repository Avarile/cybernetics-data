import type { UIMessage } from 'ai';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { isToolPart } from '../../model/agent-request';
import { AgentToolStep } from './ToolStep';

export interface IAgentMessageViewProps {
  message: UIMessage;
  /** The reply is still streaming (reasoning stays open, approvals are disabled). */
  streaming?: boolean;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** A user or agent message: text as markdown, reasoning, tool steps and approval cards. */
export const AgentMessageView = ({ message, streaming, onRespond }: IAgentMessageViewProps) => (
  <Message from={message.role}>
    <MessageContent>
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        if (part.type === 'text') {
          return message.role === 'assistant' ? (
            <MessageResponse key={key}>{part.text}</MessageResponse>
          ) : (
            <div key={key} className="whitespace-pre-wrap">
              {part.text}
            </div>
          );
        }
        if (part.type === 'reasoning') {
          return (
            <Reasoning key={key} isStreaming={streaming && i === message.parts.length - 1}>
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          );
        }
        if (isToolPart(part)) {
          return <AgentToolStep key={key} part={part} busy={streaming} onRespond={onRespond} />;
        }
        return null;
      })}
    </MessageContent>
  </Message>
);
