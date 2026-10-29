import type { ISchemaField, ITableSchema } from '../schema';

/** The data-centre base as read on 2026-10-30 (cockpit design §2.3), trimmed to what search uses. */
const common = (prefix: string): ISchemaField[] => [
  { id: `${prefix}Title`, name: 'title', type: 'singleLineText', isPrimary: true },
  { id: `${prefix}Context`, name: 'context', type: 'longText' },
  { id: `${prefix}Updated`, name: 'updated_at', type: 'lastModifiedTime', isComputed: true },
  { id: `${prefix}Deleted`, name: 'deleted_at', type: 'date' },
  { id: `${prefix}Active`, name: 'is_active', type: 'checkbox' },
  { id: `${prefix}Id`, name: 'id', type: 'autoNumber', isComputed: true },
];
const link = (
  id: string,
  name: string,
  foreignTableId: string,
  relationship: NonNullable<ISchemaField['link']>['relationship'],
  isOneWay = false
): ISchemaField => ({ id, name, type: 'link', link: { foreignTableId, relationship, isOneWay } });

const baseId = 'bseDataCentre';
export const DATA_CENTRE_TABLES: ITableSchema[] = [
  {
    id: 'tblGoals',
    name: 'goals',
    baseId,
    fields: [
      ...common('g'),
      { id: 'gDeadline', name: 'deadline', type: 'date' },
      link('gProjects', 'projects', 'tblProjects', 'oneMany'),
      link('gRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany', true),
    ],
  },
  {
    id: 'tblProjects',
    name: 'projects',
    baseId,
    fields: [
      ...common('p'),
      link('pTasks', 'tasks', 'tblTasks', 'oneMany'),
      {
        id: 'pProgress',
        name: 'progress',
        type: 'singleSelect',
        choices: ['backlog', 'preparing', 'in-progress', 'finalized', 'onhold', 'cancelled'],
      },
      link('pGoal', 'belong_goals', 'tblGoals', 'manyOne'),
      link('pLead', 'lead_by', 'tblContacts', 'manyOne'),
      link('pRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany', true),
    ],
  },
  {
    id: 'tblTasks',
    name: 'tasks',
    baseId,
    fields: [
      ...common('t'),
      {
        id: 'tProgress',
        name: 'progress',
        type: 'singleSelect',
        choices: ['backlog', 'in-progress', 'finished_reviewing', 'onhold', 'cancelled', 'closed'],
      },
      {
        id: 'tPriority',
        name: 'priority',
        type: 'singleSelect',
        choices: ['urgent', 'important', 'prioritise', 'normal', 'can wait'],
      },
      link('tAssigned', 'assigned_to', 'tblContacts', 'manyOne'),
      { id: 'tStarted', name: 'started_at', type: 'date' },
      { id: 'tFinished', name: 'finished_at', type: 'date' },
      link('tProject', 'belong_project', 'tblProjects', 'manyOne'),
      link('tRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany', true),
    ],
  },
  {
    id: 'tblContacts',
    name: 'contacts',
    baseId,
    fields: [
      ...common('c'),
      { id: 'cEmail', name: 'email', type: 'singleLineText' },
      { id: 'cApiKey', name: 'api_key', type: 'singleLineText' },
      link('cTasks', 'tasks', 'tblTasks', 'oneMany'),
      link('cProjects', 'projects', 'tblProjects', 'oneMany'),
    ],
  },
  {
    id: 'tblKnowledges',
    name: 'knowledges',
    baseId,
    fields: [
      ...common('k'),
      link('kParent', 'knowledge_parent', 'tblKnowledges', 'manyOne'),
      link('kChildren', 'knowledges', 'tblKnowledges', 'oneMany'),
      link('kRelated', 'related_knowledge', 'tblKnowledges', 'manyMany'),
    ],
  },
  { id: 'tblSystemInfo', name: 'system_info', baseId, fields: common('s') },
];
