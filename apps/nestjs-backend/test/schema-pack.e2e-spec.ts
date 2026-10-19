/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import { FieldKeyType, FieldType, Role, ViewType } from '@teable/core';
import type { ISchemaPackAddRo, ISchemaPackInstallRo, ISchemaPackInstallVo } from '@teable/openapi';
import {
  ADD_SCHEMA_PACKS,
  addSchemaPacks,
  axios,
  emailBaseInvitation,
  getSchemaPackCatalog,
  INSTALL_SCHEMA_PACKS,
  installSchemaPacks,
  planSchemaPackAdd,
  planSchemaPackInstall,
  updateUserOnboarding,
  urlBuilder,
  userMe,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createField,
  createRecords,
  deleteField,
  getFields,
  getRecords,
  getViews,
  initApp,
  permanentDeleteBase,
} from './utils/init-app';

/** A full install creates ~17 tables and ~160 fields; well past the 10s default under load. */
const INSTALL_TIMEOUT = 120_000;

const OPTIONAL = ['project_frameworks', 'auditlog', 'finance_Tags', 'finance_Budgets'];

const installRo = (
  packs: ISchemaPackInstallRo['packs'],
  extra: Partial<ISchemaPackInstallRo> = {},
  optionalTables: string[] = []
): ISchemaPackInstallRo => ({
  spaceId: globalThis.testConfig.spaceId,
  packs,
  options: {
    baseName: `schema-pack ${packs.join('+')}`,
    timezone: 'Europe/London',
    currency: 'GBP',
    starterRows: true,
    optionalTables,
  },
  ...extra,
});

const addRo = (packs: ISchemaPackAddRo['packs']): ISchemaPackAddRo => ({
  packs,
  options: { timezone: 'Europe/London', currency: 'GBP', starterRows: true, optionalTables: [] },
});

describe('Schema packs (e2e)', () => {
  const created: string[] = [];
  /** Always a new base; adding to an existing one goes through addSchemaPacks. */
  const install = async (ro: ISchemaPackInstallRo) => {
    const vo = (await installSchemaPacks(ro)).data;
    created.push(vo.baseId);
    return vo;
  };
  const tableId = (vo: ISchemaPackInstallVo, key: string) =>
    vo.tables.find((t) => t.key === key)!.id;
  const fieldNames = async (id: string) => (await getFields(id)).map((f) => f.name);

  beforeAll(async () => {
    await initApp();
  });

  afterAll(async () => {
    for (const baseId of created) await permanentDeleteBase(baseId);
  });

  it('serves the catalog', async () => {
    const { data } = await getSchemaPackCatalog();
    expect(data.packs.map((p) => p.id)).toEqual(['progress', 'people', 'knowledge', 'finance']);
    expect(data.bridges).toHaveLength(2);
  });

  describe('all four packs', () => {
    let vo: ISchemaPackInstallVo;

    beforeAll(async () => {
      vo = await install(installRo(['progress', 'people', 'knowledge', 'finance'], {}, OPTIONAL));
    }, INSTALL_TIMEOUT);

    it('creates every table and matches the plan it previewed', async () => {
      expect(vo.tables).toHaveLength(17);
      const { data: plan } = await planSchemaPackInstall({
        packs: ['progress', 'people', 'knowledge', 'finance'],
        optionalTables: OPTIONAL,
      });
      expect(vo.counts.tables).toBe(plan.counts.tables);
      expect(vo.counts.fields).toBe(plan.counts.fields);
      expect(vo.counts.records).toBe(plan.counts.seedRows);
    });

    it('builds both sides of bridges with the source names', async () => {
      expect(await fieldNames(tableId(vo, 'tasks'))).toContain('assigned_to');
      expect(await fieldNames(tableId(vo, 'contacts'))).toEqual(
        expect.arrayContaining(['tasks', 'projects', 'auditlog'])
      );
      expect(await fieldNames(tableId(vo, 'knowledge_type'))).toEqual(
        expect.arrayContaining(['parent_type', 'child_types'])
      );
      expect(await fieldNames(tableId(vo, 'knowledge_type'))).not.toContain('credentials');
      expect(await fieldNames(tableId(vo, 'finance_Accounts'))).toEqual(
        expect.arrayContaining(['finance_Transactions', 'finance_Transactions (linked)'])
      );
    });

    it('applies the chosen timezone and currency', async () => {
      const tasks = await getFields(tableId(vo, 'tasks'));
      const started = tasks.find((f) => f.name === 'started_at')!;
      expect(started.options).toMatchObject({ formatting: { timeZone: 'Europe/London' } });
      const tx = await getFields(tableId(vo, 'finance_Transactions'));
      const amount = tx.find((f) => f.name === 'Amount')!;
      expect(amount.options).toMatchObject({ formatting: { symbol: '£' } });
    });

    it('adds the kanban boards', async () => {
      const views = await getViews(tableId(vo, 'tasks'));
      expect(views.map((v) => v.type)).toEqual([ViewType.Grid, ViewType.Kanban]);
    });

    it('seeds linked starter rows', async () => {
      const tasks = await getRecords(tableId(vo, 'tasks'), { fieldKeyType: FieldKeyType.Name });
      expect(tasks.records).toHaveLength(3);
      expect(tasks.records[0].fields.belong_project).toMatchObject({
        title: 'Set up my data centre',
      });
      const types = await getRecords(tableId(vo, 'knowledge_type'), {
        fieldKeyType: FieldKeyType.Name,
      });
      const howTo = types.records.find((r) => r.fields.title === 'general - how-to')!;
      expect(howTo.fields.parent_type).toMatchObject({ title: 'general' });
    });

    it('computes balances and budgets from transactions', async () => {
      const accountsId = tableId(vo, 'finance_Accounts');
      const [account] = (await getRecords(accountsId, { fieldKeyType: FieldKeyType.Name })).records;
      const budgetsId = tableId(vo, 'finance_Budgets');
      const { records: budgets } = await createRecords(budgetsId, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Month: '2026-10-01', 'Planned Amount': 200 } }],
      });
      await createRecords(tableId(vo, 'finance_Transactions'), {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [
          {
            fields: {
              Description: 'Groceries',
              Type: 'Expense',
              Amount: 50,
              Account: { id: account.id },
              Budget: { id: budgets[0].id },
            },
          },
          {
            fields: {
              Description: 'Salary',
              Type: 'Income',
              Amount: 1000,
              Account: { id: account.id },
            },
          },
        ],
      });
      const after = await getRecords(accountsId, { fieldKeyType: FieldKeyType.Name });
      expect(after.records[0].fields['Current Balance']).toBe(950);
      const budget = await getRecords(budgetsId, { fieldKeyType: FieldKeyType.Name });
      expect(budget.records[0].fields).toMatchObject({
        'Actual Spent': 50,
        Variance: 150,
        '% Used': 25,
      });
    });
  });

  it(
    'adds a bridge when the other pack is installed later',
    async () => {
      const progress = await install(installRo(['progress']));
      expect(await fieldNames(tableId(progress, 'tasks'))).not.toContain('assigned_to');

      const people = (await addSchemaPacks(progress.baseId, addRo(['people']))).data;
      expect(people.baseId).toBe(progress.baseId);
      expect(people.tables.map((t) => t.key)).not.toContain('tasks');
      expect(await fieldNames(tableId(progress, 'tasks'))).toContain('assigned_to');
      expect(await fieldNames(tableId(progress, 'projects'))).toContain('lead_by');

      const again = await getError(() => addSchemaPacks(progress.baseId, addRo(['people'])));
      expect(again?.status).toBe(400);
    },
    INSTALL_TIMEOUT
  );

  it(
    'recreates a deleted pack field on reinstall',
    async () => {
      const vo = await install(installRo(['progress']));
      const tasksId = tableId(vo, 'tasks');
      const priority = (await getFields(tasksId)).find((f) => f.name === 'priority')!;
      await deleteField(tasksId, priority.id);

      const { data: plan } = await planSchemaPackAdd(vo.baseId, {
        packs: ['progress'],
        optionalTables: [],
      });
      expect(plan.tables.find((t) => t.key === 'tasks')?.fields.map((f) => f.name)).toEqual([
        'priority',
      ]);
      const repaired = (await addSchemaPacks(vo.baseId, addRo(['progress']))).data;
      expect(repaired.tables).toEqual([]);
      expect(await fieldNames(tasksId)).toContain('priority');
    },
    INSTALL_TIMEOUT
  );

  it(
    'refuses to build over a same-named field of another type',
    async () => {
      const vo = await install(installRo(['progress']));
      const tasksId = tableId(vo, 'tasks');
      const priority = (await getFields(tasksId)).find((f) => f.name === 'priority')!;
      await deleteField(tasksId, priority.id);
      await createField(tasksId, { name: 'priority', type: FieldType.Number });

      const planError = await getError(() =>
        planSchemaPackAdd(vo.baseId, { packs: ['progress'], optionalTables: [] })
      );
      expect(planError?.status).toBe(400);
      expect(planError?.message).toContain('tasks.priority');
      const installError = await getError(() => addSchemaPacks(vo.baseId, addRo(['progress'])));
      expect(installError?.status).toBe(400);
    },
    INSTALL_TIMEOUT
  );

  it(
    'lets a creator invited to just the base add packs, and refuses an editor',
    async () => {
      const vo = await install(installRo(['progress']));
      const creator = await createNewUserAxios({
        email: 'schema-pack-base-creator@e2e.com',
        password: '12345678',
      });
      const editor = await createNewUserAxios({
        email: 'schema-pack-base-editor@e2e.com',
        password: '12345678',
      });
      await emailBaseInvitation({
        baseId: vo.baseId,
        emailBaseInvitationRo: { role: Role.Creator, emails: ['schema-pack-base-creator@e2e.com'] },
      });
      await emailBaseInvitation({
        baseId: vo.baseId,
        emailBaseInvitationRo: { role: Role.Editor, emails: ['schema-pack-base-editor@e2e.com'] },
      });
      const url = urlBuilder(ADD_SCHEMA_PACKS, { baseId: vo.baseId });

      const denied = await getError(() => editor.post(url, addRo(['knowledge'])));
      expect(denied?.status).toBe(403);

      const { data } = await creator.post<ISchemaPackInstallVo>(url, addRo(['knowledge']));
      expect(data.baseId).toBe(vo.baseId);
      expect(await fieldNames(tableId(vo, 'tasks'))).toContain('refer_knowledge');
    },
    INSTALL_TIMEOUT
  );

  it('rejects an optional table outside the selection', async () => {
    const error = await getError(() =>
      installSchemaPacks(installRo(['progress'], {}, ['finance_Budgets']))
    );
    expect(error?.status).toBe(400);
  });

  it('refuses a space the user cannot create bases in', async () => {
    const stranger = await createNewUserAxios({
      email: 'schema-pack-stranger@e2e.com',
      password: '12345678',
    });
    const error = await getError(() =>
      stranger.post(INSTALL_SCHEMA_PACKS, installRo(['progress']))
    );
    expect(error?.status).toBe(403);
  });

  it('records onboarding as completed', async () => {
    await updateUserOnboarding({ status: 'completed' });
    expect((await userMe()).data.onboardingStatus).toBe('completed');
    const error = await getError(() => axios.patch('/user/onboarding', { status: 'legacy' }));
    expect(error?.status).toBe(400);
  });
});
