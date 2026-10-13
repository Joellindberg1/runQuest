import { useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';

/** Hur ett försök gick, på formulärets språk. `invalid` = servern vägrade adressen (400), `failed` = allt annat än 200 och 429. */
export type JoinOutcome = 'joined' | 'invalid' | 'rate-limited' | 'failed';

export interface JoinWaitlistInput {
  email: string;
  /** Honeypot-fältets värde; tomt för människor. */
  website: string;
}

function outcomeOf(result: { status: number } | null): JoinOutcome {
  if (!result) return 'failed';
  if (result.status === 200) return 'joined';
  if (result.status === 400) return 'invalid';
  if (result.status === 429) return 'rate-limited';
  return 'failed';
}

/**
 * Väntelistans enda anrop (POST /api/waitlist, publik). Samtycket är alltid true: formuläret skickar inte utan bocken.
 * `elapsedMs` är tiden från att formuläret monterades till skicket (servern kastar tyst allt snabbare än två sekunder).
 * Inga dubbla skick: ett anrop medan ett annat pågår skickar inget och ger null.
 */
export function useJoinWaitlist() {
  const mountedAt = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { mountedAt.current = Date.now(); }, []);

  const mutation = useMutation({
    mutationFn: (input: JoinWaitlistInput) => backendApi.joinWaitlist({
      email: input.email,
      consent: true,
      website: input.website,
      elapsedMs: Math.max(0, Date.now() - mountedAt.current),
    }),
  });
  const { mutateAsync } = mutation;

  const join = useCallback(async (input: JoinWaitlistInput): Promise<JoinOutcome | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      return outcomeOf(await mutateAsync(input));
    } catch {
      return 'failed';
    } finally {
      inFlight.current = false;
    }
  }, [mutateAsync]);

  return { join, isPending: mutation.isPending };
}
