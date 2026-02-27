import { useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';

export const useTitleSystemData = () => {
  const { data: titles = [], isLoading: loading } = useTitleLeaderboard();
  return { titles, loading };
};
