import { getActionTriggerChannel } from '@cybernetics/core';
import { useEffect, useMemo, useState } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';
import { useConnection } from './use-connection';

export interface IActionData {
  actionKey: string;
  payload?: Record<string, unknown>;
}

// Delayed unsubscribes keyed by presence, so leaving one channel never cancels another's cleanup
const pendingCleanups = new Map<Presence, ReturnType<typeof setTimeout>>();

export const usePresence = (channel: string | undefined) => {
  const { connection } = useConnection();
  const [presence, setPresence] = useState<Presence>();

  useEffect(() => {
    if (connection == null || channel == null) return;

    const remotePresence = connection.getPresence(channel);

    const pendingCleanup = pendingCleanups.get(remotePresence);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      pendingCleanups.delete(remotePresence);
    }

    // subscribed can still be true while an unsubscribe awaits its ack, so rely on wantSubscribe
    if (!remotePresence.wantSubscribe) {
      remotePresence.subscribe((err) => {
        if (err) {
          console.error('[usePresence] Subscribe error:', err);
        }
      });
    }

    setPresence(remotePresence);

    return () => {
      clearTimeout(pendingCleanups.get(remotePresence));
      const timeout = setTimeout(() => {
        pendingCleanups.delete(remotePresence);
        if (remotePresence.listenerCount('receive') === 0) {
          remotePresence.unsubscribe();
          remotePresence.destroy();
        }
      }, 200);
      pendingCleanups.set(remotePresence, timeout);
    };
  }, [channel, connection]);

  return presence;
};

export const useActionListener = <T extends IActionData>(
  tableIdOrViewId: string | undefined,
  matches: T['actionKey'][],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (actionKey: T['actionKey'], payload?: any) => void
) => {
  const presence = usePresence(tableIdOrViewId && getActionTriggerChannel(tableIdOrViewId));
  const relevantProps = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    if (!tableIdOrViewId || !presence) {
      return;
    }

    const cb = (_id: string, res: T[]) => {
      const result = res.find(({ actionKey }) => relevantProps.has(actionKey));
      if (result) {
        callback(result.actionKey, result.payload);
      }
    };

    presence.addListener('receive', cb);

    return () => {
      presence.removeListener('receive', cb);
    };
  }, [presence, tableIdOrViewId, callback, relevantProps]);
};
