/* eslint-disable sonarjs/no-duplicate-string */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, userEvent } from '@/test-utils';
import { parseInput, suggest } from '../../model/commands';
import { AgentComposer, SEARCH_IDLE_MS } from './Composer';

describe('AgentComposer, the command line (scope design §6)', () => {
  const bases = [
    { id: 'bse1', name: 'data-centre' },
    { id: 'bse2', name: 'demo_database' },
    { id: 'bse3', name: 'primary_database_2' },
  ];
  const tables = [
    { id: 'tbl1', name: 'tasks' },
    { id: 'tbl2', name: 'finance_Transactions' },
  ];
  const setup = () => {
    const onSubmit = vi.fn((text: string) => text.startsWith('/'));
    const onIdle = vi.fn();
    const onPick = vi.fn();
    render(
      <AgentComposer
        placeholder="Search TASKS · /base · /table"
        suggestionsFor={(v) => suggest(parseInput(v), bases, tables, 'bse1')}
        onSubmit={onSubmit}
        onIdle={onIdle}
        onPick={onPick}
      />
    );
    return { onSubmit, onIdle, onPick, input: screen.getByRole('combobox') };
  };
  const options = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('offers the two commands on /, every base on /base, and only data-centre on /base dat', async () => {
    const { input } = setup();
    await userEvent.type(input, '/');
    expect(options().map((o) => o.split('<')[0])).toEqual(['/base', '/table']);
    await userEvent.type(input, 'base');
    expect(options().map((o) => o.replace(/database$/, ''))).toEqual([
      'data-centre',
      'demo_database',
      'primary_database_2',
    ]);
    await userEvent.type(input, ' dat');
    expect(options().map((o) => o.replace(/database$/, ''))).toEqual(['data-centre']);
  });

  it('moves with the arrows, completes with Tab, applies with Enter', async () => {
    const { input, onPick } = setup();
    await userEvent.type(input, '/table ');
    await userEvent.keyboard('{ArrowDown}{Tab}');
    expect(input).toHaveValue('/table finance_Transactions');
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'table', id: 'tbl2', name: 'finance_Transactions' })
    );
    expect(input).toHaveValue('');
  });

  it('closes the list with Escape, then Enter submits the text', async () => {
    const { input, onSubmit } = setup();
    await userEvent.type(input, '/base nothing-like-it{Escape}');
    expect(options()).toEqual([]);
    await userEvent.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('/base nothing-like-it');
  });

  it('searches on Enter and keeps the query in the input to refine', async () => {
    const { input, onSubmit } = setup();
    await userEvent.type(input, 'deploy{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('deploy');
    expect(input).toHaveValue('deploy');
  });

  it('hands the text over once the input has been still for 3 s, once', () => {
    vi.useFakeTimers();
    const { input, onIdle } = setup();
    fireEvent.change(input, { target: { value: 'dep' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS - 100));
    fireEvent.change(input, { target: { value: 'deploy' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS - 1));
    expect(onIdle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith('deploy');
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS * 2));
    expect(onIdle).toHaveBeenCalledTimes(1);
    // an emptied input never hands anything over
    fireEvent.change(input, { target: { value: '  ' } });
    act(() => vi.advanceTimersByTime(SEARCH_IDLE_MS * 2));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
