import { useIsTouchDevice } from '@cybernetics/sdk/hooks';
import { Search } from '@teable/icons';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  Input,
  ScrollArea,
  Separator,
} from '@teable/ui-lib/shadcn';
import { ChevronLeft } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { helpPages, type HelpPage } from './helpPages';
import { useHelpStore } from './useHelpStore';

const navGroups = [
  {
    title: 'Space',
    paths: [
      '/en/basic/space',
      '/en/basic/space/space-invite',
      '/en/basic/space/base-invite',
      '/en/basic/space/space-permission',
      '/en/basic/space/billing',
    ],
  },
  {
    title: 'Base',
    paths: ['/en/basic/base/base'],
  },
  {
    title: 'Table',
    paths: ['/en/basic/table', '/en/basic/table/import', '/en/basic/table/export'],
  },
  {
    title: 'Field',
    paths: ['/en/basic/field'],
  },
  {
    title: 'Basic Field',
    paths: [
      '/en/basic/field/basic/single-line-text',
      '/en/basic/field/basic/long-text',
      '/en/basic/field/basic/number',
      '/en/basic/field/basic/single-select',
      '/en/basic/field/basic/multiple-select',
      '/en/basic/field/basic/date',
      '/en/basic/field/basic/rating',
      '/en/basic/field/basic/checkbox',
    ],
  },
  {
    title: 'Advanced Field',
    paths: [
      '/en/basic/field/advanced/formula',
      '/en/basic/field/advanced/formula/grammar',
      '/en/basic/field/advanced/formula/cheat-sheet',
      '/en/basic/field/advanced/link',
      '/en/basic/field/advanced/rollup',
      '/en/basic/field/advanced/lookup',
      '/en/basic/field/advanced/conditional-rollup',
      '/en/basic/field/advanced/conditional-lookup',
      '/en/basic/field/advanced/user',
      '/en/basic/field/advanced/created-by',
      '/en/basic/field/advanced/last-modified-by',
      '/en/basic/field/advanced/created-time',
      '/en/basic/field/advanced/last-modified-time',
      '/en/basic/field/advanced/auto-number',
    ],
  },
  {
    title: 'Field Common',
    paths: [
      '/en/basic/field/common/formatter',
      '/en/basic/field/common/show-as',
      '/en/basic/field/common/is-multiple-value',
    ],
  },
  {
    title: 'Record',
    paths: ['/en/basic/record', '/en/basic/record/comment', '/en/basic/record/record-history'],
  },
  {
    title: 'View Toolbar',
    paths: [
      '/en/basic/view/toolbar/filter',
      '/en/basic/view/toolbar/group',
      '/en/basic/view/toolbar/sort',
      '/en/basic/view/toolbar/share',
      '/en/basic/view/toolbar/collaboration-mode',
    ],
  },
  {
    title: 'View',
    paths: [
      '/en/basic/view/grid',
      '/en/basic/view/form',
      '/en/basic/view/kanban',
      '/en/basic/view/gallery',
      '/en/basic/view/calendar',
    ],
  },
];

const pageByPath = new Map(helpPages.map((p) => [p.path, p]));

function getCategory(page: HelpPage): string {
  return navGroups.find((g) => g.paths.includes(page.path))?.title ?? 'Docs';
}

function getAdjacentPages(path: string) {
  const idx = helpPages.findIndex((p) => p.path === path);
  return {
    previousPage: idx > 0 ? helpPages[idx - 1] : undefined,
    nextPage: idx < helpPages.length - 1 ? helpPages[idx + 1] : undefined,
  };
}

export const HelpModal: React.FC = () => {
  const { open, setOpen } = useHelpStore();
  const [currentPath, setCurrentPath] = useState(helpPages[0].path);
  const [query, setQuery] = useState('');
  const [showMobileContent, setShowMobileContent] = useState(false);
  const isTouchDevice = useIsTouchDevice();

  const currentPage = pageByPath.get(currentPath) ?? helpPages[0];

  const { previousPage, nextPage } = getAdjacentPages(currentPath);

  const groupedPages = useMemo(
    () =>
      navGroups.map((group) => ({
        ...group,
        pages: group.paths
          .map((path) => pageByPath.get(path))
          .filter((p): p is HelpPage => Boolean(p)),
      })),
    []
  );

  const searchResults = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return null;
    return helpPages.filter(
      (p) =>
        p.title.toLowerCase().includes(trimmed) || p.description.toLowerCase().includes(trimmed)
    );
  }, [query]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setQuery('');
    if (isTouchDevice) setShowMobileContent(true);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setCurrentPath(helpPages[0].path);
      setQuery('');
      setShowMobileContent(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[80vh] max-h-[80vh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 [&>button]:right-4 [&>button]:top-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="h-8 border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
            placeholder="Search help..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Body */}
        {searchResults ? (
          /* Search results */
          <ScrollArea className="flex-1">
            <div className="p-4">
              {searchResults.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No results found.</p>
              ) : (
                <ul className="space-y-1">
                  {searchResults.map((page) => (
                    <li key={page.path}>
                      <button
                        type="button"
                        className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
                        onClick={() => navigateTo(page.path)}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {getCategory(page)}
                          </Badge>
                          <span className="text-sm font-medium">{page.title}</span>
                        </div>
                        {page.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {page.description}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        ) : (
          /* Two-column layout (desktop) / single-column (mobile) */
          <div className="flex min-h-0 flex-1">
            {/* Sidebar nav */}
            {(!isTouchDevice || !showMobileContent) && (
              <ScrollArea className={cn('shrink-0', isTouchDevice ? 'w-full' : 'w-56 border-r')}>
                <nav className="space-y-5 p-3">
                  {groupedPages.map((group) => (
                    <div key={group.title}>
                      <div className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                      </div>
                      <div className="space-y-0.5">
                        {group.pages.map((page) => (
                          <button
                            key={page.path}
                            type="button"
                            onClick={() => navigateTo(page.path)}
                            className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
                              page.path === currentPath
                                ? 'bg-muted font-medium text-foreground'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {page.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </nav>
              </ScrollArea>
            )}

            {/* Content area */}
            {(!isTouchDevice || showMobileContent) && (
              <ScrollArea className="flex-1">
                {isTouchDevice && (
                  <div className="flex items-center border-b px-3 py-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowMobileContent(false)}
                      className="flex items-center gap-1"
                    >
                      <ChevronLeft className="size-4" />
                      Back
                    </Button>
                  </div>
                )}
                <article className={cn('py-6', isTouchDevice ? 'px-4' : 'px-8')}>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {getCategory(currentPage)}
                    </Badge>
                  </div>
                  <h1 className="mb-6 text-2xl font-semibold tracking-tight">
                    {currentPage.title}
                  </h1>

                  <div
                    className="
                    text-sm leading-relaxed text-foreground
                    [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80
                    [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
                    [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5
                    [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-4 [&_h1]:mt-6
                    [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-3
                    [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold
                    [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base
                    [&_h3]:font-semibold [&_h4]:mb-2
                    [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_img]:hidden
                    [&_li]:mb-1 [&_li]:text-sm [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3
                    [&_p]:text-sm [&_p]:leading-relaxed [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3
                    [&_pre]:font-mono [&_pre]:text-xs [&_strong]:font-semibold [&_table]:w-full
                    [&_table]:border-collapse [&_table]:text-sm [&_td]:border
                    [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3
                    [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_ul]:mb-3
                    [&_ul]:list-disc
                    [&_ul]:pl-5
                  "
                    dangerouslySetInnerHTML={{ __html: currentPage.contentHtml }}
                  />

                  <Separator className="my-6" />

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {currentPage.lastModified ? `Last modified ${currentPage.lastModified}` : ''}
                    </span>
                    <div className="flex gap-2">
                      {previousPage && (
                        <button
                          type="button"
                          onClick={() => setCurrentPath(previousPage.path)}
                          className="rounded-md border px-3 py-1 transition-colors hover:bg-muted"
                        >
                          ← Previous
                        </button>
                      )}
                      {nextPage && (
                        <button
                          type="button"
                          onClick={() => setCurrentPath(nextPage.path)}
                          className="rounded-md border px-3 py-1 transition-colors hover:bg-muted"
                        >
                          Next →
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              </ScrollArea>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
