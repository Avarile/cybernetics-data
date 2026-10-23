import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useQuery } from '@tanstack/react-query';
import { getSpaceList } from '@teable/openapi';

export const useSpaceList = () => {
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  return { spaceList };
};
