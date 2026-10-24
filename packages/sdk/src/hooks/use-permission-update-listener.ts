import { getBasePermissionUpdateChannel } from '@cybernetics/core';
import { useEffect } from 'react';
import { useConnection } from './use-connection';

export const usePermissionUpdateListener = (
  baseId: string | undefined,
  trigger: (operatorUserId?: string) => void
) => {
  const { connection } = useConnection();

  useEffect(() => {
    if (baseId == null || connection == null) return;
    const channel = getBasePermissionUpdateChannel(baseId);
    const remotePresence = connection.getPresence(channel);

    // subscribed lags behind a pending unsubscribe, so rely on wantSubscribe
    if (!remotePresence.wantSubscribe) {
      remotePresence.subscribe((err) => {
        if (err) {
          console.error('[usePermissionUpdateListener] Subscribe error:', err);
        }
      });
    }

    const receiveHandler = (_id: string, data: string) => {
      // The data contains the operator user ID
      trigger(data);
    };

    remotePresence.on('receive', receiveHandler);

    return () => {
      remotePresence.removeListener('receive', receiveHandler);
      remotePresence.listenerCount('receive') === 0 && remotePresence.unsubscribe();
      remotePresence.listenerCount('receive') === 0 && remotePresence.destroy();
    };
  }, [baseId, connection, trigger]);
};
