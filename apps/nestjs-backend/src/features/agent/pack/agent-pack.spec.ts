/* eslint-disable @typescript-eslint/naming-convention */
import { planInstall } from '../../schema-pack/schema-pack.planner';
import { AGENT_TABLES, getAgentPackCatalog } from './agent-pack';

describe('agent schema pack', () => {
  it('builds as its own catalog', () => {
    const catalog = getAgentPackCatalog();
    expect([...catalog.tables.keys()].sort()).toEqual(Object.values(AGENT_TABLES).sort());
  });

  it('plans a full install into an empty base', () => {
    const catalog = getAgentPackCatalog();
    const plan = planInstall(catalog, { packs: ['agent'], optionalTables: [], starterRows: false });
    expect(plan.tables.map((t) => t.key).sort()).toEqual(Object.values(AGENT_TABLES).sort());
    // the five links, each with a symmetric field on the other table
    expect(plan.links).toHaveLength(5);
  });

  it('has the fields the store relies on', () => {
    const fields = (table: string) => [...getAgentPackCatalog().tables.get(table)!.fields.keys()];
    expect(fields('agent_setup')).toEqual(
      expect.arrayContaining([
        'name',
        'is_default',
        'persona',
        'model',
        'toolkits',
        'approval_required',
        'memory_mode',
        'search_scope',
        'search_exclude',
        'search_protocol',
        'data_base_id',
      ])
    );
    expect(fields('agent_messages')).toEqual(
      expect.arrayContaining(['thread', 'seq', 'role', 'content', 'parts'])
    );
    expect(fields('agent_credentials')).toEqual(
      expect.arrayContaining(['name', 'auth_kind', 'allowed_hosts', 'status', 'skills'])
    );
    // nothing derived from a secret in a table the agent can read
    expect(fields('agent_credentials')).not.toContain('preview');
    expect(fields('agent_threads')).toEqual(
      expect.arrayContaining(['messages', 'memories', 'owner'])
    );
  });

  it('never stores a secret value column', () => {
    const credential = [...getAgentPackCatalog().tables.get('agent_credentials')!.fields.keys()];
    expect(credential.some((k) => /secret|value|token|password|api_?key/i.test(k))).toBe(false);
  });
});

describe('agent seeds', () => {
  it('ship valid built-in skills', async () => {
    const { BUILTIN_SKILLS } = await import('./builtin-skills');
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const catalog = getAgentPackCatalog();
    const choices = (table: string, field: string) =>
      (
        catalog.tables.get(table)!.fields.get(field)!.spec!.options as {
          choices: { name: string }[];
        }
      ).choices.map((c) => c.name);
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(choices('agent_skills', 'invocation')).toContain(skill.invocation);
      expect(choices('agent_skills', 'category')).toContain(skill.category);
      skill.toolkits.forEach((t) => expect(choices('agent_skills', 'toolkits')).toContain(t));
    }
  });

  it('seed a default setup whose options exist in the pack', async () => {
    const { DEFAULT_AGENT_SETUP } = await import('./agent-defaults');
    const catalog = getAgentPackCatalog();
    const choices = (field: string) =>
      (
        catalog.tables.get('agent_setup')!.fields.get(field)!.spec!.options as {
          choices: { name: string }[];
        }
      ).choices.map((c) => c.name);
    DEFAULT_AGENT_SETUP.toolkits.forEach((t) => expect(choices('toolkits')).toContain(t));
    DEFAULT_AGENT_SETUP.approval_required.forEach((a) =>
      expect(choices('approval_required')).toContain(a)
    );
    expect(choices('memory_mode')).toContain(DEFAULT_AGENT_SETUP.memory_mode);
  });
});
