import { useQuery } from '@tanstack/react-query';
import { IdPrefix, getTableCommentChannel } from '@teable/core';
import type { IGetRecordsRo, ICommentCountVo } from '@teable/openapi';
import { getCommentCount, CommentPatchType, saveQueryParams } from '@teable/openapi';
import { get } from 'lodash';
import { useMemo, useEffect, useState } from 'react';
import { LARGE_QUERY_THRESHOLD } from '../components/grid-enhancements/hooks/constant';
import { ReactQueryKeys } from '../config';
import { useConnection } from './use-connection';
import { useSearch } from './use-search';
import { useTableId } from './use-table-id';
import { useView } from './use-view';
import { useViewId } from './use-view-id';

export const useCommentCountMap = (query?: IGetRecordsRo) => {
  const tableId = useTableId();

  const viewId = useViewId();

  const view = useView();

  const { searchQuery } = useSearch();

  const { connection } = useConnection();

  const queryParams = useMemo<IGetRecordsRo>(() => {
    return {
      viewId,
      search: searchQuery,
      type: IdPrefix.Record,
      ...query,
      groupBy: query?.groupBy,
      filter: view?.filter,
      orderBy: view?.sort?.sortObjs,
    } as IGetRecordsRo;
  }, [query, searchQuery, viewId, view]);

  const { data } = useQuery({
    queryKey: ReactQueryKeys.commentCount(tableId!, queryParams),
    queryFn: async () => {
      const { collapsedGroupIds, ...rest } = queryParams;

      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return getCommentCount(tableId!, {
          ...rest,
          collapsedGroupIds: undefined,
          queryId: data.queryId,
        }).then(({ data }) => data);
      }
      return getCommentCount(tableId!, queryParams).then(({ data }) => data);
    },
    enabled: !!tableId,
  });

  const [commentCount, setCommentCount] = useState<ICommentCountVo>([]);

  useEffect(() => {
    data && setCommentCount(data);
  }, [data]);

  useEffect(() => {
    if (!tableId) {
      return;
    }

    const presenceKey = getTableCommentChannel(tableId);
    const presence = connection?.getPresence(presenceKey);

    if (!presence || !connection) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      const remoteData = get(remotePresences, presenceKey);
      if (remoteData) {
        const remoteRecordId = remoteData.data.recordId;
        // `pre` can be the react-query cache data, so never mutate it
        setCommentCount((pre) => {
          const index = pre.findIndex((com) => com.recordId === remoteRecordId);
          if (index === -1) {
            return remoteData.type === CommentPatchType.CreateComment
              ? [...pre, { recordId: remoteRecordId, count: 1 }]
              : pre;
          }
          const delta =
            remoteData.type === CommentPatchType.CreateComment
              ? 1
              : remoteData.type === CommentPatchType.DeleteComment
                ? -1
                : 0;
          const count = pre[index].count + delta;
          if (count === 0) {
            return pre.filter((_, i) => i !== index);
          }
          return pre.map((com, i) => (i === index ? { ...com, count } : com));
        });
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, tableId]);

  return useMemo(() => {
    return Object.fromEntries(commentCount.map((item) => [item.recordId, item.count]));
  }, [commentCount]);
};
