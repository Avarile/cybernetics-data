import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  TaskStatusCollectionProvider,
} from '@cybernetics/sdk/context';
import { SearchProvider } from '@cybernetics/sdk/context/query';
import { usePersonalView } from '@cybernetics/sdk/hooks';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const { personalViewCommonQuery, personalViewAggregationQuery } = usePersonalView();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider query={personalViewAggregationQuery}>
          <TaskStatusCollectionProvider>
            <RowCountProvider query={personalViewCommonQuery}>
              <GridToolBar />
              <div className="w-full grow overflow-hidden sm:pl-2">
                <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />
              </div>
            </RowCountProvider>
          </TaskStatusCollectionProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
