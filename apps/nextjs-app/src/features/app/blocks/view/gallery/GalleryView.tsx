import { RecordProvider, RowCountProvider } from '@cybernetics/sdk/context';
import { SearchProvider } from '@cybernetics/sdk/context/query';
import { useIsHydrated, usePersonalView } from '@cybernetics/sdk/hooks';
import { GalleryToolBar } from '../tool-bar/GalleryToolBar';
import { GalleryProvider } from './context';
import { GalleryViewBase } from './GalleryViewBase';

export const GalleryView = () => {
  const isHydrated = useIsHydrated();
  const { personalViewCommonQuery } = usePersonalView();

  return (
    <SearchProvider>
      <RecordProvider>
        <RowCountProvider query={personalViewCommonQuery}>
          <GalleryToolBar />
          <GalleryProvider>
            <div className="w-full grow overflow-hidden">{isHydrated && <GalleryViewBase />}</div>
          </GalleryProvider>
        </RowCountProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
