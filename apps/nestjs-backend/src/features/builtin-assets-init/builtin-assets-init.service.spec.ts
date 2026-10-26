import { AGENT_ROBOT_ID, AGENT_ROBOT_USER } from '@cybernetics/core';
import { BuiltinAssetsInitService } from './builtin-assets-init.service';

describe('BuiltinAssetsInitService', () => {
  it('ships an avatar for the agent robot', () => {
    const assets = (
      BuiltinAssetsInitService.prototype as unknown as {
        getBuiltinAssets: () => { id: string }[];
      }
    ).getBuiltinAssets.call({});
    expect(assets.map((a) => a.id)).toContain(AGENT_ROBOT_ID);
  });

  it('uses a system address for the agent robot', () => {
    expect(AGENT_ROBOT_USER).toEqual({
      id: 'agentRobot',
      name: 'Agent',
      email: 'agentRobot@system.cybernetics.ai',
    });
  });
});
