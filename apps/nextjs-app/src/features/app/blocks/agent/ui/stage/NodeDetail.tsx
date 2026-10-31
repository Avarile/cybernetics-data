import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { IGNode } from '../../model/graph/types';
import s from '../theme/cockpit.module.css';
import o from '../theme/overview.module.css';

/**
 * The pinned node of the overview (overview design §7): what it is, its lines, the record in its
 * table, and READ, which opens it in the cockpit's reader (scope design §8.1).
 */
export const NodeDetail = ({
  node,
  kind,
  baseId,
  onLeave,
  onRead,
  onClose,
}: {
  node: IGNode;
  /** What the record is ("TASK"); the node's own key when there is none. */
  kind?: string;
  baseId: string;
  /** Following the link leaves the cockpit. */
  onLeave: () => void;
  onRead: (node: IGNode) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation('common');
  const record = node.recordId && node.tableId;
  return (
    <div className={o.detail} role="group" aria-label={node.label}>
      <span className={o.key} data-tone={node.tone}>
        {[kind ?? node.short, node.alert ? t('agent.cockpit.overdue', 'OVERDUE') : node.state]
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
          <button type="button" className={s.knob} onClick={() => onRead(node)}>
            {t('agent.cockpit.overview.read', 'READ')}
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
