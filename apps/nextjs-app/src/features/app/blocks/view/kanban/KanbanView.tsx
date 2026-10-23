import { GroupPointProvider, RecordProvider } from '@cybernetics/sdk/context';
import { SearchProvider } from '@cybernetics/sdk/context/query';
import { useIsHydrated, usePersonalView } from '@cybernetics/sdk/hooks';
import { KanbanToolBar } from '../tool-bar/KanbanToolBar';
import { KanbanProvider } from './context';
import { KanbanViewBase } from './KanbanViewBase';

export const KanbanView = () => {
  const isHydrated = useIsHydrated();
  const { personalViewCommonQuery } = usePersonalView();

  return (
    <SearchProvider>
      <RecordProvider>
        <GroupPointProvider query={personalViewCommonQuery}>
          <KanbanToolBar />
          <KanbanProvider>
            <div className="w-full grow overflow-hidden">{isHydrated && <KanbanViewBase />}</div>
          </KanbanProvider>
        </GroupPointProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
