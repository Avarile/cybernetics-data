import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useQuery } from '@tanstack/react-query';
import { getPublicSetting } from '@teable/openapi';

export const useDisallowSignUp = () => {
  const { data: setting } = useQuery({
    queryKey: ReactQueryKeys.getPublicSetting(),
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });
  const { disallowSignUp } = setting ?? {};
  return disallowSignUp;
};
