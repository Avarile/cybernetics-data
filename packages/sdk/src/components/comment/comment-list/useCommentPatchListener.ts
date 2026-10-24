import { getCommentChannel } from '@teable/core';
import { isEmpty, get } from 'lodash';
import { useEffect } from 'react';
import { useConnection } from '../../../hooks';

export const useCommentPatchListener = (
  tableId: string,
  recordId: string,
  cb: (remoteData: unknown) => void
) => {
  const { connection } = useConnection();
  const presenceKey = getCommentChannel(tableId, recordId);
  const presence = connection?.getPresence(presenceKey);

  useEffect(() => {
    if (!presence || !tableId || !connection || !recordId) {
      return;
    }

    // Check wantSubscribe, not subscribed: an unsubscribe from a previous cleanup may not be
    // acked yet, and this instance still needs its own receive listener either way.
    if (!presence.wantSubscribe) {
      presence.subscribe();
    }

    const receiveHandler = () => {
      const { remotePresences } = presence;
      !isEmpty(remotePresences) && cb?.(get(remotePresences, presenceKey));
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [cb, connection, presence, presenceKey, recordId, tableId]);
};
