import { useTranslation } from 'next-i18next';
import { sourceText, type IBoard } from '../../model/search-board';
import s from '../theme/cockpit.module.css';

const hm = (t?: number) => (t ? new Date(t).toISOString().slice(11, 19) : '--:--:--');

const verbOf: Record<string, string> = {
  search: 'SEARCH',
  records: 'PICKED',
  filter: 'FILTER',
  follow: 'FOLLOW',
  reverse: 'REVERSE',
};

/** Every step of the search on the stage, with when it ran (the cockpit's flight log, §5.6). */
export const RunLog = ({ board }: { board?: IBoard }) => {
  const { t } = useTranslation('common');
  const steps = board?.plan?.steps ?? [];
  if (!steps.length) return null;
  return (
    <details className={s.logBox}>
      <summary>{t('agent.cockpit.runLog', 'RUN LOG')} · UTC</summary>
      <ol className={s.log}>
        {steps.map((step) => {
          const st = board!.states[step.id];
          const time = board!.times[step.id];
          const tone =
            st?.status === 'failed' || st?.status === 'needs_choice'
              ? 'caution'
              : st?.status === 'running'
                ? 'route'
                : 'ink';
          return (
            <li key={step.id}>
              <span className={s.tm}>{hm(time?.finished ?? time?.started)}</span>
              <span className={s.vb} data-tone={tone}>
                {verbOf[step.source.kind]}
              </span>
              <span className={s.tx}>
                {step.table.name} · {sourceText(board!.plan, step.id)} → {st?.status ?? 'pending'}
                {st && st.status !== 'pending' ? ` ${st.found}` : ''}
                {st?.error ? ` · ${st.error}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
};
