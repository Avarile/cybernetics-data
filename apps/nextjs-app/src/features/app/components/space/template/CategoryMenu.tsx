import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useIsMobile } from '@cybernetics/sdk/hooks';
import { useQuery } from '@tanstack/react-query';
import { getTemplateCategoryList } from '@teable/openapi';
import { cn, Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { CategoryMenuItem } from './CategoryMenuItem';

interface ICategoryMenuProps {
  currentCategoryId: string | null;
  onCategoryChange: (category: string | null) => void;
  className?: string;
  categoryHeaderRender?: () => React.ReactNode;
  isFeatured: boolean | undefined;
  onFeaturedChange: (isFeatured: boolean | undefined) => void;
  disabledFeaturedToggle: boolean;
}

export const CategoryMenu = (props: ICategoryMenuProps) => {
  const {
    currentCategoryId,
    onCategoryChange,
    className,
    isFeatured,
    onFeaturedChange,
    disabledFeaturedToggle,
  } = props;
  const { t } = useTranslation('common');
  const { data: categoryListFromServer } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const isMobile = useIsMobile();

  const categoryList = useMemo(() => {
    return [
      {
        id: null,
        // "All", not "Recommended": this entry clears the category filter and no longer implies a
        // featured-only list — curation is what the Featured toggle below controls.
        name: t('settings.templateAdmin.category.menu.all'),
        order: -Infinity,
      },
      // Widen type so concat is valid (recommended + categories)
      ...(categoryListFromServer ?? []),
    ];
  }, [categoryListFromServer, t]);

  return (
    <div
      className={cn('flex flex-col gap-6 overflow-hidden px-2 pt-4 shrink-0 w-64', className, {
        'flex-row w-full': isMobile,
      })}
    >
      {categoryList && categoryList.length > 0 && (
        <div
          className={cn('flex flex-1 flex-col overflow-hidden', {
            'flex-row overflow-x-auto': isMobile,
          })}
        >
          <div
            className={cn('flex flex-1 flex-col overflow-auto gap-0.5', {
              'flex-row gap-x-0.5': isMobile,
            })}
          >
            {categoryList?.map(({ name, id }) => (
              <CategoryMenuItem
                key={id}
                category={name}
                id={id}
                currentCategoryId={currentCategoryId}
                onClickHandler={() => {
                  onCategoryChange(id);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!disabledFeaturedToggle && (
        <div
          className={cn('flex shrink-0 items-center justify-between gap-2 px-2 pb-2', {
            'pb-0 pl-0': isMobile,
          })}
        >
          <Label htmlFor="template-featured-only" className="text-sm text-muted-foreground">
            {t('settings.templateAdmin.header.featured')}
          </Label>
          <Switch
            id="template-featured-only"
            className="scale-90"
            checked={isFeatured === true}
            // Clearing the toggle must send undefined, not false: the API reads false as
            // "not featured" and would hide the curated templates instead of showing everything.
            onCheckedChange={(checked: boolean) => onFeaturedChange(checked ? true : undefined)}
          />
        </div>
      )}
    </div>
  );
};
