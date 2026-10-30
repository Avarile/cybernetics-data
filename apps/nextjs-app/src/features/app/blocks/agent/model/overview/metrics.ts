import type { IAgentOverviewVo, IOverviewNode, ISearchTone } from '@teable/openapi';
import { money } from '../format';
import type { IMetric } from '../metrics';

type INodes = IOverviewNode[];

const of = (nodes: INodes, table: string) => nodes.filter((n) => n.table === table && n.recordId);
const toned = (nodes: INodes, tone: ISearchTone) => nodes.filter((n) => n.tone === tone).length;
const sum = (nodes: INodes) => nodes.reduce((s, n) => s + Math.abs(n.amount ?? 0), 0);
const metric = (k: string, v: number | string, tone: ISearchTone = 'ink', s?: string): IMetric => ({
  k,
  v,
  tone,
  ...(s ? { s } : {}),
});

function work(vo: IAgentOverviewVo): IMetric[] {
  const tasks = of(vo.nodes, 'tasks');
  const live = tasks.length - toned(tasks, 'faint');
  const late = vo.nodes.filter((n) => n.alert).length;
  return [
    metric('GOALS', of(vo.nodes, 'goals').length),
    metric('PROJECTS', of(vo.nodes, 'projects').length),
    metric('TASKS', tasks.length),
    metric('IN PROGRESS', toned(tasks, 'route'), 'route'),
    metric('BACKLOG', toned(tasks, 'dim'), 'dim'),
    metric('ON HOLD', toned(tasks, 'caution'), 'caution', late ? `${late} LATE` : undefined),
    metric('DONE', live ? `${Math.round((toned(tasks, 'ink') / live) * 100)}%` : '—'),
  ];
}

function knowledge(vo: IAgentOverviewVo): IMetric[] {
  const entries = of(vo.nodes, 'knowledges');
  const untyped = entries.filter((n) => n.parent?.startsWith('hub:')).length;
  return [
    metric('ENTRIES', entries.length),
    metric('TYPES', of(vo.nodes, 'knowledge_type').length),
    metric('UPDATED 7D', toned(entries, 'route'), 'route'),
    metric('UPDATED 30D', toned(entries, 'target'), 'target'),
    metric('OLDER', toned(entries, 'ink'), 'dim'),
    metric('RELATED LINKS', vo.links.length, 'target'),
    metric('UNTYPED', untyped, untyped ? 'caution' : 'ink'),
  ];
}

function people(vo: IAgentOverviewVo): IMetric[] {
  const unassigned = vo.counts['tasks.unplaced'] ?? 0;
  return [
    metric('PEOPLE', of(vo.nodes, 'contacts').length),
    metric('TYPES', of(vo.nodes, 'contact_type').length),
    metric('PROFESSIONS', of(vo.nodes, 'contact_profession').length),
    metric('COMPANIES', of(vo.nodes, 'companies').length),
    metric('PROJECTS LED', of(vo.nodes, 'projects').length, 'route'),
    metric('OPEN TASKS', of(vo.nodes, 'tasks').length, 'route'),
    metric('UNASSIGNED', unassigned, unassigned ? 'caution' : 'ink'),
  ];
}

function finance(vo: IAgentOverviewVo): IMetric[] {
  const txns = of(vo.nodes, 'finance_Transactions');
  const spent = sum(txns.filter((n) => n.tone === 'route'));
  const income = sum(txns.filter((n) => n.tone === 'target'));
  const net = income - spent;
  return [
    metric('TRANSACTIONS 90D', txns.length),
    metric('SPENT', money(spent), 'route'),
    metric('INCOME', money(income), 'target'),
    metric('NET', money(net), net < 0 ? 'caution' : 'ink'),
    metric('TRANSFERS', toned(txns, 'dim'), 'dim'),
    metric('PAYEES', of(vo.nodes, 'finance_Payees').length),
    metric('CATEGORIES', of(vo.nodes, 'finance_Categories').length),
  ];
}

const byDataset = { work, knowledge, people, finance };

/**
 * The readout's numbers for a dataset (overview design §5.2), from everything the server sent:
 * only the chart sees the graph the draw budget reduced.
 */
export const overviewMetrics = (vo: IAgentOverviewVo): IMetric[] => byDataset[vo.dataset](vo);
