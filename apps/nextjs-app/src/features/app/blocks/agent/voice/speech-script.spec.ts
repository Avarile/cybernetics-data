/* eslint-disable sonarjs/no-duplicate-string */
import en from '@teable/common-i18n/src/locales/en/common.json';
import zh from '@teable/common-i18n/src/locales/zh/common.json';
import type { UIMessage } from 'ai';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  buildSpeechScript,
  classifyBlock,
  defaultDescriber,
  speakableText,
  splitLong,
  splitSentences,
} from './speech-script';

const reply = (...parts: object[]): UIMessage =>
  ({ id: 'a1', role: 'assistant', parts }) as unknown as UIMessage;
const text = (value: string, state?: 'streaming' | 'done') => ({
  type: 'text',
  text: value,
  state,
});
const said = (message: UIMessage, final = true, error = false) =>
  buildSpeechScript(message, { final, error }).map((s) => s.text);
const ids = (message: UIMessage, final = true) =>
  buildSpeechScript(message, { final }).map((s) => s.id);

const table = '| Name | Revenue |\n|---|---|\n| Acme | 12,400 |';

describe('speech script', () => {
  it('speaks prose sentence by sentence', () => {
    const message = reply(text('Hello there. How are you?'));
    expect(said(message)).toEqual(['Hello there.', 'How are you?']);
    expect(ids(message)).toEqual(['0:0:0', '0:0:1']);
  });

  it('points at tables and code instead of reading them', () => {
    const md = [
      'Here are your top customers this quarter.',
      table,
      'The query I used:',
      '```sql\nselect * from customers;\n```',
      'Acme leads by 40%. Want the full list?',
    ].join('\n\n');
    expect(said(reply(text(md, 'done')))).toEqual([
      'Here are your top customers this quarter.',
      'Please take a look at this table.',
      'The query I used:',
      'Please take a look at this code.',
      'Acme leads by 40%.',
      'Want the full list?',
    ]);
  });

  it('names diagrams, formulas and images, and skips raw HTML', () => {
    const md = [
      '```mermaid\ngraph TD; A-->B\n```',
      '$$\nx^2\n$$',
      '![chart](https://example.com/c.png)',
      '<div>hidden</div>',
      'Done.',
    ].join('\n\n');
    expect(said(reply(text(md)))).toEqual([
      'Please take a look at this diagram.',
      'Please take a look at this formula.',
      'Please take a look at this image.',
      'Done.',
    ]);
  });

  it('says one plural pointer for blocks of a kind in a row', () => {
    const message = reply(text(`${table}\n\n${table}\n\nThat is all.`));
    expect(said(message)).toEqual(['Please take a look at these 2 tables.', 'That is all.']);
    expect(ids(message)[0]).toBe('0:0');
  });

  it('never speaks a table that is still streaming', () => {
    expect(said(reply(text('Here are\n\n| Name | To', 'streaming')), false)).toEqual(['Here are.']);
  });

  it('waits for the next block when it may be one more of the same kind', () => {
    const growing = reply(text(`${table}\n\n| B |\n|---|`, 'streaming'));
    expect(said(growing, false)).toEqual([]);
    const thenProse = reply(text(`${table}\n\nAcme le`, 'streaming'));
    expect(said(thenProse, false)).toEqual(['Please take a look at this table.']);
    const done = reply(text(`${table}\n\n| B |\n|---|\n| 1 |`, 'done'));
    expect(buildSpeechScript(done, { final: false })).toEqual([
      { id: '0:0', kind: 'pointer', text: 'Please take a look at these 2 tables.' },
    ]);
  });

  it('settles the sentences of a growing paragraph one by one, with stable ids', () => {
    const step = (value: string, final = false) =>
      buildSpeechScript(reply(text(value, final ? 'done' : 'streaming')), { final });
    expect(step('First one. Second')).toEqual([{ id: '0:0:0', kind: 'prose', text: 'First one.' }]);
    expect(step('First one. Second one. Thi').map((s) => s.id)).toEqual(['0:0:0', '0:0:1']);
    expect(step('First one. Second one. Third', true).map((s) => s.text)).toEqual([
      'First one.',
      'Second one.',
      'Third.',
    ]);
  });

  it('treats a text part as complete once its state is done or a later part exists', () => {
    expect(said(reply(text('Almost there', 'done')), false)).toEqual(['Almost there.']);
    const withTool = reply(text('Let me check'), {
      type: 'tool-sql_read',
      toolCallId: 'c1',
      state: 'input-available',
    });
    expect(said(withTool, false)).toEqual(['Let me check.']);
  });

  it('speaks text around tool steps and skips reasoning and the steps themselves', () => {
    const message = reply(
      { type: 'reasoning', text: 'Thinking about it.' },
      text('Let me check.'),
      { type: 'tool-sql_read', toolCallId: 'c1', state: 'output-available', output: {} },
      text('Found 3 rows.')
    );
    expect(said(message)).toEqual(['Let me check.', 'Found 3 rows.']);
    expect(ids(message)).toEqual(['1:0:0', '3:0:0']);
  });

  it('asks the admin to look at approval forms once the stream has ended', () => {
    const ask = (id: string) => ({
      type: 'tool-delete_records',
      toolCallId: id,
      state: 'approval-requested',
      approval: { id: `ap-${id}` },
    });
    const one = reply(text('I will delete it.'), ask('c1'));
    expect(said(one, false)).toEqual(['I will delete it.']);
    expect(said(one)).toEqual([
      'I will delete it.',
      'I need your approval for this. Please take a look at this form.',
    ]);
    expect(said(reply(ask('c1'), ask('c2')))).toEqual([
      'I need your approval for these. Please take a look at these 2 forms.',
    ]);
  });

  it('ends with the error pointer when the turn failed', () => {
    expect(said(reply(text('Working on it.')), true, true)).toEqual([
      'Working on it.',
      'Something went wrong. Please take a look at the screen.',
    ]);
  });

  it('uses the given pointer words', () => {
    const script = buildSpeechScript(reply(text(table)), {
      final: true,
      pointer: (kind, count) => `看 ${kind} ${count}`,
    });
    expect(script.map((s) => s.text)).toEqual(['看 table 1']);
  });

  it('speaks list items and headings as sentences', () => {
    const md = '## Results\n\n- first item\n- second item\n\n1. step one\n2. step two';
    expect(said(reply(text(md)))).toEqual([
      'Results.',
      'first item.',
      'second item.',
      'step one.',
      'step two.',
    ]);
  });
});

describe('speakable text', () => {
  it('turns markdown into words', () => {
    expect(speakableText('See **the docs** at [our site](https://x.io) or https://y.io/a')).toBe(
      'See the docs at our site or the link on screen'
    );
    expect(speakableText('Updated `agent_skills` and `focus_base_id`')).toBe(
      'Updated agent skills and focus base id'
    );
    expect(speakableText('Use `' + 'x'.repeat(41) + '` here')).toBe('Use this code here');
    expect(speakableText('> - [x] Done 🎉 _really_')).toBe('Done really');
    expect(speakableText('keep snake_case_words')).toBe('keep snake_case_words');
  });
});

describe('sentences', () => {
  it('cuts after an end mark followed by space, and CJK marks at once', () => {
    expect(splitSentences('One. Two', false)).toEqual(['One.']);
    expect(splitSentences('One. Two', true)).toEqual(['One.', 'Two.']);
    expect(splitSentences('Version 2.5 is out', false)).toEqual([]);
    expect(splitSentences('你好。今天怎么样？还', false)).toEqual(['你好。', '今天怎么样？']);
    expect(splitSentences('你好', true)).toEqual(['你好。']);
  });

  it('splits a long sentence at commas, then spaces', () => {
    const long = Array.from({ length: 12 }, (_, i) => `clause number ${i} with a few words`).join(
      ', '
    );
    const pieces = splitLong(long, 180);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 180)).toBe(true);
    expect(pieces.join(' ')).toBe(long);
    expect(splitLong('short', 180)).toEqual(['short']);
  });
});

describe('block kinds', () => {
  it('reads the kind from how a block starts', () => {
    expect(classifyBlock(table)).toBe('table');
    expect(classifyBlock('Name | Total\n--- | ---\nA | 1')).toBe('table');
    expect(classifyBlock('```ts\nconst a = 1;\n```')).toBe('code');
    expect(classifyBlock('    indented code')).toBe('code');
    expect(classifyBlock('```mermaid\ngraph TD\n```')).toBe('diagram');
    expect(classifyBlock('$$\nx\n$$')).toBe('formula');
    expect(classifyBlock('![alt](u.png)')).toBe('image');
    expect(classifyBlock('<details>x</details>')).toBe('html');
    expect(classifyBlock('Plain words | with a pipe')).toBe('prose');
  });
});

describe('search and question pointers (cockpit design §8)', () => {
  const plan = {
    id: 'srch1',
    intent: 'project_progress',
    summary: 's',
    baseId: 'b',
    missing: [],
    steps: [
      {
        id: 's1',
        table: { id: 'p', name: 'projects' },
        role: 'anchor',
        purpose: '',
        source: { kind: 'search', text: 'x' },
        limit: 10,
      },
      {
        id: 's2',
        table: { id: 't', name: 'tasks' },
        role: 'related',
        purpose: '',
        source: { kind: 'follow', from: [] },
        limit: 50,
      },
      {
        id: 's3',
        table: { id: 'c', name: 'contacts' },
        role: 'actor',
        purpose: '',
        source: { kind: 'follow', from: [] },
        limit: 50,
      },
    ],
  };
  const reply = (status: string, extra: object[] = []) =>
    ({
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'data-search-plan',
          id: 'srch1',
          data: {
            searchId: 'srch1',
            plan,
            status,
            states: [
              { stepId: 's1', status: 'done', found: 1, shown: 1 },
              {
                stepId: 's2',
                status: status === 'done' ? 'done' : 'running',
                found: 14,
                shown: 14,
              },
              { stepId: 's3', status: 'pending', found: 0, shown: 0 },
            ],
          },
        },
        ...extra,
      ],
    }) as unknown as UIMessage;

  it('says what a finished search found, once it has finished', () => {
    expect(buildSpeechScript(reply('running'), { final: false })).toEqual([]);
    expect(buildSpeechScript(reply('done'), { final: false })).toEqual([
      {
        id: '0:board',
        kind: 'pointer',
        text: "I found 1 project and 14 tasks. They're on the board.",
      },
    ]);
  });

  it('reads a question back with up to three options', () => {
    const clarify = {
      type: 'data-clarify',
      id: 'clr1',
      data: {
        clarifyId: 'clr1',
        question: 'Which project?',
        reason: 'anchor',
        options: [
          { id: 'o1', label: 'Cockpit' },
          { id: 'o2', label: 'Theme' },
        ],
      },
    };
    const script = buildSpeechScript(reply('needs_choice', [clarify]), { final: true });
    expect(script).toEqual([
      {
        id: '1:choice',
        kind: 'pointer',
        text: 'Which project? Cockpit or Theme? Please pick one of these 2, or just say it.',
      },
    ]);
  });

  it('asks for an answer, not a pick, when the question has no options', () => {
    expect(defaultDescriber.choice('Which goal do you mean?', [])).toBe(
      'Which goal do you mean? Please say or type your answer.'
    );
  });

  it('has words for no, one and several options in the app languages', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      resources: { en: { common: en }, zh: { common: zh } },
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
    const say = (lng: string, count: number) =>
      i18n.getFixedT(lng, 'common')('agent.voice.look.choice', {
        question: 'Which?',
        options: count ? 'A or B?' : '',
        count,
      });
    expect(say('en', 0)).toBe('Which? Please say or type your answer.');
    expect(say('zh', 0)).toBe('Which? 请说出或输入你的回答。');
    // a language without its own words falls back to English, zero form included
    expect(say('de', 0)).toBe('Which? Please say or type your answer.');
    expect(say('en', 1)).toBe('Which? A or B? Please pick it, or just say it.');
    expect(say('en', 2)).toBe('Which? A or B? Please pick one of these 2, or just say it.');
    for (const lng of ['en', 'zh', 'de']) expect(say(lng, 0)).not.toMatch(/0/);
  });
});

describe('searching phase (cockpit design §8)', () => {
  it('says which table a running search is on', async () => {
    const { searchingTable, voicePhase } = await import('./useVoiceConversation');
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'data-search-plan',
          data: {
            searchId: 's',
            status: 'running',
            plan: {
              steps: [
                { id: 's1', table: { name: 'projects' } },
                { id: 's2', table: { name: 'tasks' } },
              ],
            },
            states: [
              { stepId: 's1', status: 'done', found: 1, shown: 1 },
              { stepId: 's2', status: 'running', found: 0, shown: 0 },
            ],
          },
        },
      ],
    } as unknown as UIMessage;
    expect(searchingTable(message)).toBe('tasks');
    const listener = { status: 'paused', draft: '', interim: '' } as never;
    const base = {
      enabled: true,
      busy: true,
      speaking: false,
      toolRunning: true,
      awaitingApproval: false,
      hidden: false,
      listener,
    };
    expect(voicePhase({ ...base, searching: 'tasks' })).toBe('searching');
    expect(voicePhase(base)).toBe('working');
  });
});
