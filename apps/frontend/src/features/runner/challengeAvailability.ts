import type { ChallengeGroupStat, MyChallengesData } from '@runquest/shared';
import { buildSent, nameMap } from '@/features/challenges/duelsModel';
import { opponentBusy, sendBlocker, type OpponentBusy } from '@/features/challenges/sendModel';
import { firstName } from '@/shared/utils/format';

/**
 * Om popupens Challenge går att använda, och annars varför. `loading` = en kunskapskälla svarar inte än: knappen är avstängd utan text. `ready` gäller också när en fråga har felat,
 * eftersom servern validerar utskicket i alla fall (en gissning om "nej" vore värre än ett avvisat försök).
 */
export type ChallengeAvailability =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'blocked'; reason: string };

interface AvailabilityInput {
  meId: string;
  runnerId: string;
  /** Mina utmaningar (samma fråga som Duels), eller undefined medan den laddar eller har felat. */
  my: MyChallengesData | undefined;
  /** Gruppens ställning (samma fråga som Duels send-ark), eller undefined medan den laddar eller har felat. */
  groupStats: readonly ChallengeGroupStat[] | undefined;
  /** Någon av de två frågorna har inte svarat (och inte felat). */
  loading: boolean;
}

const busySentence: Record<OpponentBusy, (name: string) => string> = {
  duel: (name) => `${name} is in a live duel right now.`,
  waiting: (name) => `${name} is waiting on a reply to a challenge.`,
};

/**
 * Mitt eget hinder kommer först och är exakt send-arkets (`sendBlocker`, med samma indata som Duels bygger den av); sedan löparen: upptagen enligt samma regel som send-arket
 * använder för att stänga av en motståndare (`opponentBusy`). Känt "nej" visas direkt, även medan den andra frågan laddar.
 */
export function challengeAvailability({ meId, runnerId, my, groupStats, loading }: AvailabilityInput): ChallengeAvailability {
  if (my) {
    const blocker = sendBlocker({
      tokenCount: my.tokens.length,
      inLiveDuel: my.group_active.some((challenge) => challenge.challenger_id === meId || challenge.opponent_id === meId),
      sent: buildSent(my.sent_challenge, nameMap(groupStats ?? [])),
      incomingCount: my.received_challenges.length,
    });
    if (blocker) return { status: 'blocked', reason: blocker.message };
  }

  const runner = groupStats?.find((member) => member.user_id === runnerId);
  const busy = runner && opponentBusy(runner);
  if (runner && busy) return { status: 'blocked', reason: busySentence[busy](firstName(runner.name)) };

  return loading ? { status: 'loading' } : { status: 'ready' };
}
