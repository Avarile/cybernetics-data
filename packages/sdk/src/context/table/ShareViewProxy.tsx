import type {
  IViewVo,
  ISort,
  IColumnMetaRo,
  IFilter,
  IGroup,
  IColumnMeta,
} from '@cybernetics/core';
import { pick } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { useView } from '../../hooks/use-view';
import type { IViewInstance } from '../../model/view/factory';
import { createViewInstance } from '../../model/view/factory';
import { ViewContext } from '../view/ViewContext';

// Properties that don't need to be updated when view updates come from op
const enableKey = ['filter', 'sort'];

interface IViewProxyProps {
  serverData?: IViewVo[];
  children: React.ReactNode;
}

type IProxyViewInstance = Omit<
  IViewInstance,
  'updateFilter' | 'updateSort' | 'updateGroup' | 'updateOption' | 'updateColumnMeta'
>;

interface IProxyView extends IProxyViewInstance {
  updateFilter: (filter: IFilter) => void;
  updateSort: (sort: ISort) => void;
  updateGroup: (group: IGroup) => void;
  updateOption: (option: object) => void;
  updateColumnMeta: (columnMeta: IColumnMetaRo) => void;
}

export const getViewData = (view?: IViewInstance, initData?: IViewVo[]) => {
  const data = view?.['doc']?.data || initData?.[0];
  if (!data) {
    return;
  }
  const enableValue = enableKey.reduce((acc, key) => {
    acc[key] = null;
    return acc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as any);
  return { ...data, ...enableValue };
};

export const ShareViewProxy = (props: IViewProxyProps) => {
  const { serverData, children } = props;
  const view = useView();
  const [viewData, setViewData] = useState<IViewVo>(getViewData(view, serverData));
  // Keys the viewer owns locally; every other key follows the server view
  const localKeysRef = useRef(new Set<string>(enableKey));
  const [proxyView, setProxyView] = useState<IProxyView | undefined>(() => {
    if (!viewData || !view?.id) return;
    return createViewInstance(viewData) as IProxyView;
  });

  useEffect(() => {
    setViewData((viewData) => ({
      ...getViewData(view, serverData),
      ...pick(viewData, [...localKeysRef.current]),
    }));
  }, [serverData, view]);

  useEffect(() => {
    if (!viewData || !view?.id) return;
    const newViewProxy = createViewInstance(viewData) as IProxyView;
    newViewProxy.updateSort = (sort: ISort) => {
      localKeysRef.current.add('sort');
      setViewData({
        ...viewData,
        sort,
      });
    };

    newViewProxy.updateFilter = (filter: IFilter) => {
      localKeysRef.current.add('filter');
      setViewData({
        ...viewData,
        filter,
      });
    };

    newViewProxy.updateGroup = (group: IGroup) => {
      localKeysRef.current.add('group');
      setViewData({
        ...viewData,
        group,
      });
    };

    newViewProxy.updateOption = (option: object) => {
      localKeysRef.current.add('options');
      setViewData({
        ...viewData,
        options: {
          ...(viewData?.options ?? {}),
          ...option,
        },
      });
    };
    newViewProxy.updateColumnMeta = (columnMeta: IColumnMetaRo) => {
      localKeysRef.current.add('columnMeta');
      const newViewData = {
        ...viewData,
        columnMeta: {
          ...viewData.columnMeta,
          ...columnMeta.reduce((acc, { fieldId, columnMeta }) => {
            acc[fieldId] = {
              ...viewData.columnMeta?.[fieldId],
              ...columnMeta,
            };
            return acc;
          }, {} as IColumnMeta),
        },
      };
      setViewData(newViewData);
    };
    setProxyView(newViewProxy);
  }, [viewData, view?.id]);

  return (
    <ViewContext.Provider value={{ views: (proxyView ? [proxyView] : []) as IViewInstance[] }}>
      {children}
    </ViewContext.Provider>
  );
};
