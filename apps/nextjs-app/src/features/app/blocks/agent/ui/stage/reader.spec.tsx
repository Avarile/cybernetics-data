import type { ICockpitRecordVo } from '@teable/openapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, userEvent } from '@/test-utils';
import { RecordModal } from './RecordModal';

const record: ICockpitRecordVo = {
  tableId: 'tblKnow',
  tableName: 'knowledges',
  baseId: 'bse1',
  recordId: 'recK',
  title: 'Deploy K3s',
  markdown: '# Deploy K3s\n\n| Field | Value |\n| --- | --- |\n| Status | Done |\n',
  chars: 900,
  version: 'v1',
  masked: ['password'],
};

describe('the record reader (scope design §8.1)', () => {
  afterEach(cleanup);

  it('shows the summary above the record, its masked fields, and the way to the table', () => {
    render(
      <RecordModal
        record={record}
        loading={false}
        summary={{ status: 'ready', text: 'Deploy steps for K3s.' }}
        onClose={vi.fn()}
        onLeave={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Deploy K3s' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('region', { name: 'AGENT SUMMARY' })).toHaveTextContent(
      'Deploy steps for K3s.'
    );
    expect(screen.getByRole('region', { name: 'RECORD' })).toHaveTextContent('Status');
    expect(screen.getByText('MASKED · password')).toBeTruthy();
    expect(screen.getByRole('link', { name: /OPEN IN TABLE/ }).getAttribute('href')).toBe(
      '/base/bse1/tblKnow?recordId=recK'
    );
  });

  it('has no summary for a short record, and says when the agent is needed or failed', () => {
    const { rerender } = render(
      <RecordModal
        record={record}
        loading={false}
        summary={{ status: 'none' }}
        onClose={vi.fn()}
        onLeave={vi.fn()}
      />
    );
    expect(screen.queryByRole('region', { name: 'AGENT SUMMARY' })).toBeNull();
    rerender(
      <RecordModal
        record={record}
        loading={false}
        summary={{ status: 'unavailable' }}
        onClose={vi.fn()}
        onLeave={vi.fn()}
      />
    );
    expect(screen.getByText(/SUMMARY NEEDS THE AGENT/)).toBeTruthy();
    rerender(
      <RecordModal
        record={record}
        loading={false}
        summary={{ status: 'error', error: 'timeout' }}
        onClose={vi.fn()}
        onLeave={vi.fn()}
      />
    );
    expect(screen.getByText('NO SUMMARY · timeout')).toBeTruthy();
  });

  it('closes on Escape, on ✕ and on the backdrop', async () => {
    const onClose = vi.fn();
    render(
      <RecordModal
        record={record}
        loading={false}
        summary={{ status: 'loading' }}
        onClose={onClose}
        onLeave={vi.fn()}
      />
    );
    expect(screen.getByText('SUMMARIZING…')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close the record' }));
    await userEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
