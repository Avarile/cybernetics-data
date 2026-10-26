import { BUILTIN_SKILLS } from '../../pack/builtin-skills';
import { planSkillSeeds } from './agent-seeder';

describe('planSkillSeeds', () => {
  it('seeds every built-in skill into an empty table', () => {
    expect(planSkillSeeds([]).map((p) => p.name)).toEqual(BUILTIN_SKILLS.map((s) => s.name));
    expect(planSkillSeeds([]).every((p) => p.active)).toBe(true);
  });

  it('is a no-op when the skills are there, edited or not', () => {
    const existing = BUILTIN_SKILLS.map((s) => ({
      name: s.name,
      source: 'builtin',
      version: s.version,
    }));
    expect(planSkillSeeds(existing)).toEqual([]);
  });

  it('adds a newer version as an inactive copy instead of overwriting', () => {
    const v2 = [{ ...BUILTIN_SKILLS[0], version: 2 }];
    const plan = planSkillSeeds([{ name: v2[0].name, source: 'builtin', version: 1 }], v2);
    expect(plan).toEqual([{ skill: v2[0], name: `${v2[0].name}-v2`, active: false }]);
    expect(
      planSkillSeeds(
        [
          { name: v2[0].name, version: 1 },
          { name: `${v2[0].name}-v2`, version: 2 },
        ],
        v2
      )
    ).toEqual([]);
  });
});
