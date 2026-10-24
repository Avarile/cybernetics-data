import { FieldType } from '@cybernetics/core';
import type { ISchemaPackCatalogVo, ISchemaPackPlanVo } from '@teable/openapi';
import { vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@/test-utils';
import { BuildOptions } from './components/BuildOptions';
import { createInitialState, restoreState } from './state';
import { BuildingStep } from './steps/BuildingStep';
import { ChoosePacksStep } from './steps/ChoosePacksStep';
import { ReadyStep } from './steps/ReadyStep';
import { ReviewStep, reviewGroups } from './steps/ReviewStep';

const title = { key: 'title', name: 'title', type: FieldType.SingleLineText };
const catalog: ISchemaPackCatalogVo = {
  packs: (['progress', 'people', 'knowledge', 'finance'] as const).map((id) => ({
    id,
    version: 1,
    tables: [{ key: `${id}_t`, name: `${id}_t`, optional: false, fields: [title] }],
  })),
  bridges: [],
  currencies: ['USD'],
};

/** People added to a base that already holds Progress: the bridge lands on a Progress table. */
const plan: ISchemaPackPlanVo = {
  tables: [
    { key: 'contacts', name: 'contacts', pack: 'people', existing: false, fields: [] },
    {
      key: 'tasks',
      name: 'tasks',
      pack: 'progress',
      existing: true,
      fields: [{ key: 'assigned_to', name: 'assigned_to', type: FieldType.Link, bridge: 'people' }],
    },
  ],
  counts: { tables: 1, fields: 2, links: 1, seedRows: 0 },
};

afterEach(cleanup);

describe('restoreState', () => {
  it('keeps only values that are still valid', () => {
    expect(
      restoreState({
        step: 'review',
        packs: ['crm', 'people', 'progress'],
        optionalTables: ['auditlog', 42],
        baseName: '   ',
        icon: '🧭',
        timezone: 'Mars/Olympus',
        currency: 'BTC',
        starterRows: 'yes',
      })
    ).toEqual({
      step: 'review',
      packs: ['progress', 'people'],
      optionalTables: ['auditlog'],
      icon: '🧭',
    });
  });

  it('never resumes mid-build, and goes back to Choose when no pack survives', () => {
    expect(restoreState({ step: 'building', packs: ['finance'] }).step).toBe('review');
    // Personalise has folded into Review.
    expect(restoreState({ step: 'personalise', packs: ['finance'] }).step).toBe('review');
    expect(restoreState({ step: 'review', packs: ['crm'] }).step).toBe('choose');
    expect(restoreState({ step: 'nowhere' }).step).toBeUndefined();
  });

  it('ignores storage that is not an object', () => {
    expect(restoreState(null)).toEqual({});
    expect(restoreState('review')).toEqual({});
  });
});

describe('ReviewStep', () => {
  it('groups every pack the plan changes, not only the picked ones', () => {
    expect(reviewGroups(['people'], plan)).toEqual([
      { pack: 'people', picked: true },
      { pack: 'progress', picked: false },
    ]);
    expect(reviewGroups(['people'], undefined)).toEqual([{ pack: 'people', picked: true }]);
  });

  const props = { packs: ['people' as const], isLoading: false, onRetry: vi.fn() };

  it('marks the extra group and shows why the plan failed', () => {
    const { rerender } = render(<ReviewStep {...props} plan={plan} isError={false} />);
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(screen.getByText('review.inBase')).toBeTruthy();

    rerender(<ReviewStep {...props} plan={plan} isError errorMessage="tasks.priority is number" />);
    expect(screen.getByText('tasks.priority is number')).toBeTruthy();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.queryByTestId('plan-counts')).toBeNull();
  });

  it('lists tables as rows that open onto their fields, flagging ones already in the base', () => {
    render(<ReviewStep {...props} plan={plan} isError={false} />);
    expect(screen.getByTestId('plan-counts').textContent).toContain('review.statLinks');
    expect(screen.getByText('review.existing')).toBeTruthy();
    expect(screen.queryByText('assigned_to')).toBeNull();
    fireEvent.click(screen.getByText('tasks'));
    expect(screen.getByText('assigned_to')).toBeTruthy();
  });
});

describe('BuildingStep', () => {
  const props = {
    catalog,
    packs: ['people' as const],
    optionalTables: [],
    starterRows: true,
    onRetry: vi.fn(),
    onBack: vi.fn(),
  };

  it('walks one line through the phases, and ticks them only once the server is done', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<BuildingStep {...props} done={false} />);
      expect(screen.getByText('building.tables')).toBeTruthy();
      expect(screen.queryByText('building.links')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      // Holds on the last phase instead of looping, and says it is slow.
      expect(screen.getByText('building.seeds')).toBeTruthy();
      expect(screen.getByText('building.slow')).toBeTruthy();

      rerender(<BuildingStep {...props} done />);
      expect(screen.getAllByRole('listitem')).toHaveLength(4);
      expect(screen.queryByText('building.slow')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChoosePacksStep in the re-entry dialog', () => {
  it('still answers the number keys when focus is inside the dialog', () => {
    const onToggle = vi.fn();
    render(
      <div role="dialog">
        <ChoosePacksStep catalog={catalog} packs={[]} onToggle={onToggle} onContinue={vi.fn()} />
      </div>
    );
    const card = screen.getAllByRole('checkbox')[0];
    card.focus();
    fireEvent.keyDown(card, { key: '2' });
    expect(onToggle).toHaveBeenLastCalledWith('people');
  });
});

describe('BuildOptions', () => {
  const withExtras: ISchemaPackCatalogVo = {
    ...catalog,
    packs: catalog.packs.map((pack) =>
      pack.id === 'people'
        ? {
            ...pack,
            tables: [
              ...pack.tables,
              { key: 'auditlog', name: 'auditlog', optional: true, fields: [title] },
            ],
          }
        : pack
    ),
  };
  const props = { catalog: withExtras, onChange: vi.fn(), onToggleOptional: vi.fn() };
  const state = { ...createInitialState({ baseName: '' }), packs: ['people' as const] };

  it('asks for a name only when a new base is created', () => {
    const { rerender } = render(<BuildOptions {...props} state={state} />);
    expect(screen.getAllByLabelText('personalise.baseName').length).toBeGreaterThan(0);

    rerender(<BuildOptions {...props} state={state} addingToBase />);
    expect(screen.queryAllByLabelText('personalise.baseName')).toHaveLength(0);
  });

  it('folds the options behind a summary and toggles extra tables as tiles', () => {
    render(<BuildOptions {...props} state={state} />);
    expect(screen.getByText(/review\.extraTables/)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'auditlog' })).toBeNull();
    fireEvent.click(screen.getByText('review.options'));
    const tile = screen.getByRole('checkbox', { name: 'auditlog' });
    expect(tile.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(tile);
    expect(props.onToggleOptional).toHaveBeenCalledWith('auditlog');
  });
});

describe('ReadyStep', () => {
  it('offers the base itself when no entry table is new, and a Done button in the dialog', () => {
    const onDone = vi.fn();
    render(
      <ReadyStep
        packs={['progress']}
        addedToBase
        onDone={onDone}
        result={{ baseId: 'bseA', tables: [], counts: { tables: 0, fields: 3, records: 0 } }}
      />
    );
    expect(screen.getByText('ready.openBase').closest('a')!.getAttribute('href')).toBe(
      '/base/bseA'
    );
    fireEvent.click(screen.getByText('ready.done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    // Going into the base closes the dialog too, instead of leaving it open over the page.
    fireEvent.click(screen.getByText('ready.openBase'));
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
