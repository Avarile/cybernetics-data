import type { ISearchSchema } from '../../ports';
import type { ISchemaField, ITableSchema } from '../../search/schema';

/**
 * The data-centre base as read on 2026-10-30 from the K3s copy (overview design §2.4), trimmed to
 * the fields the overview reads. Ids are readable; links keep their twins.
 */
const baseId = 'bseDataCentre';
const common = (p: string): ISchemaField[] => [
  { id: `${p}Title`, name: 'title', type: 'singleLineText', isPrimary: true },
  { id: `${p}Updated`, name: 'updated_at', type: 'lastModifiedTime', isComputed: true },
  { id: `${p}Created`, name: 'created_at', type: 'createdTime', isComputed: true },
  { id: `${p}Deleted`, name: 'deleted_at', type: 'date' },
  { id: `${p}Active`, name: 'is_active', type: 'checkbox' },
];
const link = (
  id: string,
  name: string,
  foreignTableId: string,
  relationship: NonNullable<ISchemaField['link']>['relationship'],
  symmetricFieldId?: string
): ISchemaField => ({
  id,
  name,
  type: 'link',
  link: { foreignTableId, relationship, isOneWay: !symmetricFieldId, symmetricFieldId },
});
const select = (id: string, name: string, choices: string[]): ISchemaField => ({
  id,
  name,
  type: 'singleSelect',
  choices,
});
const table = (id: string, name: string, fields: ISchemaField[]): ITableSchema => ({
  id,
  name,
  baseId,
  fields,
});

export const DATA_CENTRE_SCHEMA: ITableSchema[] = [
  table('tblGoals', 'goals', [
    ...common('g'),
    { id: 'gDeadline', name: 'deadline', type: 'date' },
    link('gProjects', 'projects', 'tblProjects', 'oneMany', 'pGoal'),
    link('gRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany'),
  ]),
  table('tblProjects', 'projects', [
    ...common('p'),
    select('pProgress', 'progress', [
      'backlog',
      'preparing',
      'initiated',
      'in-progress',
      'finished-reviewing',
      'finalized',
      'onhold',
      'cancelled',
    ]),
    link('pGoal', 'belong_goals', 'tblGoals', 'manyOne', 'gProjects'),
    link('pLead', 'lead_by', 'tblContacts', 'manyOne', 'cProjects'),
    link('pTasks', 'tasks', 'tblTasks', 'oneMany', 'tProject'),
    link('pRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany'),
  ]),
  table('tblTasks', 'tasks', [
    ...common('t'),
    select('tProgress', 'progress', [
      'backlog',
      'in-progress',
      'finished_reviewing',
      'finished_validating',
      'onhold',
      'cancelled',
      'closed',
    ]),
    select('tPriority', 'priority', ['urgent', 'important', 'prioritise', 'normal', 'can wait']),
    { id: 'tStarted', name: 'started_at', type: 'date' },
    { id: 'tFinished', name: 'finished_at', type: 'date' },
    link('tProject', 'belong_project', 'tblProjects', 'manyOne', 'pTasks'),
    link('tAssigned', 'assigned_to', 'tblContacts', 'manyOne', 'cTasks'),
    link('tRefer', 'refer_knowledge', 'tblKnowledges', 'manyMany'),
  ]),
  table('tblContacts', 'contacts', [
    ...common('c'),
    { id: 'cEmail', name: 'email', type: 'singleLineText' },
    link('cType', 'contact_type', 'tblContactType', 'manyOne', 'ctContacts'),
    link('cProfession', 'contact_profession', 'tblProfession', 'manyOne', 'prContacts'),
    link('cCompany', 'contact_company', 'tblCompanies', 'manyOne', 'coContacts'),
    link('cTasks', 'tasks', 'tblTasks', 'oneMany', 'tAssigned'),
    link('cProjects', 'projects', 'tblProjects', 'oneMany', 'pLead'),
  ]),
  table('tblContactType', 'contact_type', [
    ...common('ct'),
    link('ctContacts', 'contacts', 'tblContacts', 'oneMany', 'cType'),
  ]),
  table('tblProfession', 'contact_profession', [
    ...common('pr'),
    link('prContacts', 'contacts', 'tblContacts', 'oneMany', 'cProfession'),
  ]),
  table('tblCompanies', 'companies', [
    ...common('co'),
    link('coContacts', 'contacts', 'tblContacts', 'oneMany', 'cCompany'),
  ]),
  table('tblKnowledges', 'knowledges', [
    ...common('k'),
    link('kType', 'knowledge_type', 'tblKnowledgeType', 'manyOne', 'ktKnowledges'),
    link('kParent', 'knowledge_parent', 'tblKnowledges', 'manyOne', 'kChildren'),
    link('kChildren', 'knowledges', 'tblKnowledges', 'oneMany', 'kParent'),
    link('kRelated', 'related_knowledge', 'tblKnowledges', 'manyMany', 'kRelated'),
  ]),
  table('tblKnowledgeType', 'knowledge_type', [
    ...common('kt'),
    { id: 'ktCredentials', name: 'credentials', type: 'singleLineText' },
    link('ktParent', 'parent_type', 'tblKnowledgeType', 'manyOne', 'ktChildren'),
    link('ktChildren', 'child_types', 'tblKnowledgeType', 'oneMany', 'ktParent'),
    link('ktKnowledges', 'knowledges', 'tblKnowledges', 'oneMany', 'kType'),
  ]),
  table('tblCategories', 'finance_Categories', [
    { id: 'fcName', name: 'Name', type: 'singleLineText', isPrimary: true },
    select('fcType', 'Type', ['Income', 'Expense']),
    link('fcParent', 'Parent Category', 'tblCategories', 'manyOne', 'fcChildren'),
    link('fcChildren', 'finance_Categories', 'tblCategories', 'oneMany', 'fcParent'),
  ]),
  table('tblTransactions', 'finance_Transactions', [
    { id: 'ftDescription', name: 'Description', type: 'singleLineText', isPrimary: true },
    { id: 'ftDate', name: 'Date', type: 'date' },
    select('ftType', 'Type', ['Income', 'Expense', 'Transfer']),
    { id: 'ftAmount', name: 'Amount', type: 'number' },
    { id: 'ftReceipt', name: 'Receipt', type: 'attachment' },
    link('ftAccount', 'Account', 'tblAccounts', 'manyOne', 'faTransactions'),
    link('ftTransfer', 'Transfer Account', 'tblAccounts', 'manyOne', 'faLinked'),
    link('ftCategory', 'Category', 'tblCategories', 'manyOne', 'fcTransactions'),
    link('ftPayee', 'Payee', 'tblPayees', 'manyOne', 'fpTransactions'),
  ]),
  table('tblPayees', 'finance_Payees', [
    { id: 'fpName', name: 'Name', type: 'singleLineText', isPrimary: true },
    link('fpTransactions', 'finance_Transactions', 'tblTransactions', 'oneMany', 'ftPayee'),
  ]),
  table('tblAccounts', 'finance_Accounts', [
    { id: 'faName', name: 'Name', type: 'singleLineText', isPrimary: true },
    link('faTransactions', 'finance_Transactions', 'tblTransactions', 'oneMany', 'ftAccount'),
  ]),
  table('tblSystemInfo', 'system_info', common('s')),
];

export const dataCentreSchema = (
  tables = DATA_CENTRE_SCHEMA,
  excluded: string[] = []
): ISearchSchema => ({ baseId, baseName: 'data-centre', tables, excluded: new Set(excluded) });
