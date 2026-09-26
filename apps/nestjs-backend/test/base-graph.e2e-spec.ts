/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { IBaseGraphQueryRo, IBaseGraphVo, ITableFullVo } from '@teable/openapi';
import {
  axios,
  expandBaseGraph,
  getBaseGraphNode,
  getBaseGraphSchema,
  QUERY_BASE_GRAPH,
  queryBaseGraph,
  updateField,
  urlBuilder,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  createView,
  deleteRecord,
  initApp,
  permanentDeleteBase,
  permanentDeleteTable,
  updateRecordByApi,
  updateViewFilter,
} from './utils/init-app';

const NAME = [{ name: 'name', type: FieldType.SingleLineText }];

describe('BaseGraph (e2e)', () => {
  const baseId = globalThis.testConfig.baseId;

  let goals: ITableFullVo;
  let projects: ITableFullVo;
  let tasks: ITableFullVo;
  let tags: ITableFullVo;
  const f = {
    projectGoal: '',
    goalProjects: '',
    taskProject: '',
    projectTasks: '',
    taskParent: '',
    tagTasks: '',
    taskTags: '',
    taskName: '',
  };
  const r: Record<string, string> = {};

  const ids = (graph: IBaseGraphVo) => graph.nodes.map((n) => n.id).sort();
  const pair = (a: string, b: string) => [`rec:${a}`, `rec:${b}`].sort().join('~');
  const pairsOf = (graph: IBaseGraphVo, kind = 'link') =>
    graph.links
      .filter((l) => l.kind === kind)
      .map((l) => [l.source, l.target].sort().join('~'))
      .sort();

  const query = async (ro: IBaseGraphQueryRo) => (await queryBaseGraph(baseId, ro)).data;

  beforeAll(async () => {
    // initApp is memoised on globalThis; the specs talk to it through axios.
    await initApp();

    // `records: []`: createTable otherwise seeds blank rows, which are real
    // records to the graph.
    goals = await createTable(baseId, { name: 'bg_goals', fields: NAME, records: [] });
    projects = await createTable(baseId, { name: 'bg_projects', fields: NAME, records: [] });
    tasks = await createTable(baseId, { name: 'bg_tasks', fields: NAME, records: [] });
    tags = await createTable(baseId, { name: 'bg_tags', fields: NAME, records: [] });
    f.taskName = tasks.fields[0].id;

    const projectGoal = await createField(projects.id, {
      name: 'goal',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: goals.id },
    });
    f.projectGoal = projectGoal.id;
    f.goalProjects = (projectGoal.options as { symmetricFieldId: string }).symmetricFieldId;

    const taskProject = await createField(tasks.id, {
      name: 'project',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: projects.id },
    });
    f.taskProject = taskProject.id;
    f.projectTasks = (taskProject.options as { symmetricFieldId: string }).symmetricFieldId;

    // One-way on purpose: a write to a two-way self-link created moments earlier
    // in the same setup has been seen to no-op, and one-way avoids it.
    f.taskParent = (
      await createField(tasks.id, {
        name: 'parent_task',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: tasks.id, isOneWay: true },
      })
    ).id;

    const tagTasks = await createField(tags.id, {
      name: 'tasks',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: tasks.id },
    });
    f.tagTasks = tagTasks.id;
    f.taskTags = (tagTasks.options as { symmetricFieldId: string }).symmetricFieldId;

    const [g] = (
      await createRecords(goals.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { name: 'Grow' } }],
      })
    ).records;
    r.G1 = g.id;

    const ps = (
      await createRecords(projects.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          { fields: { name: 'Launch', goal: { id: r.G1 } } },
          { fields: { name: 'Research', goal: { id: r.G1 } } },
        ],
      })
    ).records;
    [r.P1, r.P2] = ps.map((p) => p.id);

    const ts = (
      await createRecords(tasks.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          { fields: { name: 'Write', project: { id: r.P1 } } },
          { fields: { name: 'Ship', project: { id: r.P1 } } },
          { fields: { name: 'Read', project: { id: r.P2 } } },
          { fields: { name: 'Idle' } },
        ],
      })
    ).records;
    [r.T1, r.T2, r.T3, r.T4] = ts.map((t) => t.id);
    await updateRecordByApi(tasks.id, r.T2, 'parent_task', { id: r.T1 }, 200, FieldKeyType.Name);

    const xs = (
      await createRecords(tags.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          { fields: { name: 'urgent', tasks: [{ id: r.T1 }, { id: r.T2 }] } },
          { fields: { name: 'later', tasks: [{ id: r.T3 }] } },
        ],
      })
    ).records;
    [r.X, r.Y] = xs.map((x) => x.id);
  });

  afterAll(async () => {
    for (const t of [tags, tasks, projects, goals]) {
      if (t) await permanentDeleteTable(baseId, t.id);
    }
  });

  it('describes graphable tables and their link fields', async () => {
    const { data } = await getBaseGraphSchema(baseId);
    const table = data.tables.find((t) => t.id === tasks.id);

    expect(table).toMatchObject({
      name: 'bg_tasks',
      primaryFieldId: f.taskName,
      primaryFieldName: 'name',
      approxRecordCount: 4,
      suggestedHierarchyFieldId: f.taskParent,
    });
    expect(table?.views.length).toBeGreaterThan(0);
    expect(table?.linkFields.find((l) => l.id === f.taskProject)).toMatchObject({
      foreignTableId: projects.id,
      relationship: Relationship.ManyOne,
      symmetricFieldId: f.projectTasks,
      isSelfLink: false,
      isMultipleCellValue: false,
      isCrossBase: false,
    });
    expect(table?.linkFields.find((l) => l.id === f.taskParent)).toMatchObject({
      isSelfLink: true,
      isOneWay: true,
    });
  });

  it('draws every link between the selected tables exactly once', async () => {
    const graph = await query({
      tables: [goals, projects, tasks, tags].map((t) => ({ tableId: t.id })),
    });

    expect(graph.version).toBe(4);
    expect(graph.etag).toMatch(/^"bg4-/);
    expect(graph.nodes).toHaveLength(9);
    expect(pairsOf(graph)).toEqual(
      [
        pair(r.P1, r.G1),
        pair(r.P2, r.G1),
        pair(r.T1, r.P1),
        pair(r.T2, r.P1),
        pair(r.T3, r.P2),
        pair(r.X, r.T1),
        pair(r.X, r.T2),
        pair(r.Y, r.T3),
        pair(r.T2, r.T1),
      ].sort()
    );
    expect(graph.stats.danglingLinks).toBe(0);
    expect(graph.nodes.find((n) => n.recordId === r.P1)).toMatchObject({
      label: 'Launch',
      kind: 'record',
      tableId: projects.id,
      degree: 3,
    });
  });

  it('applies a per-table filter; links into filtered-out rows are dangling', async () => {
    const graph = await query({
      tables: [
        { tableId: projects.id },
        {
          tableId: tasks.id,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: f.taskName, operator: 'is', value: 'Write' }],
          },
        },
      ],
      // Pin the read side to projects.tasks so the dangling count is exact.
      linkFieldIds: [f.projectTasks],
    });

    expect(ids(graph)).toEqual([`rec:${r.P1}`, `rec:${r.P2}`, `rec:${r.T1}`].sort());
    expect(pairsOf(graph)).toEqual([pair(r.P1, r.T1)]);
    // P1 → Ship and P2 → Read point at rows the filter removed.
    expect(graph.stats.danglingLinks).toBe(2);
  });

  it("ANDs an ad-hoc filter with the view's filter", async () => {
    const view = await createView(tasks.id, { name: 'bg-has-i', type: 'grid' as never });
    await updateViewFilter(tasks.id, view.id, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: f.taskName, operator: 'contains', value: 'i' }],
      },
    });

    const graph = await query({
      tables: [
        {
          tableId: tasks.id,
          viewId: view.id,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: f.taskName, operator: 'contains', value: 'p' }],
          },
        },
      ],
    });
    expect(graph.nodes.map((n) => n.label)).toEqual(['Ship']);
  });

  it('draws a hierarchy field as a tree, and cuts a cycle', async () => {
    const tree = await query({ tables: [{ tableId: tasks.id, hierarchyFieldId: f.taskParent }] });
    expect(tree.nodes.find((n) => n.recordId === r.T2)).toMatchObject({
      parentId: `rec:${r.T1}`,
      depth: 1,
      colorKey: `rec:${r.T1}`,
    });
    expect(tree.links.filter((l) => l.kind === 'hierarchy')).toEqual([
      { source: `rec:${r.T1}`, target: `rec:${r.T2}`, kind: 'hierarchy', fieldId: f.taskParent },
    ]);
    // The hierarchy is structural, so it is not ALSO drawn as a link edge.
    expect(pairsOf(tree)).toEqual([]);

    await updateRecordByApi(tasks.id, r.T1, 'parent_task', { id: r.T2 }, 200, FieldKeyType.Name);
    try {
      const cyclic = await query({
        tables: [{ tableId: tasks.id, hierarchyFieldId: f.taskParent }],
      });
      expect(cyclic.stats.cyclesDropped).toBe(1);
      expect(cyclic.links.filter((l) => l.kind === 'hierarchy')).toHaveLength(1);
    } finally {
      await updateRecordByApi(tasks.id, r.T1, 'parent_task', null, 200, FieldKeyType.Name);
    }
  });

  it('groups by a table outside the graph with labelled synthetic nodes', async () => {
    const graph = await query({ tables: [{ tableId: tasks.id, groupByFieldId: f.taskProject }] });

    expect(graph.nodes.find((n) => n.id === `grp:${f.taskProject}:${r.P1}`)).toMatchObject({
      kind: 'group',
      label: 'Launch',
    });
    expect(graph.nodes.find((n) => n.id === `grp:${f.taskProject}:__none__`)?.label).toBe(
      'Unclassified'
    );
    expect(graph.nodes.find((n) => n.recordId === r.T4)?.parentId).toBe(
      `grp:${f.taskProject}:__none__`
    );
    expect(graph.stats.groupOrphans).toBe(1);
  });

  it('groups onto record nodes when the target table is in the graph', async () => {
    const graph = await query({
      tables: [{ tableId: tasks.id, groupByFieldId: f.taskProject }, { tableId: projects.id }],
    });
    expect(graph.nodes.find((n) => n.recordId === r.T3)?.parentId).toBe(`rec:${r.P2}`);
    // The group field's twin on projects is structural too, so the only link
    // edge left is parent_task — not a hierarchy in this query.
    expect(pairsOf(graph)).toEqual([pair(r.T2, r.T1)]);
  });

  it('reports per-table truncation', async () => {
    const graph = await query({ tables: [{ tableId: tasks.id, limit: 2 }] });
    expect(graph.stats.perTable).toEqual([{ tableId: tasks.id, emitted: 2, truncated: true }]);
    expect(graph.stats.truncated.nodes).toBe(true);
  });

  it('rejects tables, fields and links that do not fit the base', async () => {
    const otherBase = await createBase({ spaceId: globalThis.testConfig.spaceId });
    try {
      const foreign = await createTable(otherBase.id, { name: 'x', fields: NAME, records: [] });
      const error = await getError(() => query({ tables: [{ tableId: foreign.id }] }));
      expect(error?.status).toBe(404);
    } finally {
      await permanentDeleteBase(otherBase.id);
    }

    const multi = await getError(() =>
      query({ tables: [{ tableId: tasks.id, hierarchyFieldId: f.taskTags }] })
    );
    expect(multi?.status).toBe(400);

    const undrawable = await getError(() =>
      query({ tables: [{ tableId: tasks.id }], linkFieldIds: [f.taskProject] })
    );
    expect(undrawable?.status).toBe(400);
  });

  it('serves record detail with fields, link counts and a breadcrumb', async () => {
    const { data } = await getBaseGraphNode(baseId, r.T2, {
      tableId: tasks.id,
      hierarchyFieldId: f.taskParent,
    });

    expect(data).toMatchObject({
      id: `rec:${r.T2}`,
      tableId: tasks.id,
      tableName: 'bg_tasks',
      label: 'Ship',
      ancestors: [{ id: `rec:${r.T1}`, label: 'Write' }],
    });
    expect(data.fields[0]).toMatchObject({ fieldId: f.taskName, cellValue: 'Ship' });
    const count = (fieldId: string) => data.linkCounts.find((c) => c.fieldId === fieldId)?.count;
    expect(count(f.taskProject)).toBe(1);
    expect(count(f.taskTags)).toBe(1);
    expect(count(f.taskParent)).toBe(1);
  });

  it('expands a record into its neighbours without resending known nodes', async () => {
    const { data } = await expandBaseGraph(baseId, {
      tableId: projects.id,
      recordId: r.P1,
      exclude: [`rec:${r.P1}`, `rec:${r.T1}`],
    });

    expect(data.nodes.map((n) => n.id).sort()).toEqual([`rec:${r.G1}`, `rec:${r.T2}`].sort());
    expect(data.nodes.find((n) => n.recordId === r.G1)?.label).toBe('Grow');
    // Edges to the excluded T1 are still returned — the client has that node.
    expect(data.links.map((l) => [l.source, l.target].sort().join('~')).sort()).toEqual(
      [pair(r.P1, r.G1), pair(r.P1, r.T1), pair(r.P1, r.T2)].sort()
    );
    expect(data.truncated).toBe(false);
  });

  describe('ETag', () => {
    const RO: IBaseGraphQueryRo = { tables: [{ tableId: '' }] };
    const post = (etag?: string) =>
      axios.post(urlBuilder(QUERY_BASE_GRAPH, { baseId }), RO, {
        headers: etag ? { 'If-None-Match': etag } : {},
        validateStatus: () => true,
      });
    const etagNow = async () => (await post()).headers.etag as string;

    beforeAll(() => {
      RO.tables[0].tableId = tasks.id;
    });

    it('answers a matching If-None-Match with 304 and no body', async () => {
      const etag = await etagNow();
      const res = await post(etag);
      expect(res.status).toBe(304);
    });

    it('moves when a record is edited, created or deleted', async () => {
      const before = await etagNow();
      await updateRecordByApi(tasks.id, r.T4, 'name', 'Idle again', 200, FieldKeyType.Name);
      const edited = await etagNow();
      expect(edited).not.toBe(before);

      const { records } = await createRecords(tasks.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { name: 'temp' } }],
      });
      const created = await etagNow();
      expect(created).not.toBe(edited);

      await deleteRecord(tasks.id, records[0].id);
      const deleted = await etagNow();
      expect(deleted).not.toBe(created);
    });

    it('never serves a stale graph after a link is changed from the other table', async () => {
      const ro: IBaseGraphQueryRo = {
        tables: [{ tableId: tasks.id }, { tableId: tags.id }],
        // The tasks side is read; the write below goes through the tags side.
        linkFieldIds: [f.taskTags],
      };
      const before = (await queryBaseGraph(baseId, ro)).data;
      expect(pairsOf(before)).not.toContain(pair(r.X, r.T3));

      await updateRecordByApi(
        tags.id,
        r.X,
        'tasks',
        [{ id: r.T1 }, { id: r.T2 }, { id: r.T3 }],
        200,
        FieldKeyType.Name
      );
      const after = (await queryBaseGraph(baseId, ro)).data;
      expect(after.etag).not.toBe(before.etag);
      expect(pairsOf(after)).toContain(pair(r.X, r.T3));
    });

    it('falls back to a payload ETag when a filter tests a computed field', async () => {
      const formula = await createField(tasks.id, {
        name: 'name_copy',
        type: FieldType.Formula,
        options: { expression: `{${f.taskName}}` },
      });
      const res = await queryBaseGraph(baseId, {
        tables: [
          {
            tableId: tasks.id,
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: formula.id, operator: 'isNotEmpty', value: null }],
            },
          },
        ],
      });
      expect(res.data.etag).toMatch(/^"bg4-p/);
      expect(res.data.nodes.length).toBeGreaterThan(0);
    });

    it('moves when the primary field is renamed', async () => {
      const before = await etagNow();
      await updateField(tasks.id, f.taskName, { name: 'title' });
      try {
        expect(await etagNow()).not.toBe(before);
      } finally {
        await updateField(tasks.id, f.taskName, { name: 'name' });
      }
    });
  });

  it('403s for a user who is not a member of the base', async () => {
    const stranger = await createNewUserAxios({
      email: 'base-graph-stranger@test.com',
      password: 'TestPassword123!',
    });
    const error = await getError(() =>
      stranger.post(urlBuilder(QUERY_BASE_GRAPH, { baseId }), {
        tables: [{ tableId: tasks.id }],
      })
    );
    expect(error?.status).toBe(403);
  });
});
