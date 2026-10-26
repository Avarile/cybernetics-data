import { FieldKeyType } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { RecordOpenApiService } from '../../../record/open-api/record-open-api.service';
import { RecordService } from '../../../record/record.service';
import { DEFAULT_AGENT_SETUP } from '../../pack/agent-defaults';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { BUILTIN_SKILLS } from '../../pack/builtin-skills';
import type { IBuiltinSkill } from '../../pack/builtin-skills';
import type { IFieldMap, ITableMap } from './pack-verify';

export interface IExistingSkill {
  name: string;
  source?: string;
  version?: number;
}

/**
 * Which built-in skills to insert. A missing one is added active. When a newer version ships and a
 * skill of that name already exists, the new version is added as a separate inactive row
 * (`name-v2`): an admin's edits are never overwritten (design §7.4 step 5).
 */
export function planSkillSeeds(
  existing: IExistingSkill[],
  builtins: IBuiltinSkill[] = BUILTIN_SKILLS
): { skill: IBuiltinSkill; name: string; active: boolean }[] {
  const byName = new Map(existing.map((s) => [s.name, s]));
  const out: { skill: IBuiltinSkill; name: string; active: boolean }[] = [];
  for (const skill of builtins) {
    const current = byName.get(skill.name);
    if (!current) {
      out.push({ skill, name: skill.name, active: true });
      continue;
    }
    const versioned = `${skill.name}-v${skill.version}`;
    if ((current.version ?? 1) < skill.version && !byName.has(versioned)) {
      out.push({ skill, name: versioned, active: false });
    }
  }
  return out;
}

/** Seeds the default agent profile and the built-in skills into the Agent base. */
@Injectable()
export class AgentSeeder {
  constructor(
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  async seed(tableMap: ITableMap, fieldMap: IFieldMap): Promise<{ setup: number; skills: number }> {
    const f = (table: string, key: string) => {
      const id = fieldMap[table]?.[key];
      if (!id) throw new Error(`Agent table ${table} is missing field ${key}`);
      return id;
    };
    let setup = 0;
    const setupTable = tableMap[AGENT_TABLES.setup];
    const setups = await this.recordService.getRecords(setupTable, {
      fieldKeyType: FieldKeyType.Id,
      take: 1,
    });
    if (setups.records.length === 0) {
      const s = DEFAULT_AGENT_SETUP;
      const t = AGENT_TABLES.setup;
      await this.create(setupTable, [
        {
          [f(t, 'name')]: s.name,
          [f(t, 'is_default')]: s.is_default,
          [f(t, 'is_active')]: s.is_active,
          [f(t, 'persona')]: s.persona,
          [f(t, 'max_steps')]: s.max_steps,
          [f(t, 'max_output_tokens')]: s.max_output_tokens,
          [f(t, 'toolkits')]: [...s.toolkits],
          [f(t, 'approval_required')]: [...s.approval_required],
          [f(t, 'memory_mode')]: s.memory_mode,
        },
      ]);
      setup = 1;
    }

    const skillTable = tableMap[AGENT_TABLES.skills];
    const t = AGENT_TABLES.skills;
    const existing = await this.recordService.getRecords(skillTable, {
      fieldKeyType: FieldKeyType.Id,
      take: 1000,
      projection: [f(t, 'name'), f(t, 'source'), f(t, 'version')],
    });
    const plan = planSkillSeeds(
      existing.records.map((r) => ({
        name: String(r.fields[f(t, 'name')] ?? ''),
        source: r.fields[f(t, 'source')] as string | undefined,
        version: r.fields[f(t, 'version')] as number | undefined,
      }))
    );
    if (plan.length) {
      await this.create(
        skillTable,
        plan.map(({ skill, name, active }) => ({
          [f(t, 'name')]: name,
          [f(t, 'description')]: skill.description,
          [f(t, 'body')]: skill.body,
          [f(t, 'invocation')]: skill.invocation,
          [f(t, 'toolkits')]: skill.toolkits,
          [f(t, 'category')]: skill.category,
          [f(t, 'source')]: 'builtin',
          [f(t, 'version')]: skill.version,
          [f(t, 'is_active')]: active,
        }))
      );
    }
    return { setup, skills: plan.length };
  }

  private async create(tableId: string, rows: Record<string, unknown>[]) {
    await this.recordOpenApiService.createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: rows.map((fields) => ({ fields })),
    });
  }
}
