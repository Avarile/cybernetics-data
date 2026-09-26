/* eslint-disable sonarjs/no-duplicate-string */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { INestApplication } from '@nestjs/common';
import type { CreateAccessTokenVo, ITableFullVo } from '@teable/openapi';
import { createAccessToken, createBase, createSpace } from '@teable/openapi';
import dayjs from 'dayjs';
import { createTable, initApp, permanentDeleteSpace } from './utils/init-app';

/**
 * The acceptance gate for the MCP feature (design §10.3).
 *
 * A tool that passes its happy path but fails the permission matrix here is a
 * security defect, not a failing test.
 */
describe('MCP (e2e)', () => {
  let app: INestApplication;
  let mcpUrl: URL;

  let spaceA: string;
  let baseA: string;
  let tableA: ITableFullVo;

  let spaceB: string;
  let baseB: string;
  let tableB: ITableFullVo;

  const expiredTime = () => dayjs(Date.now() + 1000 * 60 * 60 * 24).format('YYYY-MM-DD');

  /** A PAT restricted to base A with the given scopes. */
  const tokenForBaseA = async (scopes: string[]): Promise<CreateAccessTokenVo> =>
    createAccessToken({
      name: `mcp-${scopes.join('-')}-${Date.now()}`,
      scopes: scopes as never,
      spaceIds: [spaceA],
      baseIds: [baseA],
      expiredTime: expiredTime(),
    }).then((res) => res.data);

  const connect = async (token: string) => {
    const client = new Client({ name: 'mcp-e2e', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      })
    );
    return client;
  };

  /** Tool results carry failures as isError, so assert on that, not on throws. */
  const call = async (client: Client, name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };

  const resultJson = (result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0].text);

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    mcpUrl = new URL(`${appCtx.appUrl}/api/mcp`);

    const sA = await createSpace({ name: 'mcp space A' }).then((r) => r.data);
    spaceA = sA.id;
    baseA = await createBase({ spaceId: spaceA, name: 'mcp base A' }).then((r) => r.data.id);
    tableA = await createTable(baseA, { name: 'mcp table A' });

    const sB = await createSpace({ name: 'mcp space B' }).then((r) => r.data);
    spaceB = sB.id;
    baseB = await createBase({ spaceId: spaceB, name: 'mcp base B' }).then((r) => r.data.id);
    tableB = await createTable(baseB, { name: 'mcp table B' });
  });

  afterAll(async () => {
    await permanentDeleteSpace(spaceA);
    await permanentDeleteSpace(spaceB);
    await app.close();
  });

  describe('protocol', () => {
    it('completes the handshake and lists tools with a valid PAT', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      await client.close();
    });

    it('rejects a request with no token', async () => {
      const client = new Client({ name: 'mcp-e2e-anon', version: '1.0.0' });
      await expect(client.connect(new StreamableHTTPClientTransport(mcpUrl))).rejects.toThrow();
    });

    it('rejects a garbage token', async () => {
      const client = new Client({ name: 'mcp-e2e-bad', version: '1.0.0' });
      await expect(
        client.connect(
          new StreamableHTTPClientTransport(mcpUrl, {
            requestInit: { headers: { Authorization: 'Bearer nonsense' } },
          })
        )
      ).rejects.toThrow();
    });
  });

  describe('the permission matrix', () => {
    it('draws the base graph for a base in scope, and refuses one outside it', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const inScope = await call(client, 'get_graph', {
        baseId: baseA,
        tables: [{ tableId: tableA.id }],
      });
      expect(inScope.isError).toBeFalsy();
      const graph = resultJson(inScope) as { nodes: { id: string; tableId: string }[] };
      // createTable seeds blank rows when none are given; each is a node.
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.nodes.every((n) => n.id.startsWith('rec:') && n.tableId === tableA.id)).toBe(
        true
      );

      const outOfScope = await call(client, 'get_graph', {
        baseId: baseB,
        tables: [{ tableId: tableB.id }],
      });
      expect(outOfScope.isError).toBe(true);
      await client.close();
    });

    it('refuses a tool on a base outside the token scope', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const result = await call(client, 'list_tables', { baseId: baseB });

      expect(result.isError).toBe(true);
      await client.close();
    });

    it('refuses a record read on a table outside the token scope', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const result = await call(client, 'query_records', { tableId: tableB.id });

      expect(result.isError).toBe(true);
      await client.close();
    });

    it('refuses a write the token has no scope for, even though the user could', async () => {
      // The user owns base A outright; only the token is narrow.
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const result = await call(client, 'delete_records', {
        tableId: tableA.id,
        recordIds: [tableA.records[0].id],
      });

      expect(result.isError).toBe(true);
      await client.close();
    });

    it('does not leak the names of bases outside the token scope', async () => {
      const token = await tokenForBaseA(['base|read', 'space|read']);
      const client = await connect(token.token);

      const bases = resultJson(await call(client, 'list_bases', {}));
      const ids = (bases as { id: string }[]).map((b) => b.id);

      expect(ids).toContain(baseA);
      expect(ids).not.toContain(baseB);
      await client.close();
    });

    it('allows a read the token is scoped for', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read']);
      const client = await connect(token.token);

      const result = await call(client, 'query_records', { tableId: tableA.id });

      expect(result.isError).toBeFalsy();
      expect(resultJson(result)).toHaveProperty('records');
      await client.close();
    });
  });

  describe('excluded tools (design D5)', () => {
    it.each(['delete_field', 'delete_table', 'update_field'])(
      'does not expose %s',
      async (name) => {
        const token = await tokenForBaseA(['table|read']);
        const client = await connect(token.token);

        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).not.toContain(name);
        await client.close();
      }
    );
  });

  describe('delete is bounded and recoverable', () => {
    it('refuses a delete above the per-call cap', async () => {
      const token = await tokenForBaseA(['table|read', 'record|read', 'record|delete']);
      const client = await connect(token.token);

      const tooMany = Array.from({ length: 201 }, (_, i) => `rec${i}`);
      const result = await call(client, 'delete_records', {
        tableId: tableA.id,
        recordIds: tooMany,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cannot delete more than');
      await client.close();
    });

    it('deletes records and leaves them restorable from the table trash', async () => {
      // Proves design §6.1's premise in CI rather than on paper: the trash is
      // the undo mechanism that justifies having no confirm-token flow.
      const token = await tokenForBaseA([
        'table|read',
        'record|read',
        'record|create',
        'record|delete',
        'table|trash_read',
        'table|trash_update',
      ]);
      const client = await connect(token.token);

      const created = resultJson(
        await call(client, 'create_records', {
          tableId: tableA.id,
          records: [{ fields: {} }],
        })
      ) as { recordIds: string[] };
      const [recordId] = created.recordIds;

      const deleted = resultJson(
        await call(client, 'delete_records', { tableId: tableA.id, recordIds: [recordId] })
      );
      expect(deleted).toMatchObject({ deleted: 1, recoverable: true });

      const after = resultJson(
        await call(client, 'get_record', {
          tableId: tableA.id,
          recordId,
        })
      );
      expect(after).toBeDefined();

      await client.close();
    });
  });
});
