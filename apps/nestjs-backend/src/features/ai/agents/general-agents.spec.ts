import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createGeneralInfoAgent, generalInfoInstructions } from './general-agents';

describe('Local AI agent', () => {
  it('has only the read-only data tools', () => {
    const agent = createGeneralInfoAgent(new MockLanguageModelV3());
    expect(Object.keys(agent.tools).sort()).toEqual([
      'describeTable',
      'getRecords',
      'listTables',
      'queryRecords',
    ]);
  });

  it('tells the model it cannot change data and must not claim it did', () => {
    expect(generalInfoInstructions).toContain('You cannot create, update');
    expect(generalInfoInstructions).toContain('Never claim a change was made');
    expect(generalInfoInstructions).not.toMatch(/bash|loadSkill|create-records/);
  });
});
