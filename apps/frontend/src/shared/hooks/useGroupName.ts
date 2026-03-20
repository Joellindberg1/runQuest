import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';

export function useGroupName(): string {
  const { data } = useQuery({
    queryKey: ['group', 'my'],
    queryFn: async () => {
      const res = await backendApi.getGroupInfo();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data?.name ?? '';
}
