import { useMutation } from '@tanstack/react-query';
import type { IButtonFieldOptions } from '@teable/core';
import { getTableButtonClickChannel } from '@teable/core';
import {
  buttonClick as buttonClickApi,
  shareViewButtonClick as shareViewButtonClickApi,
} from '@teable/openapi';
import { sonner, useConfirm } from '@teable/ui-lib';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../context/app/i18n';
import type { Record as IRecord } from '../model';
import { useConnection } from './use-connection';

// Resolve field variables in template string
// e.g., "Hello {fldXXX}" => "Hello World" (where fldXXX field value is "World")
const resolveFieldVariables = (template: string, record?: IRecord): string => {
  if (!template || !record) return template;
  return template.replace(/\{([^}]+)\}/g, (match, fieldId) => {
    return record.getCellValueAsString(fieldId);
  });
};
export interface IButtonClickStatus {
  runId: string;
  recordId: string;
  fieldId: string;
  loading: boolean;
  name: string;
  message?: string;
  errorMessage?: string;
}

const { toast } = sonner;

export const useButtonClickStatus = (tableId: string, shareId?: string) => {
  const { connection } = useConnection();
  const channel = getTableButtonClickChannel(tableId);
  const presence = connection?.getPresence(channel);
  // runId => status
  const [statusMap, setStatusMap] = useState<Record<string, IButtonClickStatus>>({});
  const toastMapRef = useRef<Record<string, number | string | undefined>>({});
  // runId => completed status that arrived over the socket before the http response
  const complatedMapRef = useRef<Record<string, IButtonClickStatus>>({});
  const { confirm } = useConfirm();
  const { t } = useTranslation();

  const { mutateAsync: buttonClickFn } = useMutation({
    mutationFn: (ro: { tableId: string; recordId: string; fieldId: string; name: string }) =>
      shareId
        ? shareViewButtonClickApi(shareId, ro.recordId, ro.fieldId)
        : buttonClickApi(ro.tableId, ro.recordId, ro.fieldId),
    onSuccess: (res, ro) => {
      setStatus({
        runId: res.data.runId,
        recordId: ro.recordId,
        fieldId: ro.fieldId,
        loading: !!res.data.runId,
        name: ro.name,
      });
    },
    onError: (_error, ro) => {
      setComplated({
        runId: '',
        recordId: ro.recordId,
        fieldId: ro.fieldId,
        loading: false,
        name: ro.name,
      });
    },
  });

  const checkLoading = useCallback(
    (fieldId: string, recordId: string) => {
      return statusMap[`${recordId}-${fieldId}`]?.loading ?? false;
    },
    [statusMap]
  );

  const setRunning = useCallback(
    (status: IButtonClickStatus) => {
      const { runId, loading, name, recordId, fieldId } = status;
      setStatusMap((prev) => ({
        ...prev,
        [`${recordId}-${fieldId}`]: status,
      }));

      if (!runId) {
        return;
      }
      const toastId = toastMapRef.current[runId];
      if (loading) {
        const newToastId = toast.loading(t('common.runStatus.running', { name }), {
          id: toastId ?? undefined,
        });
        toastMapRef.current[runId] = newToastId;
      }
    },
    [t]
  );

  const showResult = useCallback(
    (name: string, errorMessage?: string, toastId?: number | string) => {
      if (errorMessage) {
        toast.error(t('common.runStatus.failed', { name }), {
          id: toastId,
        });
      } else {
        toast.success(t('common.runStatus.success', { name }), {
          id: toastId,
        });
      }
    },
    [t]
  );

  const setComplated = useCallback(
    (status: IButtonClickStatus) => {
      const { runId, recordId, fieldId, errorMessage, name } = status;
      setStatusMap((prev) => {
        const newMap = { ...prev };
        delete newMap[`${recordId}-${fieldId}`];
        return newMap;
      });

      if (!runId) {
        return;
      }
      const toastId = toastMapRef.current[runId];
      if (!toastId) {
        complatedMapRef.current[runId] = status;
        return;
      }
      delete toastMapRef.current[runId];
      showResult(name, errorMessage, toastId);
    },
    [setStatusMap, showResult]
  );

  /**
   * socket may fast then http, so we need to check isComplated
   */
  const setStatus = useCallback(
    (status: IButtonClickStatus) => {
      const { loading, runId, name } = status;
      const complated = complatedMapRef.current[runId];
      if (complated) {
        delete complatedMapRef.current[runId];
        showResult(name, complated.errorMessage);
      } else if (loading) {
        setRunning(status);
      } else {
        setComplated(status);
      }
    },
    [setComplated, setRunning, showResult]
  );

  useEffect(() => {
    if (!presence || !channel) {
      return;
    }

    // Other instances may share this presence, so always attach our own listener and only
    // subscribe when no subscription is wanted yet (subscribed lags behind a pending unsubscribe)
    if (!presence.wantSubscribe) {
      presence.subscribe();
    }

    const receiveHandler = () => {
      const { remotePresences } = presence;
      if (!isEmpty(remotePresences)) {
        const remoteStatus = get(remotePresences, channel);
        if (remoteStatus) {
          setComplated(remoteStatus);
        }
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, presence, channel, setComplated]);

  const buttonClick = useCallback(
    async (ro: {
      tableId: string;
      recordId: string;
      fieldId: string;
      name: string;
      confirm?: IButtonFieldOptions['confirm'];
      record?: IRecord;
    }) => {
      if (ro.confirm) {
        const { title, description, confirmText } = ro.confirm;
        const resolvedTitle =
          resolveFieldVariables(title ?? '', ro.record) || t('field.button.confirm.title');
        const resolvedDescription =
          resolveFieldVariables(description ?? '', ro.record) ||
          t('field.button.confirm.description');

        const confirmed = await confirm({
          title: resolvedTitle,
          description: resolvedDescription,
          cancelText: t('common.cancel'),
          confirmText: confirmText || t('common.confirm'),
        });
        if (!confirmed) return;
      }

      setRunning({
        runId: '',
        recordId: ro.recordId,
        fieldId: ro.fieldId,
        loading: true,
        name: ro.name,
      });
      return buttonClickFn(ro);
    },
    [buttonClickFn, setRunning, confirm, t]
  );

  return useMemo(() => {
    return { checkLoading, buttonClick };
  }, [checkLoading, buttonClick]);
};

export type IButtonClickStatusHook = ReturnType<typeof useButtonClickStatus>;
