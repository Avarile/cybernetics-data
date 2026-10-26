import { Inject, Injectable } from '@nestjs/common';
import type { Tool } from 'ai';
import { AiDataConfig, type IAiDataConfig } from '../../../configs/ai-data.config';
import { AUDIT_PORT, type IAuditPort } from '../domain/ports';
import { AgentExecutionContext } from '../infrastructure/execution-context';
import { wrapTool } from '../toolkits/tool-wrapper';
import { ToolkitRegistry } from '../toolkits/toolkit.registry';
import type { IToolContext, IToolkitId } from '../toolkits/toolkit.types';
import { TOOLKIT_IDS } from '../toolkits/toolkit.types';

export interface IAssembledTools {
  tools: Record<string, Tool>;
  toolkits: { id: IToolkitId; title: string }[];
  /** Turned on in the profile but not usable right now, with the reason (shown in status). */
  skipped: { id: string; reason: string }[];
}

/** The profile's toolkits as AI SDK tools, each wrapped (design §5.1 runtime/ToolAssembler). */
@Injectable()
export class ToolAssembler {
  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort,
    private readonly execution: AgentExecutionContext,
    @AiDataConfig() private readonly limits: IAiDataConfig
  ) {}

  assemble(ctx: IToolContext): IAssembledTools {
    const out: IAssembledTools = { tools: {}, toolkits: [], skipped: [] };
    const deps = {
      audit: this.audit,
      execution: this.execution,
      maxResultChars: this.limits.maxResponseChars,
    };
    for (const id of ctx.profile.toolkits) {
      if (!(TOOLKIT_IDS as readonly string[]).includes(id)) {
        out.skipped.push({ id, reason: 'unknown toolkit' });
        continue;
      }
      const toolkit = this.registry.get(id as IToolkitId);
      if (!toolkit) {
        out.skipped.push({ id, reason: 'not available in this version' });
        continue;
      }
      const reason = toolkit.unavailable?.(ctx.profile);
      if (reason) {
        out.skipped.push({ id, reason });
        continue;
      }
      out.toolkits.push({ id: toolkit.id, title: toolkit.title });
      for (const def of toolkit.tools) out.tools[def.name] = wrapTool(def, ctx, deps);
    }
    return out;
  }
}
