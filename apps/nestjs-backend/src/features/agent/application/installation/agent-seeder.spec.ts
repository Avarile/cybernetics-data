import type { IBuiltinSkill } from '../../pack/builtin-skills';
import { BUILTIN_SKILLS, skillBodyHash } from '../../pack/builtin-skills';
import type { IExistingSkill } from './agent-seeder';
import { planSkillSeeds } from './agent-seeder';

const oldBody = 'Call rag_search with the question.';
const skill: IBuiltinSkill = {
  ...BUILTIN_SKILLS[0],
  name: 'document-search',
  body: 'Call search with the key words.',
  version: 2,
  renamedFrom: ['rag-search'],
  previous: [skillBodyHash(oldBody)],
};
const row = (over: Partial<IExistingSkill>): IExistingSkill => ({
  id: `rec${over.name}`,
  name: skill.name,
  source: 'builtin',
  version: skill.version,
  body: skill.body,
  ...over,
});

describe('planSkillSeeds', () => {
  it('seeds every built-in skill into an empty table', () => {
    const plan = planSkillSeeds([]);
    expect(plan.create.map((p) => p.name)).toEqual(BUILTIN_SKILLS.map((s) => s.name));
    expect(plan.create.every((p) => p.active)).toBe(true);
    expect(plan.upgrade).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('is a no-op when the current skills are there, edited or not', () => {
    const existing = BUILTIN_SKILLS.map((s, i) =>
      row({ name: s.name, version: s.version, body: i ? s.body : 'my own instructions' })
    );
    expect(planSkillSeeds(existing)).toEqual({ create: [], upgrade: [], remove: [] });
  });

  it('upgrades an unedited older version in place', () => {
    const old = row({ name: skill.name, version: 1, body: oldBody });
    expect(planSkillSeeds([old], [skill])).toEqual({
      create: [],
      upgrade: [{ id: old.id, skill }],
      remove: [],
    });
  });

  it('renames an unedited skill and removes the copies earlier seeds added', () => {
    const old = row({ name: 'rag-search', version: 1, body: oldBody });
    const copy = row({ name: 'rag-search-v2' });
    expect(planSkillSeeds([old, copy], [skill])).toEqual({
      create: [],
      upgrade: [{ id: old.id, skill }],
      remove: [copy.id],
    });
  });

  it('keeps a copy an admin edited', () => {
    const copy = row({ name: 'document-search-v2', body: 'edited copy' });
    const plan = planSkillSeeds([row({ version: 1, body: oldBody }), copy], [skill]);
    expect(plan.remove).toEqual([]);
  });

  it('offers a newer version of an edited skill as an inactive copy, once', () => {
    const edited = row({ version: 1, body: 'my own instructions' });
    expect(planSkillSeeds([edited], [skill])).toEqual({
      create: [{ skill, name: 'document-search-v2', active: false }],
      upgrade: [],
      remove: [],
    });
    const offered = row({ name: 'document-search-v2' });
    expect(planSkillSeeds([edited, offered], [skill])).toEqual({
      create: [],
      upgrade: [],
      remove: [],
    });
  });

  it('treats a skill an admin made under a built-in name as edited', () => {
    const own = row({ source: 'agent', version: 1, body: oldBody });
    expect(planSkillSeeds([own], [skill]).upgrade).toEqual([]);
  });

  it('knows the bodies shipped before', () => {
    const knowledge = BUILTIN_SKILLS.find((s) => s.name === 'knowledge-search')!;
    const documents = BUILTIN_SKILLS.find((s) => s.name === 'document-search')!;
    expect(knowledge.previous?.length).toBeGreaterThan(0);
    expect(documents.renamedFrom).toEqual(['rag-search']);
    expect(documents.previous?.length).toBeGreaterThan(0);
  });
});
