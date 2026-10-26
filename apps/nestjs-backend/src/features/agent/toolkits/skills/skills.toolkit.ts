import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool, TOOLKIT_IDS } from '../toolkit.types';

/** kebab-case, 64 characters at most; also the `/name` command (design §7.2). */
export const skillNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use kebab-case, e.g. weekly-report')
  .max(64);
const bodySchema = z.string().min(1).max(100_000);
const invocations = ['auto', 'manual', 'always'] as const;

const notFound = (name: string) =>
  new CustomHttpException(`No skill named ${name}`, HttpErrorCode.NOT_FOUND);

/** skill_list / load / create / update (design §8, progressive disclosure §10.1). */
@Injectable()
export class SkillsToolkit implements IToolkit, OnModuleInit {
  readonly id = 'skills' as const;
  readonly title = 'Skills';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {
    this.tools = [this.list(), this.load(), this.create(), this.update()];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  private list() {
    return defineTool({
      name: 'skill_list',
      description: 'List your skills with what each is for.',
      input: z.object({ includeInactive: z.boolean().optional() }),
      execute: async ({ includeInactive }) => {
        const skills = await this.store.listSkills({ activeOnly: !includeInactive });
        return {
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            invocation: s.invocation,
            isActive: s.isActive,
          })),
        };
      },
    });
  }

  private load() {
    return defineTool({
      name: 'skill_load',
      description: 'Read the full instructions of a skill before you follow it.',
      input: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        const skill = await this.store.getSkillByName(name);
        if (!skill || !skill.isActive) throw notFound(name);
        const credentials = (await this.store.listCredentials())
          .filter((c) => skill.credentialIds.includes(c.id))
          .map((c) => c.name);
        return {
          name: skill.name,
          version: skill.version,
          toolkits: skill.toolkits,
          credentials,
          body: skill.body,
        };
      },
    });
  }

  private create() {
    return defineTool({
      name: 'skill_create',
      description:
        'Save a reusable procedure as a new skill. The description says when to use it; the body says how.',
      input: z.object({
        name: skillNameSchema,
        description: z.string().min(1).max(1000),
        body: bodySchema,
        invocation: z.enum(invocations).optional(),
        toolkits: z.array(z.enum(TOOLKIT_IDS)).optional(),
        category: z.string().max(50).optional(),
      }),
      approval: { category: 'skill_change' },
      execute: async (input) => {
        if (await this.store.getSkillByName(input.name)) {
          throw new CustomHttpException(
            `A skill named ${input.name} exists; use skill_update`,
            HttpErrorCode.CONFLICT
          );
        }
        const skill = await this.store.createSkill({ ...input, source: 'agent', version: 1 });
        return { created: skill.name, version: skill.version };
      },
    });
  }

  private update() {
    return defineTool({
      name: 'skill_update',
      description: 'Change a skill. Changing the body bumps its version.',
      input: z.object({
        name: z.string().min(1),
        description: z.string().min(1).max(1000).optional(),
        body: bodySchema.optional(),
        invocation: z.enum(invocations).optional(),
        toolkits: z.array(z.enum(TOOLKIT_IDS)).optional(),
        isActive: z.boolean().optional(),
      }),
      approval: { category: 'skill_change' },
      execute: async ({ name, ...patch }) => {
        const skill = await this.store.getSkillByName(name);
        if (!skill) throw notFound(name);
        const bodyChanged = patch.body !== undefined && patch.body !== skill.body;
        const updated = await this.store.updateSkill(skill.id, {
          ...patch,
          ...(bodyChanged ? { version: (skill.version ?? 1) + 1 } : {}),
        });
        return { updated: updated.name, version: updated.version };
      },
    });
  }
}
