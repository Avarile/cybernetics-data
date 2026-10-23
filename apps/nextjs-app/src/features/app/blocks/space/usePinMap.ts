import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useIsReadOnlyPreview } from '@cybernetics/sdk/hooks';
import { useQuery } from '@tanstack/react-query';
import type { IGetPinListVo } from '@teable/openapi';
import { getPinList } from '@teable/openapi';

export const usePinMap = () => {
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { data: pinListData } = useQuery({
    queryKey: ReactQueryKeys.pinList(),
    queryFn: () => getPinList().then((data) => data.data),
    enabled: !isReadOnlyPreview,
  });

  return pinListData?.reduce(
    (acc, pin) => {
      acc[pin.id] = pin;
      return acc;
    },
    {} as Record<string, IGetPinListVo[number]>
  );
};
