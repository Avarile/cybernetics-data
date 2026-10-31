import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { chooseBase, holdTable, useScope } from '../hooks/useScope';
import { useCockpitStore } from '../state/cockpit-store';
import {
  Annunciator,
  FocusChip,
  PaletteSwitch,
  PowerToggle,
  StatusChip,
  ZuluClock,
} from '../ui/shell/Annunciator';
import { BaseMenu } from '../ui/shell/BaseMenu';
import { TableMenu } from '../ui/shell/TableMenu';

/**
 * The strip on top (cockpit design §5.2, scope design §5): the base with its default ★, the
 * table on the stage with the rotation, and the focus on the left; palette, link state, clock
 * and power on the right.
 */
export const AnnunciatorContainer = () => {
  const { t } = useTranslation('common');
  const chat = useAgentSession();
  const scope = useScope();
  const { data: status } = useAgentStatus();
  const focus = useCockpitStore((s) => s.focus);
  const clearFocus = useCockpitStore((s) => s.clearFocus);
  const close = useCockpitStore((s) => s.close);
  const palette = useCockpitStore((s) => s.palette);
  const setPalette = useCockpitStore((s) => s.setPalette);
  const stage = useCockpitStore((s) => s.stage);
  const cycle = useCockpitStore((s) => s.cycle);
  const failed = useCockpitStore((s) => s.overviewFailed);
  const cycleEvent = useCockpitStore((s) => s.cycleEvent);
  const focusText = focus?.tableId
    ? `${focus.tableName ?? t('agent.cockpit.table', 'TABLE')}${focus.rows ? ` · ${focus.rows} ${t('agent.cockpit.rows', 'ROWS')}` : ''}`
    : undefined;

  const toggleCycle = useCallback(() => {
    const held = useCockpitStore
      .getState()
      .cycle.holds.some((h) => h === 'paused' || h === 'picked');
    cycleEvent(held ? { type: 'resume' } : { type: 'hold', reason: 'paused' });
  }, [cycleEvent]);

  return (
    <Annunciator
      sources={
        <>
          <BaseMenu
            bases={scope.bases}
            currentId={scope.baseId}
            defaultId={scope.defaultBaseId}
            tableCount={scope.tablesLoaded ? scope.tables.length : undefined}
            settingDefault={scope.settingDefault}
            onPick={chooseBase}
            onSetDefault={(id) => void scope.setDefault(id).catch(() => undefined)}
          />
          <TableMenu
            tables={scope.tables}
            baseName={scope.base?.name ?? ''}
            cycle={cycle}
            failed={failed}
            onOverview={stage === 'overview'}
            onPick={holdTable}
            onToggle={toggleCycle}
          />
          {focusText && <FocusChip text={focusText} onClear={clearFocus} />}
        </>
      }
      link={
        <>
          <PaletteSwitch value={palette} onChange={setPalette} />
          <StatusChip status={status} busy={chat.busy} onLeave={close} />
          <ZuluClock />
          <PowerToggle busy={chat.busy} onOff={close} />
        </>
      }
    />
  );
};
