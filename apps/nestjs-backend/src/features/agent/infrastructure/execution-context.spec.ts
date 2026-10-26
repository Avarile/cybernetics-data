import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { AGENT_ROBOT_ID, getPermissions, Role } from '@cybernetics/core';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AgentExecutionContext } from './execution-context';

const srcRoot = join(__dirname, '../../..');

const listTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : listTs(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

describe('AgentExecutionContext', () => {
  let cls: ClsService<IClsStore>;
  let ctx: AgentExecutionContext;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [AgentExecutionContext],
    }).compile();
    cls = module.get(ClsService);
    ctx = module.get(AgentExecutionContext);
  });

  it('runs as the agent robot with owner permissions and the run scope', async () => {
    const seen = await ctx.run({ runId: 'run1', actorUserId: 'usrAdmin' }, async () => ({
      user: cls.get('user'),
      agentRun: cls.get('agentRun'),
      permissions: cls.get('permissions'),
    }));
    expect(seen.user.id).toBe(AGENT_ROBOT_ID);
    expect(seen.user.isAdmin).toBe(false);
    expect(seen.agentRun).toEqual({ runId: 'run1', actorUserId: 'usrAdmin' });
    expect(seen.permissions).toEqual(getPermissions(Role.Owner));
  });

  it('does not inherit anything from the calling request', async () => {
    const leaked = await cls.run(async () => {
      cls.set('user', { id: 'usrAdmin', name: 'a', email: 'a@x', isAdmin: true });
      cls.set('accessTokenId', 'tok1');
      cls.set('baseShare', { baseId: 'bse1', nodeId: null });
      return ctx.run({ runId: 'r', actorUserId: 'usrAdmin' }, async () => ({
        token: cls.get('accessTokenId'),
        share: cls.get('baseShare'),
        user: cls.get('user.id'),
      }));
    });
    expect(leaked).toEqual({ token: undefined, share: undefined, user: AGENT_ROBOT_ID });
  });

  it('leaves the caller context untouched afterwards', async () => {
    const after = await cls.run(async () => {
      cls.set('user', { id: 'usrAdmin', name: 'a', email: 'a@x' });
      await ctx.run({ runId: 'r', actorUserId: 'usrAdmin' }, async () => undefined);
      return { user: cls.get('user.id'), run: cls.get('agentRun') };
    });
    expect(after).toEqual({ user: 'usrAdmin', run: undefined });
  });

  it('is the only code that sets agentRun', () => {
    const setters = listTs(srcRoot)
      .filter((file) => /set\(\s*['"]agentRun['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file));
    expect(setters).toEqual(['features/agent/infrastructure/execution-context.ts']);
  });

  it('cannot be fed from a request: no middleware, guard or strategy mentions agentRun', () => {
    const requestLayer = ['middleware', 'features/auth', 'filter', 'interceptor'];
    const offenders = listTs(srcRoot)
      .map((file) => relative(srcRoot, file))
      .filter((file) => requestLayer.some((dir) => file.startsWith(dir)))
      .filter((file) => file !== 'features/auth/permission.service.ts')
      .filter((file) => readFileSync(join(srcRoot, file), 'utf8').includes('agentRun'));
    expect(offenders).toEqual([]);
  });
});
