import { AGENT_ROBOT_ID, ANONYMOUS_USER_ID } from '@cybernetics/core';
import type { IClsStore } from '../../../types/cls';
import { AgentAdminGuard } from './agent-admin.guard';

const guardWith = (store: Partial<IClsStore> & Record<string, unknown>) => {
  const cls = { get: (key: string) => store[key as keyof typeof store] };
  return new AgentAdminGuard(cls as never);
};
const admin = { id: 'usrAdmin', name: 'a', email: 'a@x', isAdmin: true };

describe('AgentAdminGuard', () => {
  it('lets an instance admin with a session through', () => {
    expect(guardWith({ user: admin }).canActivate()).toBe(true);
  });

  it.each([
    ['a non-admin', { user: { ...admin, isAdmin: false } }],
    ['an admin flag that is not exactly true', { user: { ...admin, isAdmin: null } }],
    ['a personal access token', { user: admin, accessTokenId: 'tok1' }],
    ['a share link', { user: admin, baseShare: { baseId: 'bse1', nodeId: null } }],
    ['a template preview', { user: admin, template: { id: 't', baseId: 'bse1' } }],
    ['an automation/app token', { user: admin, tempAuthBaseId: 'bse1' }],
    ['the agent robot', { user: { ...admin, id: AGENT_ROBOT_ID } }],
    ['anonymous', { user: { ...admin, id: ANONYMOUS_USER_ID } }],
    ['no user', {}],
  ])('refuses %s', (_label, store) => {
    expect(() => guardWith(store as never).canActivate()).toThrow(/Only instance admins/);
  });
});
