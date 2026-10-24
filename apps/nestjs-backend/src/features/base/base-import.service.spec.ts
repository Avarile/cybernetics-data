import { DbFieldType, FieldType } from '@cybernetics/core';
import type { RestoreRecordInput } from '@teable/v2-core';

import { BaseImportService } from './base-import.service';

interface IRestoreRecordInputBuilder {
  toRestoreRecordInput(
    row: Record<string, string>,
    config: {
      dbTableName: string;
      columnNames: Set<string>;
      fieldsByDbFieldName: Map<
        string,
        {
          id: string;
          type: string;
          dbFieldName: string;
          dbFieldType: string;
          isMultipleCellValue: boolean | null;
          isComputed: boolean | null;
          notNull: boolean | null;
        }
      >;
    },
    viewIdMap: Record<string, string>
  ): RestoreRecordInput;
}

const dbTableName = 'bse_test.tbl_test';
const jsonColumnName = 'json_col';
const textColumnName = 'text_col';
const textCellValue = 'plain text';

const createService = () =>
  Object.create(BaseImportService.prototype) as IRestoreRecordInputBuilder;

describe('BaseImportService', () => {
  describe('toRestoreRecordInput', () => {
    it('serializes JSON extra column values for v2 dottea row restore', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName, textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
        [textColumnName]: textCellValue,
      });
    });

    it('wraps invalid legacy JSON cell strings before writing JSON columns', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: 'legacy text',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify('legacy text'),
      });
    });

    it('serializes lower-case JSON db field types', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: 'json',
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
      });
    });

    it('skips computed field types even when legacy dottea lacks isComputed', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['formula_col', textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            'formula_col',
            {
              id: 'fldFormulaValue',
              type: FieldType.Formula,
              dbFieldName: 'formula_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: null,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          formula_col: '[1]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [textColumnName]: textCellValue,
      });
      expect(record.extraColumnValues).not.toHaveProperty('formula_col');
    });

    it('keeps attachment values on the typed field path', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['attachment_col']),
        fieldsByDbFieldName: new Map([
          [
            'attachment_col',
            {
              id: 'fldAttachmentValue',
              type: FieldType.Attachment,
              dbFieldName: 'attachment_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          attachment_col: '[{"id":"att1","name":"a.pdf"}]',
        },
        config,
        {}
      );

      expect(record.fields).toMatchObject({
        fldAttachmentValue: [{ id: 'att1', name: 'a.pdf' }],
      });
      expect(record.extraColumnValues).toBeUndefined();
    });
  });

  describe('base schema provisioning', () => {
    const snapshotBaseId = 'bseSnapshotBase';
    const schemaSql = [`create schema if not exists "${snapshotBaseId}"`];

    const createHarness = () => {
      const order: string[] = [];
      const txExecuteRawUnsafe = vi.fn(async (sql: string) => {
        order.push(`ddl:${sql}`);
        return 1;
      });
      // The bare client is a separate connection that autocommits outside the caller's
      // transaction — schema DDL must never land here.
      const bareExecuteRawUnsafe = vi.fn(async () => 1);

      const service = Object.create(BaseImportService.prototype);

      Object.assign(service, {
        logger: { log: vi.fn(), error: vi.fn() },
        cls: { set: vi.fn() },
        dbProvider: { createSchema: vi.fn().mockReturnValue(schemaSql) },
        dataPrismaService: {
          txClient: () => ({ $executeRawUnsafe: txExecuteRawUnsafe }),
          $executeRawUnsafe: bareExecuteRawUnsafe,
        },
        prismaService: {
          // Reading the reused base off the bare client would step outside the caller's
          // transaction, so fail loudly if anything goes back to it.
          base: {
            findUniqueOrThrow: vi.fn(() => {
              throw new Error('reused base must be read through txClient()');
            }),
          },
          txClient: () => ({
            base: {
              findUniqueOrThrow: vi.fn().mockResolvedValue({
                id: snapshotBaseId,
                name: 'snapshot',
                icon: null,
                spaceId: 'spcTemplate',
              }),
              update: vi.fn().mockResolvedValue(undefined),
            },
          }),
        },
        createTables: vi.fn(async () => {
          order.push('createTables');
          return { tableIdMap: {}, fieldIdMap: {}, viewIdMap: {}, fkMap: {} };
        }),
        createPlugins: vi.fn().mockResolvedValue({ dashboardIdMap: {} }),
        createFolders: vi.fn().mockResolvedValue({ folderIdMap: {} }),
      });

      return { service, order, txExecuteRawUnsafe, bareExecuteRawUnsafe };
    };

    const structure = {
      id: 'bseSource',
      name: 'source',
      icon: null,
      tables: [],
      plugins: {},
      folders: [],
      nodes: [],
    };

    it('runs schema DDL on the transaction client so it rolls back with the metadata', async () => {
      const { service, txExecuteRawUnsafe, bareExecuteRawUnsafe } = createHarness();

      await service.ensureBaseSchema(snapshotBaseId);

      expect(txExecuteRawUnsafe).toHaveBeenCalledWith(schemaSql[0]);
      expect(bareExecuteRawUnsafe).not.toHaveBeenCalled();
    });

    it('provisions the schema before creating tables when reusing an existing base', async () => {
      const { service, order } = createHarness();

      await service.createBaseStructure('spcTemplate', structure, snapshotBaseId, true);

      // Re-publishing a template targets the previous snapshot base, whose schema may be gone.
      // Without this the first CREATE TABLE fails with 3F000 and the base can never be published.
      expect(order).toEqual([`ddl:${schemaSql[0]}`, 'createTables']);
    });
  });
});
