import { FieldType } from '@teable/core';
import type { ISchemaPackCatalogVo, ISchemaPackPlanVo } from '@teable/openapi';
import { vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@/test-utils';
import { createInitialState, restoreState } from './state';
import { ChoosePacksStep } from './steps/ChoosePacksStep';
import { PersonaliseStep } from './steps/PersonaliseStep';
import { ReadyStep } from './steps/ReadyStep';
import { ReviewStep, reviewTabs } from './steps/ReviewStep';

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
    expect(restoreState({ step: 'review', packs: ['crm'] }).step).toBe('choose');
    expect(restoreState({ step: 'nowhere' }).step).toBeUndefined();
  });

  it('ignores storage that is not an object', () => {
    expect(restoreState(null)).toEqual({});
    expect(restoreState('review')).toEqual({});
  });
});

describe('ReviewStep', () => {
  it('shows a tab for every pack the plan changes, not only the picked ones', () => {
    expect(reviewTabs(['people'], plan)).toEqual([
      { pack: 'people', picked: true },
      { pack: 'progress', picked: false },
    ]);
    expect(reviewTabs(['people'], undefined)).toEqual([{ pack: 'people', picked: true }]);
  });

  it('marks the extra tab and shows why the plan failed', () => {
    const props = {
      packs: ['people' as const],
      isLoading: false,
      onRetry: vi.fn(),
      onBack: vi.fn(),
      onBuild: vi.fn(),
    };
    const { rerender } = render(<ReviewStep {...props} plan={plan} isError={false} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('review.inBase')).toBeTruthy();

    rerender(<ReviewStep {...props} plan={plan} isError errorMessage="tasks.priority is number" />);
    expect(screen.getByText('tasks.priority is number')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('ChoosePacksStep in the re-entry dialog', () => {
  it('still answers the number keys when focus is inside the dialog', () => {
    const onToggle = vi.fn();
    render(
      <div role="dialog">
        <ChoosePacksStep
          catalog={catalog}
          packs={[]}
          optionalTables={[]}
          onToggle={onToggle}
          onSelectAll={vi.fn()}
          onContinue={vi.fn()}
        />
      </div>
    );
    const card = screen.getAllByRole('checkbox')[0];
    card.focus();
    fireEvent.keyDown(card, { key: '2' });
    expect(onToggle).toHaveBeenLastCalledWith('people');
  });
});

describe('PersonaliseStep', () => {
  const props = {
    catalog,
    onChange: vi.fn(),
    onToggleOptional: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
  };

  it('asks for a name only when a new base is created', () => {
    const state = { ...createInitialState({ baseName: '' }), packs: ['people' as const] };
    const { rerender } = render(<PersonaliseStep {...props} state={state} />);
    expect(screen.getAllByLabelText('personalise.baseName').length).toBeGreaterThan(0);
    expect(screen.getByText('continue').closest('button')!.disabled).toBe(true);

    rerender(<PersonaliseStep {...props} state={state} addingToBase />);
    expect(screen.queryAllByLabelText('personalise.baseName')).toHaveLength(0);
    expect(screen.getByText('continue').closest('button')!.disabled).toBe(false);
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
    expect(onDone).toHaveBeenCalled();
  });
});
