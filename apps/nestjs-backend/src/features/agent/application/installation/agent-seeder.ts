import { FieldKeyType } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { RecordOpenApiService } from '../../../record/open-api/record-open-api.service';
import { RecordService } from '../../../record/record.service';
import { DEFAULT_AGENT_SETUP } from '../../pack/agent-defaults';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { BUILTIN_SKILLS, skillBodyHash } from '../../pack/builtin-skills';
import type { IBuiltinSkill } from '../../pack/builtin-skills';
import type { IFieldMap, ITableMap } from './pack-verify';

export interface IExistingSkill {
  id: string;
  name: string;
  source?: string;
  version?: number;
  body?: string;
}

export interface ISkillSeedPlan {
  create: { skill: IBuiltinSkill; name: string; active: boolean }[];
  /** Unedited built-ins brought up to the shipped version (and name), keeping their record id. */
  upgrade: { id: string; skill: IBuiltinSkill }[];
  /** Unedited `name-vN` copies earlier seeds added next to a built-in. */
  remove: string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What to do with the built-in skills (current-design §3.1). A missing one is added active. One
 * nobody edited (its body is one we shipped) is upgraded in place, renamed if the skill was, and
 * the `name-vN` copies earlier seeds put next to it go. An edited one is never touched: a newer
 * version is offered as a separate inactive row `name-vN`.
 */
export function planSkillSeeds(
  existing: IExistingSkill[],
  builtins: IBuiltinSkill[] = BUILTIN_SKILLS
): ISkillSeedPlan {
  const plan: ISkillSeedPlan = { create: [], upgrade: [], remove: [] };
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (const skill of builtins) {
    const names = [skill.name, ...(skill.renamedFrom ?? [])];
    const shipped = new Set([skillBodyHash(skill.body), ...(skill.previous ?? [])]);
    const unedited = (row: IExistingSkill) =>
      row.source === 'builtin' && row.body != null && shipped.has(skillBodyHash(row.body));
    const current = names.map((n) => byName.get(n)).find(Boolean);
    const copyName = new RegExp(`^(?:${names.map(escapeRegExp).join('|')})-v\\d+$`);
    const copies = existing.filter((row) => row !== current && copyName.test(row.name));

    if (!current) {
      plan.create.push({ skill, name: skill.name, active: true });
    } else if (unedited(current)) {
      if (current.name !== skill.name || (current.version ?? 1) < skill.version) {
        plan.upgrade.push({ id: current.id, skill });
      }
    } else {
      const versioned = `${skill.name}-v${skill.version}`;
      if ((current.version ?? 1) < skill.version && !byName.has(versioned)) {
        plan.create.push({ skill, name: versioned, active: false });
      }
      continue;
    }
    plan.remove.push(...copies.filter(unedited).map((row) => row.id));
  }
  return plan;
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
          [f(t, 'search_scope')]: s.search_scope,
        },
      ]);
      setup = 1;
    }

    const skillTable = tableMap[AGENT_TABLES.skills];
    const t = AGENT_TABLES.skills;
    const existing = await this.recordService.getRecords(skillTable, {
      fieldKeyType: FieldKeyType.Id,
      take: 1000,
      projection: [f(t, 'name'), f(t, 'source'), f(t, 'version'), f(t, 'body')],
    });
    const plan = planSkillSeeds(
      existing.records.map((r) => ({
        id: r.id,
        name: String(r.fields[f(t, 'name')] ?? ''),
        source: r.fields[f(t, 'source')] as string | undefined,
        version: r.fields[f(t, 'version')] as number | undefined,
        body: r.fields[f(t, 'body')] as string | undefined,
      }))
    );
    const skillFields = (skill: IBuiltinSkill) => ({
      [f(t, 'name')]: skill.name,
      [f(t, 'description')]: skill.description,
      [f(t, 'body')]: skill.body,
      [f(t, 'invocation')]: skill.invocation,
      [f(t, 'toolkits')]: skill.toolkits,
      [f(t, 'category')]: skill.category,
      [f(t, 'version')]: skill.version,
    });

    if (plan.create.length) {
      const created = await this.create(
        skillTable,
        plan.create.map(({ skill, name }) => ({
          ...skillFields(skill),
          [f(t, 'name')]: name,
          [f(t, 'source')]: 'builtin',
        }))
      );
      // is_active defaults to true, and a false checkbox is an empty cell, so a create cannot
      // store false: switch the inactive copies off afterwards (an update applies no default)
      const inactive = created.filter((_, i) => !plan.create[i].active);
      if (inactive.length) {
        await this.update(
          skillTable,
          inactive.map((id) => ({ id, fields: { [f(t, 'is_active')]: false } }))
        );
      }
    }
    if (plan.upgrade.length) {
      await this.update(
        skillTable,
        plan.upgrade.map(({ id, skill }) => ({ id, fields: skillFields(skill) }))
      );
    }
    if (plan.remove.length) {
      await this.recordOpenApiService.deleteRecords(skillTable, plan.remove);
    }
    return {
      setup,
      skills: plan.create.length + plan.upgrade.length + plan.remove.length,
    };
  }

  /** Creates the rows and returns their ids, in order. */
  private async create(tableId: string, rows: Record<string, unknown>[]) {
    const { records } = await this.recordOpenApiService.createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: rows.map((fields) => ({ fields })),
    });
    return records.map((r) => r.id);
  }

  private async update(
    tableId: string,
    records: { id: string; fields: Record<string, unknown> }[]
  ) {
    await this.recordOpenApiService.updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records,
    });
  }
}
