import type { FieldType } from '@cybernetics/core';
import type { IFilterComponents } from '@cybernetics/sdk/components';
import { FilterUserSelectBase } from '@cybernetics/sdk/components/filter/view-filter/component';
import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { ShareViewContext } from '@cybernetics/sdk/context';
import { useQuery } from '@tanstack/react-query';
import { getShareViewCollaborators } from '@teable/openapi';
import { useContext, useState } from 'react';

export const FilterUser: IFilterComponents[FieldType.User] = (props) => {
  const { shareId } = useContext(ShareViewContext);
  const [search, setSearch] = useState('');
  const { data: userQuery } = useQuery({
    queryKey: ReactQueryKeys.shareViewCollaborators(shareId, {
      fieldId: props.field.id,
      skip: 0,
      take: 100,
      search,
    }),
    queryFn: ({ queryKey }) =>
      getShareViewCollaborators(queryKey[1], {
        fieldId: queryKey[2]?.fieldId,
        skip: queryKey[2]?.skip,
        take: queryKey[2]?.take,
        search: queryKey[2]?.search,
      }).then((data) => data.data),
  });
  return <FilterUserSelectBase {...props} data={userQuery} disableMe onSearch={setSearch} />;
};
