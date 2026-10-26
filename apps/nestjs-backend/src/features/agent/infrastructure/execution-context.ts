import { AGENT_ROBOT_USER, getPermissions, Role } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';

export interface IAgentRunScope {
  runId: string;
  /** The instance admin the agent is working for (kept for the audit log). */
  actorUserId: string;
}

/**
 * Runs agent work as the agent robot with owner permissions on every space, base and table
 * (PermissionService honours this only for the robot inside a run; design §9.2).
 *
 * The run gets a fresh CLS context: nothing from the calling request (its user, access token, share
 * or template state) leaks in. This is the only place `agentRun` is ever set.
 */
@Injectable()
export class AgentExecutionContext {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  run<T>(scope: IAgentRunScope, fn: () => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'override' }, () => {
      this.cls.set('user', { ...AGENT_ROBOT_USER, isAdmin: false });
      this.cls.set('agentRun', { runId: scope.runId, actorUserId: scope.actorUserId });
      // Services read permissions back from CLS (see mcp/tool-registry.ts); publish the same set.
      this.cls.set('permissions', getPermissions(Role.Owner));
      this.cls.set('origin', {
        ip: '127.0.0.1',
        byApi: true,
        userAgent: 'cybernetics-agent',
        referer: '',
      });
      return fn();
    });
  }

  /** The run the current code belongs to, if any. */
  current(): IAgentRunScope | undefined {
    return this.cls.isActive() ? this.cls.get('agentRun') : undefined;
  }
}
