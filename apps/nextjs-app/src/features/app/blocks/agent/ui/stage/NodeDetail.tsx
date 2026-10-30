import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { IGNode } from '../../model/graph/types';
import s from '../theme/cockpit.module.css';
import o from '../theme/overview.module.css';

/**
 * The pinned node of the overview (overview design §7): what it is, its lines, the record in its
 * table, and ASK, which points the agent at it.
 */
export const NodeDetail = ({
  node,
  baseId,
  onLeave,
  onAsk,
  onClose,
}: {
  node: IGNode;
  baseId: string;
  /** Following the link leaves the cockpit. */
  onLeave: () => void;
  onAsk: (node: IGNode) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation('common');
  const record = node.recordId && node.tableId;
  return (
    <div className={o.detail} role="group" aria-label={node.label}>
      <span className={o.key} data-tone={node.tone}>
        {[node.short, node.alert ? t('agent.cockpit.overdue', 'OVERDUE') : node.state]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <b>{node.label}</b>
      {node.meta?.map(([k, v]) => (
        <span key={k} className={o.line}>
          <i>{k}</i> {v}
        </span>
      ))}
      <span className={o.actions}>
        {record && (
          <Link
            className={s.knob}
            href={`/base/${baseId}/${node.tableId}?recordId=${node.recordId}`}
            onClick={onLeave}
          >
            {t('agent.cockpit.overview.open', 'OPEN')} ↗
          </Link>
        )}
        {record && (
          <button type="button" className={s.knob} onClick={() => onAsk(node)}>
            {t('agent.cockpit.overview.ask', 'ASK')}
          </button>
        )}
        <button
          type="button"
          className={s.knob}
          aria-label={t('agent.cockpit.overview.unpin', 'Unpin')}
          onClick={onClose}
        >
          ✕
        </button>
      </span>
    </div>
  );
};
