import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { logTime } from '../../model/format';
import s from '../theme/cockpit.module.css';

export interface IAskLine {
  id: number;
  t: number;
  kind: 'base' | 'table' | 'query' | 'summary' | 'default' | 'error';
  text: string;
}

const verbs: Record<IAskLine['kind'], string> = {
  base: 'BASE',
  table: 'TABLE',
  query: 'QUERY',
  summary: 'SUMMARY',
  default: 'DEFAULT',
  error: 'ERROR',
};

/**
 * The ask panel's log (scope design §6.6, replacing the transcript): what the commands changed,
 * what each search found, the agent's summaries as they were spoken, and what went wrong.
 */
export const AskLog = ({ lines, hint }: { lines: IAskLine[]; hint: string }) => {
  const { t } = useTranslation('common');
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lines.length]);
  return (
    <ol className={s.askLog} aria-live="polite" aria-label={t('agent.cockpit.log', 'Log')}>
      {lines.map((line) => (
        <li key={line.id} data-kind={line.kind}>
          <span className={s.askTime}>{logTime(line.t)}</span>
          <b>{t(`agent.cockpit.logVerb.${line.kind}`, verbs[line.kind])}</b>
          <span>{line.text}</span>
        </li>
      ))}
      {!lines.length && <li className={s.askHint}>{hint}</li>}
      <li ref={end} aria-hidden className={s.askEnd} />
    </ol>
  );
};
