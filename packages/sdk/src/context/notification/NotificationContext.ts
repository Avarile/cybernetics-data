/* eslint-disable @typescript-eslint/naming-convention */
import type { INotificationBuffer } from '@cybernetics/core';
import React from 'react';

export const NotificationContext = React.createContext<INotificationBuffer | null>(null);
