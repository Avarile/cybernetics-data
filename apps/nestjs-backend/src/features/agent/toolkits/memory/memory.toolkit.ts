import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import type { IMemory, IMemoryScope } from '../../domain/entities';
import { inScope, isLive, rankMemories } from '../../domain/policies/memory-ranking';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolContext, IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

const kinds = ['fact', 'preference', 'instruction', 'entity', 'episode'] as const;
const scopes = ['global', 'user', 'base', 'thread'] as const;
const sources = ['user_said', 'agent_inferred'] as const;

const view = (m: IMemory) => ({
  id: m.id,
  title: m.title,
  content: m.content,
  kind: m.kind,
  scope: m.scope,
  pinned: m.pinned,
  importance: m.importance,
  tags: m.tags,
});

/** Where a scoped memory points: the admin, the focused base, or this thread. */
export function scopeRefFor(scope: IMemoryScope, ctx: IToolContext): string | null {
  switch (scope) {
    case 'user':
      return ctx.actorUserId;
    case 'base':
      if (!ctx.focus?.baseId) {
        throw new CustomHttpException(
          'A base memory needs the chat to be opened from a base',
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      return ctx.focus.baseId;
    case 'thread':
      return ctx.threadId ?? null;
    default:
      return null;
  }
}

/** memory_search / save / update / forget over agent_memory (design §8). */
@Injectable()
export class MemoryToolkit implements IToolkit, OnModuleInit {
  readonly id = 'memory' as const;
  readonly title = 'Memory';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {
    this.tools = [this.search(), this.save(), this.update(), this.forget()];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  unavailable(profile: { memoryMode: string | null }) {
    return profile.memoryMode === 'off' ? 'memory is off in the agent setup' : undefined;
  }

  private search() {
    return defineTool({
      name: 'memory_search',
      description:
        'Search what you remember (facts, preferences, instructions). Use before asking the admin something they may have told you already.',
      input: z.object({
        query: z.string().min(1).describe('words to look for'),
        scope: z.enum(scopes).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ query, scope, limit }, ctx) => {
        const now = new Date();
        const pool = (await this.store.listMemories({ take: 500 })).filter(
          (m) =>
            isLive(m, now) &&
            inScope(m, {
              userId: ctx.actorUserId,
              baseId: ctx.focus?.baseId,
              threadId: ctx.threadId,
            }) &&
            (!scope || (m.scope ?? 'global') === scope)
        );
        // pinned memories are searchable here too
        const ranked = rankMemories(
          pool.map((m) => ({ ...m, pinned: false })),
          query,
          { now, limit: limit ?? 10 }
        );
        const byId = new Map(pool.map((m) => [m.id, m]));
        return { memories: ranked.map((m) => view(byId.get(m.id)!)) };
      },
    });
  }

  private save() {
    return defineTool({
      name: 'memory_save',
      description:
        'Remember something for later conversations. One fact per memory; a short title says what it is about. Saving a title you already have updates that memory.',
      input: z.object({
        title: z.string().min(1).max(200),
        content: z.string().max(5000).optional(),
        kind: z.enum(kinds).default('fact'),
        scope: z.enum(scopes).default('global'),
        pinned: z.boolean().optional().describe('always shown to you; only for important rules'),
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string().max(50)).max(10).optional(),
        source: z.enum(sources).default('user_said'),
      }),
      execute: async (input, ctx) => {
        const scopeRef = scopeRefFor(input.scope, ctx);
        const existing = (await this.store.listMemories({ take: 500 })).find(
          (m) =>
            m.title.trim().toLowerCase() === input.title.trim().toLowerCase() &&
            (m.scope ?? 'global') === input.scope &&
            (m.scopeRef ?? null) === scopeRef
        );
        const fields = {
          title: input.title.trim(),
          content: input.content ?? null,
          kind: input.kind,
          scope: input.scope,
          scopeRef,
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          ...(input.importance ? { importance: input.importance } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        };
        if (existing) {
          const updated = await this.store.updateMemory(existing.id, fields);
          return { saved: 'updated', memory: view(updated) };
        }
        const created = await this.store.createMemory({
          ...fields,
          source: input.source,
          sourceThreadId: ctx.threadId ?? null,
          importance: input.importance ?? 3,
        });
        return { saved: 'created', memory: view(created) };
      },
    });
  }

  private update() {
    return defineTool({
      name: 'memory_update',
      description: 'Correct or extend a memory you found with memory_search.',
      input: z.object({
        id: z.string().startsWith('rec'),
        title: z.string().min(1).max(200).optional(),
        content: z.string().max(5000).optional(),
        kind: z.enum(kinds).optional(),
        pinned: z.boolean().optional(),
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string().max(50)).max(10).optional(),
      }),
      execute: async ({ id, ...patch }) => {
        await this.store.getMemory(id);
        return { memory: view(await this.store.updateMemory(id, patch)) };
      },
    });
  }

  private forget() {
    return defineTool({
      name: 'memory_forget',
      description: 'Forget a memory (it is switched off, not deleted; an admin can bring it back).',
      input: z.object({ id: z.string().startsWith('rec') }),
      execute: async ({ id }) => {
        await this.store.updateMemory(id, { isActive: false });
        return { forgotten: id };
      },
    });
  }
}
