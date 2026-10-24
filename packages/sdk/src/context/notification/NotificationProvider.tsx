import type { INotificationBuffer } from '@teable/core';
import { getUserNotificationChannel } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from '../../hooks';
import { useConnection } from '../../hooks/use-connection';
import { NotificationContext } from './NotificationContext';

interface INotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: FC<INotificationProviderProps> = ({ children }) => {
  const { user } = useSession();
  const { connection } = useConnection();
  const [notification, setNotification] = useState<INotificationBuffer | null>(null);

  useEffect(() => {
    // user is an empty object until the session is loaded
    if (!connection || !user.id) {
      return;
    }

    const channel = getUserNotificationChannel(user.id);
    const remotePresence = connection.getPresence(channel);

    // subscribed lags behind a pending unsubscribe, so rely on wantSubscribe
    if (!remotePresence.wantSubscribe) {
      remotePresence.subscribe((err) => {
        if (err) {
          console.error('[NotificationProvider] Subscribe error:', err);
        }
      });
    }

    const receiveHandler = (_id: string, res: INotificationBuffer) => {
      setNotification(res);
    };

    remotePresence.on('receive', receiveHandler);

    return () => {
      remotePresence.removeListener('receive', receiveHandler);
      remotePresence.unsubscribe();
      remotePresence.destroy();
    };
  }, [connection, user.id]);

  return (
    <NotificationContext.Provider value={notification}>{children}</NotificationContext.Provider>
  );
};
