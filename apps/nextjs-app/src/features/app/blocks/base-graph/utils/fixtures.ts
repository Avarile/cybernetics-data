import { Relationship } from '@teable/core';
import type {
  IBaseGraphLinkField,
  IBaseGraphSchemaTable,
  IBaseGraphSchemaVo,
} from '@teable/openapi';

export const link = (
  id: string,
  foreignTableId: string,
  selfTableId: string,
  extra: Partial<IBaseGraphLinkField> = {}
): IBaseGraphLinkField => ({
  id,
  name: id.replace(/^fld/, '').toLowerCase(),
  foreignTableId,
  relationship: Relationship.ManyOne,
  isOneWay: false,
  symmetricFieldId: null,
  isSelfLink: foreignTableId === selfTableId,
  isMultipleCellValue: false,
  isCrossBase: false,
  ...extra,
});

export const table = (
  id: string,
  name: string,
  linkFields: IBaseGraphLinkField[] = [],
  extra: Partial<IBaseGraphSchemaTable> = {}
): IBaseGraphSchemaTable => ({
  id,
  name,
  icon: null,
  primaryFieldId: `fld${name}Name`,
  primaryFieldName: 'name',
  approxRecordCount: 3,
  views: [],
  fields: [],
  linkFields,
  suggestedHierarchyFieldId: null,
  ...extra,
});

/** tasks.project ↔ projects.tasks; tasks.parent (self); tags.tasks ↔ tasks.tags */
export const SCHEMA: IBaseGraphSchemaVo = {
  baseId: 'bseTest',
  tables: [
    table('tblProjects', 'projects', [
      link('fldProjTasks', 'tblTasks', 'tblProjects', {
        symmetricFieldId: 'fldTaskProject',
        isMultipleCellValue: true,
      }),
    ]),
    table(
      'tblTasks',
      'tasks',
      [
        link('fldTaskProject', 'tblProjects', 'tblTasks', { symmetricFieldId: 'fldProjTasks' }),
        link('fldTaskParent', 'tblTasks', 'tblTasks', { isOneWay: true }),
        link('fldTaskTags', 'tblTags', 'tblTasks', {
          symmetricFieldId: 'fldTagTasks',
          isMultipleCellValue: true,
        }),
      ],
      { suggestedHierarchyFieldId: 'fldTaskParent' }
    ),
    table('tblTags', 'tags', [
      link('fldTagTasks', 'tblTasks', 'tblTags', {
        symmetricFieldId: 'fldTaskTags',
        isMultipleCellValue: true,
      }),
    ]),
    table('tblAudit', 'auditlog'),
  ],
};
