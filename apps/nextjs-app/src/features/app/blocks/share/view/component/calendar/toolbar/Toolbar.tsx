import type { CalendarView } from '@cybernetics/sdk';
import { useView } from '@cybernetics/sdk/hooks/use-view';
import { Filter as FilterIcon } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { SearchButton } from '@/features/app/blocks/view/search/SearchButton';
import { ToolBarButton } from '@/features/app/blocks/view/tool-bar/ToolBarButton';
import { ShareViewFilter } from '../../share-view-filter';

export const CalendarToolbar: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as CalendarView | undefined;
  const { onFilterChange } = useToolbarChange();

  if (!view) return null;

  return (
    <div className="flex w-full items-center justify-between gap-2 border-b px-4 py-2 @container/toolbar">
      <ShareViewFilter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </ShareViewFilter>
      <div className="flex w-10 flex-1 justify-end">
        <SearchButton shareView />
      </div>
    </div>
  );
};
