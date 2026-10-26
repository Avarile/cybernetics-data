import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

const messageChars = 2_000;

/** thread_search / thread_read: the admin's own past conversations (design §8). */
@Injectable()
export class ThreadsToolkit implements IToolkit, OnModuleInit {
  readonly id = 'threads' as const;
  readonly title = 'Past conversations';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {
    this.tools = [this.search(), this.read()];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  private search() {
    return defineTool({
      name: 'thread_search',
      description: 'Find earlier conversations with this admin by words in their title or summary.',
      input: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, limit }, ctx) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const threads = await this.store.listThreads({ ownerId: ctx.actorUserId, take: 200 });
        const hits = threads
          .filter((t) => t.id !== ctx.threadId)
          .map((t) => {
            const text = `${t.title} ${t.summary ?? ''}`.toLowerCase();
            return { t, score: words.filter((w) => text.includes(w)).length };
          })
          .filter((h) => h.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? 10);
        return {
          threads: hits.map(({ t }) => ({
            id: t.id,
            title: t.title,
            summary: t.summary,
            lastMessageAt: t.lastMessageAt,
            messageCount: t.messageCount,
          })),
        };
      },
    });
  }

  private read() {
    return defineTool({
      name: 'thread_read',
      description: 'Read messages of an earlier conversation (1-based positions, at most 50).',
      input: z.object({
        id: z.string().startsWith('rec'),
        from: z.number().int().min(1).optional(),
        to: z.number().int().min(1).optional(),
      }),
      execute: async ({ id, from, to }, ctx) => {
        const thread = await this.store.getThread(id).catch(() => undefined);
        if (!thread || thread.ownerId !== ctx.actorUserId) {
          throw new CustomHttpException('Thread not found', HttpErrorCode.NOT_FOUND);
        }
        const all = (await this.store.listMessages(id)).filter(
          (m) => m.role === 'user' || m.role === 'assistant'
        );
        const start = Math.max(1, from ?? 1);
        const end = Math.min(all.length, to ?? start + 49, start + 49);
        return {
          title: thread.title,
          total: all.length,
          messages: all.slice(start - 1, end).map((m, i) => ({
            position: start + i,
            role: m.role,
            text: (m.content ?? '').slice(0, messageChars),
          })),
        };
      },
    });
  }
}
