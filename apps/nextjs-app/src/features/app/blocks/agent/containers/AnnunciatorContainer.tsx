import { useCallback } from 'react';
import { useAgentStatus } from '../hooks/useAgentData';
import { chooseBase, holdTable, useScope } from '../hooks/useScope';
import { useTableSearch } from '../hooks/useTableSearch';
import { useCockpitStore } from '../state/cockpit-store';
import {
  Annunciator,
  PaletteSwitch,
  PowerToggle,
  StatusChip,
  ZuluClock,
} from '../ui/shell/Annunciator';
import { BaseMenu } from '../ui/shell/BaseMenu';
import { TableMenu } from '../ui/shell/TableMenu';

/**
 * The strip on top (cockpit design §5.2, scope design §5): the base with its default ★ and the
 * table on the stage with the rotation on the left; palette, link state, clock and power on the
 * right.
 */
export const AnnunciatorContainer = () => {
  const scope = useScope();
  const { searching } = useTableSearch();
  const { data: status } = useAgentStatus();
  const close = useCockpitStore((s) => s.close);
  const palette = useCockpitStore((s) => s.palette);
  const setPalette = useCockpitStore((s) => s.setPalette);
  const cycle = useCockpitStore((s) => s.cycle);
  const failed = useCockpitStore((s) => s.overviewFailed);
  const cycleEvent = useCockpitStore((s) => s.cycleEvent);

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
            onOverview
            onPick={holdTable}
            onToggle={toggleCycle}
          />
        </>
      }
      link={
        <>
          <PaletteSwitch value={palette} onChange={setPalette} />
          <StatusChip status={status} busy={searching} onLeave={close} />
          <ZuluClock />
          <PowerToggle busy={searching} onOff={close} />
        </>
      }
    />
  );
};
