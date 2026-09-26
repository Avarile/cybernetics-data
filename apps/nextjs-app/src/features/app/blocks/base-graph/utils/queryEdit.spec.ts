import type { IBaseGraphQueryRo } from '@teable/openapi';
import { SCHEMA } from './fixtures';
import {
  groupCandidates,
  hierarchyCandidates,
  isRelationshipOn,
  relationshipsOf,
  toggleRelationship,
  toggleTable,
  updateTable,
} from './queryEdit';

const tasks = SCHEMA.tables[1];
const RO: IBaseGraphQueryRo = {
  tables: [{ tableId: 'tblProjects' }, { tableId: 'tblTasks' }, { tableId: 'tblTags' }],
};

describe('queryEdit', () => {
  it('offers single-valued self-links as trees and single-valued foreign links as groups', () => {
    expect(hierarchyCandidates(tasks).map((l) => l.id)).toEqual(['fldTaskParent']);
    expect(groupCandidates(tasks).map((l) => l.id)).toEqual(['fldTaskProject']);
  });

  it('collapses each two-way pair into one relationship', () => {
    const rels = relationshipsOf(SCHEMA, RO);
    expect(rels.map((r) => r.id).sort()).toEqual(['fldProjTasks', 'fldTagTasks', 'fldTaskParent']);
    expect(rels.find((r) => r.id === 'fldProjTasks')?.fieldIds.sort()).toEqual([
      'fldProjTasks',
      'fldTaskProject',
    ]);
  });

  it('hides the tree and group fields, and their twins, from relationships', () => {
    const ro = updateTable(SCHEMA, RO, 'tblTasks', {
      hierarchyFieldId: 'fldTaskParent',
      groupByFieldId: 'fldTaskProject',
    });
    expect(relationshipsOf(SCHEMA, ro).map((r) => r.id)).toEqual(['fldTagTasks']);
  });

  it('turns "all links" into an explicit list when one is switched off', () => {
    const rels = relationshipsOf(SCHEMA, RO);
    const tags = rels.find((r) => r.id === 'fldTagTasks')!;
    expect(isRelationshipOn(RO, tags)).toBe(true);
    const next = toggleRelationship(SCHEMA, RO, tags);
    expect(isRelationshipOn(next, tags)).toBe(false);
    expect(next.linkFieldIds?.sort()).toEqual(['fldProjTasks', 'fldTaskParent', 'fldTaskProject']);
  });

  it('prunes link ids that stop being drawable when a table is removed', () => {
    const narrowed = { ...RO, linkFieldIds: ['fldTagTasks', 'fldTaskTags', 'fldTaskParent'] };
    const next = toggleTable(SCHEMA, narrowed, SCHEMA.tables[2]);
    expect(next?.tables.map((t) => t.tableId)).toEqual(['tblProjects', 'tblTasks']);
    expect(next?.linkFieldIds).toEqual(['fldTaskParent']);
  });

  it('adds a table with its suggested tree, and refuses to remove the last one', () => {
    const added = toggleTable(SCHEMA, { tables: [{ tableId: 'tblProjects' }] }, tasks);
    expect(added?.tables[1]).toEqual({ tableId: 'tblTasks', hierarchyFieldId: 'fldTaskParent' });
    expect(toggleTable(SCHEMA, { tables: [{ tableId: 'tblTasks' }] }, tasks)).toBeNull();
  });

  it('drops keys that are cleared', () => {
    const ro = updateTable(
      SCHEMA,
      { tables: [{ tableId: 'tblTasks', viewId: 'viwX' }] },
      'tblTasks',
      {
        viewId: undefined,
      }
    );
    expect(ro.tables[0]).toEqual({ tableId: 'tblTasks' });
  });
});
