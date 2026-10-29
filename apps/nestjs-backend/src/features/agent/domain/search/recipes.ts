import type { ISearchIntent, ISearchStepRole } from './search.types';

/** A link a recipe step follows: from an earlier step's records through a field named so. */
export type IRecipeLink = [stepId: string, field: string];

export interface IRecipeStep {
  id: string;
  /** Table name; resolved against the live schema when the plan is made. */
  table: string;
  role: ISearchStepRole;
  purpose: string;
  /** Records in the link cells of earlier steps (forward links). */
  follow?: IRecipeLink[];
  /** Records of this table whose link field (named here) points at earlier steps' records. */
  reverse?: IRecipeLink[];
  /** Number fields summed over the step's records, for the model (e.g. Amount). */
  totals?: string[];
}

export interface IRecipe {
  intent: ISearchIntent;
  /** One line for the prompt's intent list. */
  hint: string;
  /** The question is about one record of the anchor table: several close matches need a choice. */
  single: boolean;
  /** The first step is the anchor; `table` is the default anchor table. */
  steps: IRecipeStep[];
}

/**
 * The intent catalog (cockpit design §6.2). Tables and fields are named, never ids, so the plan
 * follows the live schema; anything missing is skipped and reported in the plan's `missing`.
 */
export const RECIPES: IRecipe[] = [
  {
    intent: 'project_progress',
    hint: 'how a project is going: its tasks, the people on it, its knowledge and goal',
    single: true,
    steps: [
      { id: 's1', table: 'projects', role: 'anchor', purpose: 'the project' },
      {
        id: 's2',
        table: 'tasks',
        role: 'related',
        purpose: 'tasks of the project',
        follow: [['s1', 'tasks']],
      },
      {
        id: 's3',
        table: 'contacts',
        role: 'actor',
        purpose: 'people on the tasks and the project lead',
        follow: [
          ['s2', 'assigned_to'],
          ['s1', 'lead_by'],
        ],
      },
      {
        id: 's4',
        table: 'knowledges',
        role: 'related',
        purpose: 'knowledge the project and its tasks refer to',
        follow: [
          ['s1', 'refer_knowledge'],
          ['s2', 'refer_knowledge'],
        ],
      },
      {
        id: 's5',
        table: 'goals',
        role: 'context',
        purpose: 'the goal the project serves',
        follow: [['s1', 'belong_goals']],
      },
    ],
  },
  {
    intent: 'goal_progress',
    hint: 'how a goal is going: its projects, their tasks, people and knowledge',
    single: true,
    steps: [
      { id: 's1', table: 'goals', role: 'anchor', purpose: 'the goal' },
      {
        id: 's2',
        table: 'projects',
        role: 'related',
        purpose: 'projects of the goal',
        follow: [['s1', 'projects']],
      },
      {
        id: 's3',
        table: 'tasks',
        role: 'related',
        purpose: 'tasks of those projects',
        follow: [['s2', 'tasks']],
      },
      {
        id: 's4',
        table: 'contacts',
        role: 'actor',
        purpose: 'people on the tasks and project leads',
        follow: [
          ['s3', 'assigned_to'],
          ['s2', 'lead_by'],
        ],
      },
      {
        id: 's5',
        table: 'knowledges',
        role: 'related',
        purpose: 'knowledge the goal, its projects and tasks refer to',
        follow: [
          ['s1', 'refer_knowledge'],
          ['s2', 'refer_knowledge'],
          ['s3', 'refer_knowledge'],
        ],
      },
    ],
  },
  {
    intent: 'task_lookup',
    hint: 'one task: its project, the person on it and its knowledge',
    single: true,
    steps: [
      { id: 's1', table: 'tasks', role: 'anchor', purpose: 'the task' },
      {
        id: 's2',
        table: 'projects',
        role: 'context',
        purpose: 'the project of the task',
        follow: [['s1', 'belong_project']],
      },
      {
        id: 's3',
        table: 'contacts',
        role: 'actor',
        purpose: 'who the task is assigned to',
        follow: [['s1', 'assigned_to']],
      },
      {
        id: 's4',
        table: 'knowledges',
        role: 'related',
        purpose: 'knowledge the task refers to',
        follow: [['s1', 'refer_knowledge']],
      },
    ],
  },
  {
    intent: 'person_work',
    hint: 'what a person works on: their tasks and projects',
    single: true,
    steps: [
      { id: 's1', table: 'contacts', role: 'anchor', purpose: 'the person' },
      {
        id: 's2',
        table: 'tasks',
        role: 'related',
        purpose: 'tasks assigned to them',
        follow: [['s1', 'tasks']],
      },
      {
        id: 's3',
        table: 'projects',
        role: 'related',
        purpose: 'projects they lead or have tasks in',
        follow: [
          ['s1', 'projects'],
          ['s2', 'belong_project'],
        ],
      },
    ],
  },
  {
    intent: 'knowledge_lookup',
    hint: 'what is written about a topic: knowledge entries, related ones, and the work that refers to them',
    single: false,
    steps: [
      { id: 's1', table: 'knowledges', role: 'anchor', purpose: 'entries about the topic' },
      {
        id: 's2',
        table: 'knowledges',
        role: 'related',
        purpose: 'related and parent entries',
        follow: [
          ['s1', 'related_knowledge'],
          ['s1', 'knowledge_parent'],
        ],
      },
      {
        id: 's3',
        table: 'projects',
        role: 'related',
        purpose: 'projects that refer to them',
        reverse: [['s1', 'refer_knowledge']],
      },
      {
        id: 's4',
        table: 'tasks',
        role: 'related',
        purpose: 'tasks that refer to them',
        reverse: [['s1', 'refer_knowledge']],
      },
    ],
  },
  {
    intent: 'finance_query',
    hint: 'money: transactions by date, category or payee, with totals (anchor usually a filter)',
    single: false,
    steps: [
      {
        id: 's1',
        table: 'finance_Transactions',
        role: 'anchor',
        purpose: 'the transactions asked about',
        totals: ['Amount'],
      },
      {
        id: 's2',
        table: 'finance_Categories',
        role: 'context',
        purpose: 'their categories',
        follow: [['s1', 'Category']],
      },
      {
        id: 's3',
        table: 'finance_Payees',
        role: 'actor',
        purpose: 'their payees',
        follow: [['s1', 'Payee']],
      },
    ],
  },
  {
    intent: 'record_lookup',
    hint: 'records of any other table (name the table): the records and what they link to',
    single: false,
    steps: [{ id: 's1', table: '', role: 'anchor', purpose: 'the records asked about' }],
  },
  {
    intent: 'action',
    hint: 'a change to make: find the record(s) to change first (name the table)',
    single: true,
    steps: [{ id: 's1', table: '', role: 'anchor', purpose: 'the record to change' }],
  },
  {
    intent: 'custom',
    hint: 'anything else: give the steps yourself (table, and how each step is reached)',
    single: false,
    steps: [],
  },
];

export const recipeFor = (intent: ISearchIntent) => RECIPES.find((r) => r.intent === intent);
