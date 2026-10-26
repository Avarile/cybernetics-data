import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentConfig, type IAgentConfig } from '../../../../configs/agent.config';
import { CustomHttpException } from '../../../../custom.exception';
import { KnowledgeIngest } from '../../application/knowledge/knowledge-ingest';
import { KnowledgeSearch, MAX_TOP_K } from '../../application/knowledge/knowledge-search';
import {
  RAG_STORE_PORT,
  type IRagCollection,
  type IRagDocument,
  type IRagSource,
  type IRagStorePort,
} from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import { defineTool } from '../toolkit.types';
import type { IToolkit } from '../toolkit.types';

/** Seeded collections (design §11.1); they cannot be deleted. */
const builtinCollections = ['knowledge', 'kb_records', 'agent_memory'];
/** rag_read returns at most this much text; ask for a range to read on. */
const maxReadChars = 20_000;
const maxIngestChars = 1_000_000;

const collectionView = (c: IRagCollection) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  kind: c.kind,
  isActive: c.isActive,
});

const documentView = (d: IRagDocument) => ({
  documentId: d.id,
  collection: d.collectionId,
  title: d.title,
  sourceRef: d.sourceRef,
  status: d.status,
  chunkCount: d.chunkCount,
  error: d.error,
});

const topK = z.number().int().min(1).max(MAX_TOP_K).optional();

const ingestInput = z
  .object({
    collection: z.string().min(1).describe('Collection id, e.g. knowledge'),
    text: z.string().min(1).max(maxIngestChars).optional().describe('Text or markdown to add'),
    url: z.string().url().optional().describe('A web page to fetch and add'),
    attachmentToken: z.string().min(1).optional().describe('A chat file or attachment token'),
    slug: z
      .string()
      .regex(/^[\w.-]{1,80}$/)
      .optional()
      .describe('Stable name for a text, so adding it again replaces it'),
    title: z.string().max(300).optional(),
  })
  .refine(
    (i) => [i.text, i.url, i.attachmentToken].filter(Boolean).length === 1,
    'give exactly one of text, url or attachmentToken'
  );

const sourceOf = (i: z.infer<typeof ingestInput>): IRagSource => {
  if (i.text) return { kind: 'text', text: i.text, slug: i.slug };
  if (i.url) return { kind: 'url', url: i.url };
  return { kind: 'attachment', token: i.attachmentToken! };
};

/**
 * Knowledge search and documents (design §8 knowledge, §11): hybrid search with snippets,
 * section reads, background ingest, and collections.
 */
@Injectable()
export class KnowledgeToolkit implements IToolkit, OnModuleInit {
  readonly id = 'knowledge' as const;
  readonly title = 'Knowledge';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    private readonly searcher: KnowledgeSearch,
    private readonly ingest: KnowledgeIngest,
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @AgentConfig() private readonly config: IAgentConfig
  ) {
    this.tools = [
      this.knowledgeSearch(),
      this.ragSearch(),
      this.ragRead(),
      this.ragIngest(),
      this.ingestStatus(),
      this.collectionList(),
      this.collectionCreate(),
      this.collectionDelete(),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  unavailable() {
    return this.config.ragDatabaseUrl
      ? undefined
      : 'No knowledge database is configured (AGENT_RAG_DATABASE_URL or VECTOR_DATABASE_URL)';
  }

  private knowledgeSearch() {
    return defineTool({
      name: 'knowledge_search',
      description:
        'Search knowledge records (every knowledge table, kept in sync) by meaning and exact words. ' +
        'Returns snippets with recordRef; read the full record with get_records.',
      input: z.object({
        query: z.string().min(1).max(1000).describe("The question, in the user's words"),
        baseIds: z.array(z.string()).max(50).optional(),
        tables: z.array(z.string()).max(50).optional().describe('Table ids to search in'),
        topK,
      }),
      untrusted: true,
      execute: (input, ctx) =>
        this.searcher.search({
          query: input.query,
          collections: ['kb_records'],
          baseIds: input.baseIds,
          tableIds: input.tables,
          topK: input.topK,
          rerankModel: ctx.profile.rerankModel,
          abortSignal: ctx.abortSignal,
        }),
    });
  }

  private ragSearch() {
    return defineTool({
      name: 'rag_search',
      description:
        'Search documents and memories by meaning and exact words. Default: every active collection. ' +
        'Returns snippets; call rag_read with a sectionId for the full text.',
      input: z.object({
        query: z.string().min(1).max(1000),
        collections: z.array(z.string()).max(50).optional(),
        topK,
      }),
      untrusted: true,
      execute: async (input, ctx) => {
        const collections =
          input.collections ??
          (await this.rag.listCollections()).filter((c) => c.isActive).map((c) => c.id);
        return this.searcher.search({
          query: input.query,
          collections,
          topK: input.topK,
          rerankModel: ctx.profile.rerankModel,
          abortSignal: ctx.abortSignal,
        });
      },
    });
  }

  private ragRead() {
    return defineTool({
      name: 'rag_read',
      description:
        'Read a section (sectionId from a search result) or a document, 10 sections at a time ' +
        '(from/to are 1-based section numbers; nextFrom says where to go on).',
      input: z
        .object({
          sectionId: z.number().int().positive().optional(),
          documentId: z.string().optional(),
          from: z.number().int().min(1).optional(),
          to: z.number().int().min(1).optional(),
        })
        .refine(
          (i) => Boolean(i.sectionId) !== Boolean(i.documentId),
          'give sectionId or documentId'
        ),
      untrusted: true,
      execute: async (input) => {
        if (input.sectionId) {
          const section = await this.rag.readSection(input.sectionId);
          if (!section) throw notFound(`No section ${input.sectionId}`);
          return section;
        }
        const doc = await this.rag.readDocument(input.documentId!, {
          from: input.from,
          to: input.to,
        });
        if (!doc) throw notFound(`No document ${input.documentId}`);
        return capSections(doc, input.from ?? 1);
      },
    });
  }

  private ragIngest() {
    return defineTool({
      name: 'rag_ingest',
      description:
        'Add a document to a collection: text, a web page or a file. Waits about 10 seconds; if it ' +
        'is still queued, check it later with rag_ingest_status.',
      input: ingestInput,
      approval: { category: 'knowledge_write' },
      execute: (input, ctx) =>
        this.ingest.request({
          collectionId: input.collection,
          source: sourceOf(input),
          title: input.title ?? null,
          actorUserId: ctx.actorUserId,
        }),
    });
  }

  private ingestStatus() {
    return defineTool({
      name: 'rag_ingest_status',
      description: 'Where an ingest is: queued, processing, ready or failed (with the error).',
      input: z.object({ documentId: z.string().min(1) }),
      execute: async ({ documentId }) => {
        const doc = await this.ingest.status(documentId);
        if (!doc) throw notFound(`No document ${documentId}`);
        return documentView(doc);
      },
    });
  }

  private collectionList() {
    return defineTool({
      name: 'collection_list',
      description: 'The knowledge collections: documents (added by hand) and derived (synced).',
      input: z.object({}),
      execute: async () => ({
        collections: (await this.rag.listCollections()).map(collectionView),
      }),
    });
  }

  private collectionCreate() {
    return defineTool({
      name: 'collection_create',
      description: 'Create a document collection, e.g. for one project or topic.',
      input: z.object({
        id: z
          .string()
          .regex(/^[a-z][a-z0-9_]{1,40}$/, 'lowercase letters, digits and _')
          .describe('Short slug, e.g. work'),
        label: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      }),
      approval: { category: 'knowledge_write' },
      execute: async (input) => {
        if ((await this.rag.listCollections()).some((c) => c.id === input.id)) {
          throw new CustomHttpException(
            `Collection ${input.id} exists`,
            HttpErrorCode.VALIDATION_ERROR
          );
        }
        return collectionView(
          await this.rag.createCollection({
            id: input.id,
            label: input.label,
            description: input.description ?? null,
            kind: 'documents',
          })
        );
      },
    });
  }

  private collectionDelete() {
    return defineTool({
      name: 'collection_delete',
      description: 'Delete a document collection with all its documents. Cannot be undone.',
      input: z.object({ id: z.string().min(1) }),
      approval: { category: 'knowledge_write', always: true },
      execute: async ({ id }) => {
        if (builtinCollections.includes(id)) {
          throw new CustomHttpException(
            `${id} is built in and cannot be deleted`,
            HttpErrorCode.VALIDATION_ERROR
          );
        }
        if (!(await this.rag.listCollections()).some((c) => c.id === id)) {
          throw notFound(`No collection ${id}`);
        }
        await this.rag.deleteCollection(id);
        return { deleted: id };
      },
    });
  }
}

const notFound = (message: string) => new CustomHttpException(message, HttpErrorCode.NOT_FOUND);

/** Whole sections up to maxReadChars (at least one); nextFrom points at the first one left out. */
function capSections<T extends { sections: { content: string }[]; total: number }>(
  doc: T,
  from: number
) {
  let size = 0;
  let kept = 0;
  for (const section of doc.sections) {
    size += section.content.length;
    if (kept > 0 && size > maxReadChars) break;
    kept++;
  }
  const next = from + kept;
  return {
    ...doc,
    sections: doc.sections.slice(0, kept),
    nextFrom: next <= doc.total ? next : null,
  };
}
