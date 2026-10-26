import { AGENT_APPROVAL_CATEGORIES, AGENT_TOOLKIT_IDS } from '@teable/openapi';
import { APPROVAL_CATEGORIES } from '../../domain/policies/approval-policy';
import { TOOLKIT_IDS } from '../../toolkits/toolkit.types';

describe('admin contracts', () => {
  it('offer exactly the toolkits and approval categories the runtime knows', () => {
    expect([...AGENT_TOOLKIT_IDS]).toEqual([...TOOLKIT_IDS]);
    expect([...AGENT_APPROVAL_CATEGORIES]).toEqual([...APPROVAL_CATEGORIES]);
  });
});
