import { getAgentPackCatalog } from '../../pack/agent-pack';
import type { IActualTable } from './pack-verify';
import { needsRepair, verifyAgainstPack } from './pack-verify';

/** A base exactly as the pack would create it, with ids derived from names. */
const freshBase = (): IActualTable[] =>
  [...getAgentPackCatalog().tables.values()].map(({ table, fields }) => ({
    id: `tbl_${table.key}`,
    name: table.name,
    fields: [...fields.values()].map((f) => ({
      id: `fld_${table.key}_${f.key}`,
      name: f.name,
      type: f.type,
      isLookup: f.spec?.isLookup,
    })),
  }));

describe('verifyAgainstPack', () => {
  const catalog = getAgentPackCatalog();
  const empty = { tableMap: {}, fieldMap: {} };

  it('accepts a complete base and maps every table and field', () => {
    const r = verifyAgainstPack(catalog, freshBase(), empty);
    expect(needsRepair(r)).toBe(false);
    expect(r.tableMap.agent_memory).toBe('tbl_agent_memory');
    expect(r.fieldMap.agent_messages.thread).toBe('fld_agent_messages_thread');
    expect(r.mismatched).toEqual([]);
  });

  it('reports a missing table and a deleted field', () => {
    const base = freshBase().filter((t) => t.name !== 'agent_skills');
    const memory = base.find((t) => t.name === 'agent_memory')!;
    memory.fields = memory.fields.filter((f) => f.name !== 'pinned');
    const r = verifyAgainstPack(catalog, base, empty);
    expect(r.missingTables).toEqual(['agent_skills']);
    expect(r.missingFields).toContain('agent_memory.pinned');
    expect(needsRepair(r)).toBe(true);
    // the planner sees the remaining fields under pack names
    expect(r.existing.fields.get('agent_memory')!.has('pinned')).toBe(false);
    expect(r.existing.fields.get('agent_memory')!.has('content')).toBe(true);
  });

  it('follows renamed tables and fields by stored id', () => {
    const first = verifyAgainstPack(catalog, freshBase(), empty);
    const base = freshBase();
    const memory = base.find((t) => t.name === 'agent_memory')!;
    memory.name = 'What the agent knows';
    memory.fields.find((f) => f.name === 'content')!.name = 'Details';
    const r = verifyAgainstPack(catalog, base, {
      tableMap: first.tableMap,
      fieldMap: first.fieldMap,
    });
    expect(needsRepair(r)).toBe(false);
    expect(r.renamed).toEqual(expect.arrayContaining(['agent_memory', 'agent_memory.content']));
    // shown to the planner under the pack name, so nothing is recreated
    expect(r.existing.fields.get('agent_memory')!.get('content')!.id).toBe(
      'fld_agent_memory_content'
    );
  });

  it('reports a changed type without asking to recreate the field', () => {
    const base = freshBase();
    base.find((t) => t.name === 'agent_threads')!.fields.find((f) => f.name === 'summary')!.type =
      'singleLineText';
    const r = verifyAgainstPack(catalog, base, empty);
    expect(r.mismatched).toEqual([
      { field: 'agent_threads.summary', actual: 'singleLineText', expected: 'longText' },
    ]);
    expect(needsRepair(r)).toBe(false);
  });

  it('treats a link turned into text as missing and detached', () => {
    const base = freshBase();
    const skills = base.find((t) => t.name === 'agent_skills')!;
    skills.fields.find((f) => f.name === 'credentials')!.type = 'singleLineText';
    const r = verifyAgainstPack(catalog, base, empty);
    expect(r.missingFields).toEqual(['agent_skills.credentials']);
    expect(r.detached).toEqual([
      {
        field: 'agent_skills.credentials',
        tableId: 'tbl_agent_skills',
        fieldId: 'fld_agent_skills_credentials',
        name: 'credentials',
      },
    ]);
    expect(r.fieldMap.agent_skills.credentials).toBeUndefined();
  });

  it('keeps admin-added columns visible to the planner', () => {
    const base = freshBase();
    base
      .find((t) => t.name === 'agent_memory')!
      .fields.push({
        id: 'fld_extra',
        name: 'my notes',
        type: 'longText',
      });
    const r = verifyAgainstPack(catalog, base, empty);
    expect(r.existing.fields.get('agent_memory')!.get('my notes')!.id).toBe('fld_extra');
  });
});
