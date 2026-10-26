/* eslint-disable @typescript-eslint/naming-convention */
/**
 * The principal the admin-only agent acts as. Records the agent writes show it as their author;
 * the admin who asked is kept in the agent's audit log. It is a system user and cannot sign in.
 */
export const AGENT_ROBOT_ID = 'agentRobot';

export const AGENT_ROBOT_USER = {
  id: AGENT_ROBOT_ID,
  name: 'Agent',
  email: 'agentRobot@system.cybernetics.ai',
};
