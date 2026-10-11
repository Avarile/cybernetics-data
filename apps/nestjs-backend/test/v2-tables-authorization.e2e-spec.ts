import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('V2Controller tables authorization (e2e)', () => {
  let app: INestApplication;
  let outsider: AxiosInstance;
  let table: ITableFullVo;
  let titleFieldId: string;
  let recordId: string;

  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    outsider = await createNewUserAxios({
      email: 'v2-tables-outsider@example.com',
      password: '12345678',
    });

    table = await createTable(baseId, {
      name: 'v2 authorization target',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      // Without records, createTable adds blank rows and records[0] would be one of them.
      records: [],
    });
    titleFieldId = table.fields[0].id;
    const { records } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [titleFieldId]: 'keep me' } }],
    });
    recordId = records[0].id;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  it('rejects reading a table the user cannot access', async () => {
    const error = await getError(() =>
      outsider.get('/v2/tables/get', { params: { baseId, tableId: table.id } })
    );
    expect(error?.status).toBe(403);
  });

  it('rejects creating a table in a base the user cannot access', async () => {
    const error = await getError(() =>
      outsider.post('/v2/tables/create', { baseId, name: 'intruder table' })
    );
    expect(error?.status).toBe(403);
  });

  it('rejects updating records in a table the user cannot access', async () => {
    const error = await getError(() =>
      outsider.post('/v2/tables/updateRecords', {
        tableId: table.id,
        fields: { [titleFieldId]: 'overwritten' },
        recordIds: [recordId],
      })
    );
    expect(error?.status).toBe(403);
  });

  it('rejects deleting records in a table the user cannot access', async () => {
    const error = await getError(() =>
      outsider.delete('/v2/tables/deleteRecords', {
        data: { tableId: table.id, recordIds: [recordId] },
      })
    );
    expect(error?.status).toBe(403);

    const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(records.map((r) => r.id)).toContain(recordId);
    expect(records[0].fields[titleFieldId]).toBe('keep me');
  });
});
