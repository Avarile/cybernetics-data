import { FieldType } from '@teable/core';
import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@/test-utils';
import { SchemaPreview } from './components/SchemaPreview';
import type { IWizardState } from './state';
import { createInitialState, guessCurrency, wizardReducer } from './state';
import { ChoosePacksStep, pendingBridges } from './steps/ChoosePacksStep';

const text = (key: string) => ({ key, name: key, type: FieldType.SingleLineText });
const link = (key: string, linkTo: string) => ({ key, name: key, type: FieldType.Link, linkTo });

const catalog: ISchemaPackCatalogVo = {
  packs: [
    {
      id: 'progress',
      version: 1,
      tables: [
        { key: 'goals', name: 'goals', optional: false, fields: [text('title')] },
        {
          key: 'tasks',
          name: 'tasks',
          optional: false,
          fields: [text('title'), link('goal', 'goals')],
        },
        {
          key: 'project_frameworks',
          name: 'project_frameworks',
          optional: true,
          fields: [text('title')],
        },
      ],
    },
    {
      id: 'people',
      version: 1,
      tables: [{ key: 'contacts', name: 'contacts', optional: false, fields: [text('title')] }],
    },
    {
      id: 'knowledge',
      version: 1,
      tables: [{ key: 'knowledges', name: 'knowledges', optional: false, fields: [text('title')] }],
    },
    {
      id: 'finance',
      version: 1,
      tables: [
        {
          key: 'finance_Accounts',
          name: 'finance_Accounts',
          optional: false,
          fields: [text('Name')],
        },
      ],
    },
  ],
  bridges: [
    {
      packs: ['progress', 'people'],
      fields: [{ table: 'tasks', field: link('assigned_to', 'contacts') }],
    },
  ],
  currencies: ['USD'],
};

const optionalOf = (pack: SchemaPackId) =>
  catalog.packs
    .find((p) => p.id === pack)!
    .tables.filter((t) => t.optional)
    .map((t) => t.key);

afterEach(cleanup);

describe('wizard state', () => {
  const initial: IWizardState = { ...createInitialState({ baseName: 'Mine' }), step: 'choose' };

  it('switches a pack’s default optional tables on and off with the pack', () => {
    const on = wizardReducer(initial, { type: 'togglePack', pack: 'progress', optionalOf });
    expect(on.packs).toEqual(['progress']);
    expect(on.optionalTables).toEqual(['project_frameworks']);
    const off = wizardReducer(on, { type: 'togglePack', pack: 'progress', optionalOf });
    expect(off.packs).toEqual([]);
    expect(off.optionalTables).toEqual([]);
  });

  it('keeps packs in catalog order and selects all', () => {
    const people = wizardReducer(initial, { type: 'togglePack', pack: 'people', optionalOf });
    const both = wizardReducer(people, { type: 'togglePack', pack: 'progress', optionalOf });
    expect(both.packs).toEqual(['progress', 'people']);
    const all = wizardReducer(initial, { type: 'selectAll', optionalOf });
    expect(all.packs).toEqual(['progress', 'people', 'knowledge', 'finance']);
  });

  it.each([
    ['en-AU', 'AUD'],
    ['en-GB', 'GBP'],
    ['de-DE', 'EUR'],
    ['fr', 'EUR'],
    ['ja', 'JPY'],
    ['zh-CN', 'CNY'],
    ['pt-BR', 'USD'],
  ])('guesses %s → %s', (locale, currency) => expect(guessCurrency(locale)).toBe(currency));
});

describe('bridges', () => {
  it('nudges only when exactly one side is picked', () => {
    expect(pendingBridges(catalog, [])).toEqual([]);
    expect(pendingBridges(catalog, ['progress'])).toEqual([
      { key: 'progress+people', missing: 'people' },
    ]);
    expect(pendingBridges(catalog, ['progress', 'people'])).toEqual([]);
  });

  it('draws a bridge dashed until both packs are picked', () => {
    const { rerender } = render(<SchemaPreview catalog={catalog} packs={[]} optionalTables={[]} />);
    const bridge = () => screen.getByTestId('bridge-tasks-contacts');
    expect(bridge().getAttribute('data-state')).toBe('hidden');
    rerender(<SchemaPreview catalog={catalog} packs={['progress']} optionalTables={[]} />);
    expect(bridge().getAttribute('data-state')).toBe('pending');
    expect(screen.getByTestId('node-project_frameworks').getAttribute('data-state')).toBe('ghost');
    rerender(
      <SchemaPreview
        catalog={catalog}
        packs={['progress', 'people']}
        optionalTables={['project_frameworks']}
      />
    );
    expect(bridge().getAttribute('data-state')).toBe('solid');
    expect(screen.getByTestId('node-project_frameworks').getAttribute('data-state')).toBe('on');
  });
});

describe('ChoosePacksStep', () => {
  const setup = (packs: SchemaPackId[]) => {
    const onToggle = vi.fn();
    const onContinue = vi.fn();
    render(
      <ChoosePacksStep
        catalog={catalog}
        packs={packs}
        optionalTables={[]}
        onToggle={onToggle}
        onSelectAll={vi.fn()}
        onContinue={onContinue}
      />
    );
    return { onToggle, onContinue };
  };

  it('toggles a pack from its card and from the number keys', () => {
    const { onToggle } = setup([]);
    const cards = screen.getAllByRole('checkbox');
    expect(cards).toHaveLength(4);
    fireEvent.click(cards[0]);
    expect(onToggle).toHaveBeenLastCalledWith('progress');
    fireEvent.keyDown(window, { key: '4' });
    expect(onToggle).toHaveBeenLastCalledWith('finance');
  });

  it('marks selection for assistive tech and gates Continue', () => {
    setup(['people']);
    const cards = screen.getAllByRole('checkbox');
    expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('cannot continue with nothing picked', () => {
    const { onContinue } = setup([]);
    const continueButton = screen.getAllByRole('button').find((b) => b.hasAttribute('disabled'));
    expect(continueButton).toBeDefined();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onContinue).not.toHaveBeenCalled();
  });
});
