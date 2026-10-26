import { FieldType } from '@cybernetics/core';
import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@/test-utils';
import { BaseRail } from './components/BaseRail';
import { SchemaPreview } from './components/SchemaPreview';
import type { IWizardState } from './state';
import { canAdvance, createInitialState, guessCurrency, wizardReducer } from './state';
import { ChoosePacksStep } from './steps/ChoosePacksStep';

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

  it('gates the footer button on a pack, then on a plan and a name for a new base', () => {
    const into = { addingToBase: false, planReady: false };
    expect(canAdvance(initial, into)).toBe(false);
    expect(canAdvance({ ...initial, packs: ['people'] }, into)).toBe(true);
    const review = { ...initial, step: 'review' as const };
    expect(canAdvance(review, into)).toBe(false);
    expect(canAdvance(review, { ...into, planReady: true })).toBe(true);
    const unnamed = { ...review, baseName: '  ' };
    expect(canAdvance(unnamed, { ...into, planReady: true })).toBe(false);
    expect(canAdvance(unnamed, { addingToBase: true, planReady: true })).toBe(true);
    expect(canAdvance({ ...initial, step: 'building' }, { ...into, planReady: true })).toBe(false);
  });
});

describe('bridges', () => {
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

describe('the base rail', () => {
  const setup = (packs: SchemaPackId[], active?: SchemaPackId) => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const props = { catalog, active, onToggle, onSelect };
    const view = render(<BaseRail {...props} packs={packs} />);
    return { ...view, props, onToggle, onSelect };
  };

  it('shows the active pack’s contents without a click, and no map', () => {
    const { container } = setup([], 'people');
    expect(screen.getByText('packs.people.bullet1')).toBeTruthy();
    expect(screen.getByText('contacts')).toBeTruthy();
    expect(screen.queryByText('goals')).toBeNull();
    expect(container.querySelector('svg [data-testid^="node-"]')).toBeNull();
    expect(screen.queryByLabelText('back')).toBeNull();
  });

  it('falls back to the first pack when none is active', () => {
    setup([]);
    expect(screen.getByText('packs.progress.bullet1')).toBeTruthy();
  });

  it('adds or removes the shown pack', () => {
    const { rerender, props, onToggle } = setup([], 'people');
    fireEvent.click(screen.getByText('choose.addPack'));
    expect(onToggle).toHaveBeenLastCalledWith('people');
    rerender(<BaseRail {...props} packs={['people']} />);
    expect(screen.getByText('choose.removePack')).toBeTruthy();
  });

  it('switches packs from the strip', () => {
    const { onSelect, onToggle } = setup([], 'people');
    const tab = screen.getByLabelText('packs.knowledge.name');
    expect(tab.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('packs.people.name').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenLastCalledWith('knowledge');
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('ChoosePacksStep', () => {
  const setup = (packs: SchemaPackId[]) => {
    const onToggle = vi.fn();
    const onContinue = vi.fn();
    const onActivate = vi.fn();
    render(
      <ChoosePacksStep
        catalog={catalog}
        packs={packs}
        onToggle={onToggle}
        onActivate={onActivate}
        onContinue={onContinue}
      />
    );
    return { onToggle, onContinue, onActivate };
  };

  it('badges the recommended packs and activates on hover or focus without toggling', () => {
    const { onToggle, onActivate } = setup([]);
    expect(screen.getAllByText('choose.recommended')).toHaveLength(2);
    expect(screen.queryByText('choose.peek')).toBeNull();
    const cards = screen.getAllByRole('checkbox');
    fireEvent.mouseEnter(cards[2].parentElement!);
    expect(onActivate).toHaveBeenLastCalledWith('knowledge');
    fireEvent.focus(cards[3]);
    expect(onActivate).toHaveBeenLastCalledWith('finance');
    expect(onToggle).not.toHaveBeenCalled();
  });

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

  it('continues on Enter only once a pack is picked', () => {
    const { onContinue } = setup([]);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onContinue).not.toHaveBeenCalled();
    cleanup();
    const picked = setup(['people']);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(picked.onContinue).toHaveBeenCalled();
  });
});
