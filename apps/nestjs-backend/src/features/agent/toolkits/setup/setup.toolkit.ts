import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import type { IAgentProfile } from '../../domain/entities';
import { APPROVAL_CATEGORIES } from '../../domain/policies/approval-policy';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool, TOOLKIT_IDS } from '../toolkit.types';

/** `providerId/model`, as the model slots store them (design §7.2). */
const modelRef = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\/\S+$/, 'use providerId/model, e.g. openai/gpt-4.1')
  .nullable();

const profileView = (p: IAgentProfile) => ({
  name: p.name,
  persona: p.persona,
  model: p.model,
  smallModel: p.smallModel,
  knowledgeTables: p.knowledgeTables,
  temperature: p.temperature,
  maxSteps: p.maxSteps,
  maxOutputTokens: p.maxOutputTokens,
  contextBudgetTokens: p.contextBudgetTokens,
  toolkits: p.toolkits,
  approvalRequired: p.approvalRequired,
  memoryMode: p.memoryMode,
});

/** setup_get / setup_update over the active agent_setup row (design §8). */
@Injectable()
export class SetupToolkit implements IToolkit, OnModuleInit {
  readonly id = 'setup' as const;
  readonly title = 'Agent setup';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {
    this.tools = [this.get(), this.update()];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  private async profile() {
    const profile = await this.store.getDefaultProfile();
    if (!profile) throw new CustomHttpException('No active agent setup', HttpErrorCode.NOT_FOUND);
    return profile;
  }

  private get() {
    return defineTool({
      name: 'setup_get',
      description: 'Read your own setup: persona, models, toolkits, approvals, memory mode.',
      input: z.object({}),
      execute: async () => profileView(await this.profile()),
    });
  }

  private update() {
    return defineTool({
      name: 'setup_update',
      description:
        'Change your own setup (the admin approves every change). Only send what changes.',
      input: z
        .object({
          persona: z.string().max(20_000).optional(),
          model: modelRef.optional(),
          smallModel: modelRef.optional(),
          knowledgeTables: z
            .array(z.string().regex(/^tbl\w+$/, 'a table id'))
            .max(200)
            .optional()
            .describe('Tables synced into knowledge search; [] detects them automatically'),
          temperature: z.number().min(0).max(2).nullable().optional(),
          maxSteps: z.number().int().min(1).max(100).optional(),
          maxOutputTokens: z.number().int().min(256).max(128_000).optional(),
          contextBudgetTokens: z.number().int().min(2_000).max(2_000_000).nullable().optional(),
          toolkits: z.array(z.enum(TOOLKIT_IDS)).optional(),
          approvalRequired: z.array(z.enum(APPROVAL_CATEGORIES)).optional(),
          memoryMode: z.enum(['off', 'explicit', 'auto']).optional(),
        })
        .refine((patch) => Object.keys(patch).length > 0, 'nothing to change'),
      approval: { category: 'setup_change' },
      execute: async (patch) => {
        const profile = await this.profile();
        return profileView(await this.store.updateProfile(profile.id, patch));
      },
    });
  }
}
