import { describe, expect, it, vi } from 'vitest';

const ingestDocument = vi.fn(async () => ({
  materialId: 'm1',
  chunksIngested: 1,
  indexName: 'kb',
}));
const createIndex = vi.fn();
const deleteIndex = vi.fn();

vi.mock('../src/mastra/rag/ingest', () => ({ ingestDocument }));
vi.mock('../src/mastra/db/db-vector.js', () => ({
  listIndexes: vi.fn(async () => []),
  getIndex: vi.fn(),
  createIndex,
  updateIndex: vi.fn(),
  deleteIndex,
  restoreIndex: vi.fn(),
}));

const { ingestDocumentTool, synthesizeAndIngestTool } = await import(
  '../src/mastra/tools/rag-query/ingest-tools.js'
);
const { createIndexTool, deleteIndexTool } = await import(
  '../src/mastra/tools/rag-query/index-tools.js'
);

const contextWith = (values: Record<string, unknown>) =>
  ({ requestContext: { get: (key: string) => values[key] } }) as never;

describe('RAG write tools are gated on the user write permission', () => {
  it.each([
    ['ingest-document', () => ingestDocumentTool, { indexName: 'kb', content: 'x', docName: 'd' }],
    [
      'synthesize-and-ingest',
      () => synthesizeAndIngestTool,
      { content: 'x', indexName: 'kb', docName: 'd', title: 't', typeName: 'Note' },
    ],
    ['create-index', () => createIndexTool, { name: 'kb2', label: 'KB 2' }],
    ['delete-index', () => deleteIndexTool, { name: 'kb' }],
  ])('%s refuses a read-only user and changes nothing', async (name, getTool, input) => {
    for (const ctx of [contextWith({ canWrite: false }), contextWith({}), undefined]) {
      const result = (await getTool().execute!(input as never, ctx as never)) as Record<
        string,
        unknown
      >;
      expect(result.success).toBe(false);
      expect(String(result.error ?? result.message)).toContain(`Permission denied: ${name}`);
    }
    expect(ingestDocument).not.toHaveBeenCalled();
    expect(createIndex).not.toHaveBeenCalled();
    expect(deleteIndex).not.toHaveBeenCalled();
  });

  it('lets a writer through', async () => {
    const result = (await ingestDocumentTool.execute!(
      { indexName: 'kb', content: 'x', docName: 'd' } as never,
      contextWith({ canWrite: true })
    )) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(ingestDocument).toHaveBeenCalledTimes(1);
  });
});

describe('synthesize-and-ingest', () => {
  it('only indexes: title and type go into chunk metadata, no knowledge record is created', async () => {
    ingestDocument.mockClear();
    const result = (await synthesizeAndIngestTool.execute!(
      {
        content: 'body',
        indexName: 'kb',
        docName: 'doc',
        title: 'Negotiation principles',
        typeName: 'Note',
        metadata: { source: 'generated' },
      } as never,
      contextWith({ canWrite: true })
    )) as Record<string, unknown>;

    expect(result).toEqual({ success: true, materialId: 'm1', chunksIngested: 1 });
    expect(ingestDocument).toHaveBeenCalledWith({
      indexName: 'kb',
      content: 'body',
      docName: 'doc',
      metadata: { source: 'generated', title: 'Negotiation principles', knowledgeType: 'Note' },
    });
  });
});
