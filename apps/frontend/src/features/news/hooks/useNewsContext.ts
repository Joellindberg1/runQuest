import { useMemo } from 'react';
import { useNow } from '@/app-shell/useNow';
import { useAuth } from '@/providers/authContext';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import type { NewsContext } from '../newsModel';

/**
 * Det raderna renderas mot: vem som tittar, klockan och två uppslag ur gruppens användare (samma cache som skalet) —
 * tävlingsvinnarens namn (event_closed bär bara ett id) och kön för "King/Queen"-titlar. Klockan tickar var 30:e sekund så
 * "2h" och dag-rubrikerna följer med utan omhämtning.
 */
export function useNewsContext(): NewsContext {
  const { user } = useAuth();
  const now = useNow();
  const users = useUsersWithRuns(!!user);

  return useMemo<NewsContext>(() => {
    const byId = new Map((users.data ?? []).map((member) => [member.id, member]));
    return {
      viewerId: user?.id ?? null,
      now,
      nameOf: (id) => byId.get(id)?.name,
      genderOf: (id) => byId.get(id)?.gender,
    };
  }, [user?.id, now, users.data]);
}
