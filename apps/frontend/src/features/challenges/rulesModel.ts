import type { ChallengeTier } from '@runquest/types';
import type { ChallengeHistoryItem } from '@runquest/shared';
import { TIERS, stakeOf, tierLabel, type Stake, type StakeSource } from './duelsFormat';

// Rules-vyn: insatser per nivå och reglerna som inte syns på nivåkorten. Ren logik.

/**
 * Seed-värdena i challenge_rewards (migration 006). Insatserna är databaskonfiguration — vyn läser dem hellre ur
 * verkliga tokens/utmaningar (`observedStakes`) och faller bara tillbaka hit för nivåer där inget exempel finns.
 */
export const DEFAULT_STAKES: Record<ChallengeTier, StakeSource> = {
  minor: { winner_delta: 0.15, winner_duration: 5, loser_delta: -0.07, loser_duration: 5 },
  major: { winner_delta: 0.25, winner_duration: 10, loser_delta: -0.12, loser_duration: 10 },
  legendary: { winner_delta: 0.5, winner_duration: 14, loser_delta: -0.25, loser_duration: 14 },
};

export interface StakeSample extends StakeSource {
  tier: ChallengeTier;
}

export function sampleFromHistory(item: ChallengeHistoryItem): StakeSample {
  return {
    tier: item.tier,
    winner_delta: item.winner_boost.delta,
    winner_duration: item.winner_boost.duration ?? 0,
    winner_type: item.winner_boost.type,
    loser_delta: item.loser_boost.delta,
    loser_duration: item.loser_boost.duration ?? 0,
    loser_type: item.loser_boost.type,
  };
}

/** Första verkliga exemplet per nivå (tokens först — de är de aktuella reglerna), annars seed-värdet. */
export function observedStakes(samples: readonly StakeSample[]): Record<ChallengeTier, Stake> {
  const pick = (tier: ChallengeTier): Stake => stakeOf(samples.find((sample) => sample.tier === tier) ?? DEFAULT_STAKES[tier]);
  return { minor: pick('minor'), major: pick('major'), legendary: pick('legendary') };
}

export interface TierRule {
  tier: ChallengeTier;
  label: string;
  body: string;
  stake: Stake;
}

const TIER_BODY: Record<ChallengeTier, string> = {
  minor: 'The everyday bet. Earned at most level-ups, so there are usually a few in your pocket.',
  major: 'A bigger swing with a real downside. Roughly one every fifth level — spend it on someone you can actually beat.',
  legendary: "The big one: earned every fifteenth level, with the biggest swing both ways. It can't be declined, and if nobody answers within four days it starts on its own.",
};

export function buildTierRules(stakes: Record<ChallengeTier, Stake>): TierRule[] {
  return TIERS.map((tier) => ({ tier, label: tierLabel(tier), body: TIER_BODY[tier], stake: stakes[tier] }));
}

export interface HowItWorksItem {
  title: string;
  body: string;
}

/** Reglerna som inte syns på nivåkorten. Allt här speglar backend (routes/challenges.ts, challengeScheduler, xpCalculation). */
export const HOW_IT_WORKS: readonly HowItWorksItem[] = [
  { title: 'One token, one duel', body: 'A token fixes the metric and the length. You choose who to point it at.' },
  { title: 'One at a time', body: 'You can only have one challenge going: sent, waiting on you or live.' },
  { title: 'Metrics', body: 'Most km, most runs or most XP over the duration. A duel starts the day after it is accepted.' },
  { title: 'The boost', body: "The winner's boost and the loser's penalty are added to the streak multiplier on every run until they run out. A draw changes nothing." },
  { title: 'Unanswered', body: 'A minor or major challenge lapses after three days and the token comes back to you.' },
];
