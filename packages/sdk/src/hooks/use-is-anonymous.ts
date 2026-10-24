import { isAnonymous } from '@cybernetics/core';
import { useSession } from './use-session';

export const useIsAnonymous = () => {
  const { user } = useSession();
  return isAnonymous(user?.id);
};
