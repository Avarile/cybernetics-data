import type { ICockpitRecordVo } from '@teable/openapi';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useEffect, useId, useRef } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import type { ISummaryState } from '../../model/reader';
import m from '../theme/modal.module.css';

const focusable =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * The record reader in the middle of the cockpit (scope design §8.1): the record as Markdown and,
 * when it is long, the agent's summary above it. Escape, ✕ or the backdrop closes it; focus stays
 * inside while it is open and goes back where it was.
 */
export const RecordModal = ({
  record,
  loading,
  error,
  summary,
  onClose,
  onLeave,
}: {
  record?: ICockpitRecordVo;
  loading: boolean;
  error?: string;
  summary: ISummaryState;
  onClose: () => void;
  /** OPEN IN TABLE leaves the cockpit. */
  onLeave: () => void;
}) => {
  const { t } = useTranslation('common');
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // before the cockpit's own keys see it
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(focusable)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [onClose]);

  return (
    // the ✕ and Escape do the same from the keyboard
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={m.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className={m.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <header className={m.head}>
          <span className={m.table}>{record?.tableName.toUpperCase() ?? '…'}</span>
          <b id={`${id}-title`}>
            {record?.title ?? (loading ? t('agent.cockpit.reader.loading', 'READING…') : '—')}
          </b>
          {record && (
            <Link
              className={m.action}
              href={`/base/${record.baseId}/${record.tableId}?recordId=${record.recordId}`}
              onClick={onLeave}
            >
              {t('agent.cockpit.reader.openInTable', 'OPEN IN TABLE')} ↗
            </Link>
          )}
          <button
            type="button"
            className={m.action}
            aria-label={t('agent.cockpit.reader.close', 'Close the record')}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className={m.body}>
          {summary.status !== 'none' && (
            <section
              className={m.summary}
              aria-label={t('agent.cockpit.reader.summary', 'AGENT SUMMARY')}
            >
              <h3>{t('agent.cockpit.reader.summary', 'AGENT SUMMARY')}</h3>
              {summary.status === 'loading' && (
                <p className={m.pending} aria-busy>
                  {t('agent.cockpit.reader.summarizing', 'SUMMARIZING…')}
                </p>
              )}
              {summary.status === 'ready' && <p>{summary.text}</p>}
              {summary.status === 'unavailable' && (
                <p className={m.note}>
                  {t('agent.cockpit.reader.needsAgent', 'SUMMARY NEEDS THE AGENT')} ·{' '}
                  <Link href="/admin/agent" onClick={onLeave}>
                    {t('agent.panel.openSettings', 'Open Admin ▸ Agent')}
                  </Link>
                </p>
              )}
              {summary.status === 'error' && (
                <p className={m.note}>
                  {t('agent.cockpit.reader.failed', {
                    error: summary.error,
                    defaultValue: `NO SUMMARY · ${summary.error}`,
                  })}
                </p>
              )}
            </section>
          )}
          <section className={m.record} aria-label={t('agent.cockpit.reader.record', 'RECORD')}>
            <h3>{t('agent.cockpit.reader.record', 'RECORD')}</h3>
            {error && <p className={m.note}>{error}</p>}
            {loading && !record && (
              <p className={m.pending}>{t('agent.cockpit.reader.loading', 'READING…')}</p>
            )}
            {record && <MessageResponse className={m.markdown}>{record.markdown}</MessageResponse>}
            {record && record.masked.length > 0 && (
              <p className={m.note}>
                {t('agent.cockpit.reader.masked', {
                  fields: record.masked.join(', '),
                  defaultValue: `MASKED · ${record.masked.join(', ')}`,
                })}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
