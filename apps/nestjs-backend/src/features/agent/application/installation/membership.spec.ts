import { planMembership } from './membership';

const row = (over: Partial<Parameters<typeof planMembership>[1][number]>) => ({
  id: 'c',
  principalId: 'usr',
  principalType: 'user',
  resourceType: 'space',
  roleName: 'owner',
  ...over,
});

describe('planMembership', () => {
  it('adds missing admins as owners', () => {
    const plan = planMembership(['usrA', 'usrB'], [row({ id: 'c1', principalId: 'usrA' })]);
    expect(plan).toEqual({ add: ['usrB'], remove: [] });
  });

  it('removes non-admins, departments and base-level grants', () => {
    const rows = [
      row({ id: 'keep', principalId: 'usrA' }),
      row({ id: 'nonAdmin', principalId: 'usrX', roleName: 'editor' }),
      row({ id: 'dept', principalId: 'dep1', principalType: 'department' }),
      row({ id: 'base', principalId: 'usrA', resourceType: 'base' }),
    ];
    expect(planMembership(['usrA'], rows).remove.map((r) => r.id)).toEqual([
      'nonAdmin',
      'dept',
      'base',
    ]);
  });

  it('turns an admin with a lesser role into an owner', () => {
    const plan = planMembership(
      ['usrA'],
      [row({ id: 'c1', principalId: 'usrA', roleName: 'viewer' })]
    );
    expect(plan.add).toEqual(['usrA']);
    expect(plan.remove.map((r) => r.id)).toEqual(['c1']);
  });

  it('removes a demoted admin', () => {
    const plan = planMembership(
      ['usrA'],
      [row({ id: 'c1', principalId: 'usrA' }), row({ id: 'c2', principalId: 'usrOld' })]
    );
    expect(plan.remove.map((r) => r.id)).toEqual(['c2']);
  });
});
