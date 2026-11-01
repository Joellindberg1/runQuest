import type { User } from '@runquest/types';
import { LEGENDARY_AUTO_START_DAYS, type ChallengeGroupStat, type ChallengeTier, type HeadToHeadRecord } from '@runquest/shared';
import { getInitials, leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { firstName } from '@/shared/utils/format';
import type { ResultTone, SentCard, TierGroup, TokenCard } from './duelsModel';

// Send-sheetens logik: varför man inte kan skicka, motståndarvalen och head-to-head-tipsen. Ren logik.

export type SendBlock = 'no-tokens' | 'live' | 'sent' | 'incoming';

export interface SendBlocker {
  reason: SendBlock;
  message: string;
}

/**
 * Varför jag inte kan skicka just nu (backend /send avvisar redan med 400 om jag har en aktiv ELLER väntande utmaning,
 * som utmanare eller motståndare). Gäller i denna ordning; null = det går att skicka.
 */
export function sendBlocker(input: {
  tokenCount: number;
  inLiveDuel: boolean;
  sent: SentCard | null;
  incomingCount: number;
}): SendBlocker | null {
  if (input.inLiveDuel) {
    return { reason: 'live', message: 'You are in a live duel. You can send another one once it is settled.' };
  }
  if (input.sent) {
    return {
      reason: 'sent',
      message: `Your challenge to ${firstName(input.sent.to)} is waiting for an answer. Withdraw it or wait for the reply before sending another.`,
    };
  }
  if (input.incomingCount > 0) {
    return { reason: 'incoming', message: 'A challenge is waiting on you. Answer it before you send one of your own.' };
  }
  if (input.tokenCount === 0) {
    return { reason: 'no-tokens', message: 'You have no tokens to send. You earn them by levelling up.' };
  }
  return null;
}

// ─── Send-sheetens motståndarval ──────────────────────────────────────────────

export interface OpponentOption {
  userId: string;
  name: string;
  initials: string;
  pictureUrl: string | null;
  /** "Level 24 · #1 · 39 XP / day" */
  note: string;
  h2h: { text: string; tone: ResultTone } | null;
  disabled: boolean;
  disabledReason: string | null;
}

/**
 * Head-to-head ur mitt perspektiv: "2–0 to you" · "0–1 to Nicklas" · "drawn 1" · "never met". Könsneutralt: namnet, eller "them" när namnet saknas, aldrig him/her.
 * Popupens head-to-head-mening (features/runner) är en annan text om samma post.
 */
export function h2hHint(record: HeadToHeadRecord | undefined, opponentFirstName: string): OpponentOption['h2h'] {
  const them = opponentFirstName || 'them';
  if (!record) return null;
  if (record.total === 0) return { text: 'never met', tone: 'muted' };
  const score = `${record.wins}–${record.losses}`;
  if (record.wins > record.losses) return { text: `${score} to you`, tone: 'up' };
  if (record.losses > record.wins) return { text: `${score} to ${them}`, tone: 'down' };
  return { text: record.wins === 0 ? `drawn ${record.draws}` : `${score} level`, tone: 'muted' };
}

/** Varför en medlem inte går att utmana just nu: i en live-duell, eller har skickat en utmaning som väntar på svar (mottagaren av en väntande utmaning flaggas inte av group-stats). */
export type OpponentBusy = 'duel' | 'waiting';

export function opponentBusy(member: Pick<ChallengeGroupStat, 'challenge_active' | 'has_pending_challenge'>): OpponentBusy | null {
  if (member.challenge_active) return 'duel';
  return member.has_pending_challenge ? 'waiting' : null;
}

const BUSY_LABEL: Record<OpponentBusy, string> = { duel: 'In a duel', waiting: 'Waiting on a reply' };

export function buildOpponents(input: {
  members: readonly ChallengeGroupStat[];
  users: readonly User[] | undefined;
  meId: string;
  headToHead: Record<string, HeadToHeadRecord | undefined>;
}): OpponentOption[] {
  const userOf = (id: string) => input.users?.find((user) => user.id === id);

  const entries = input.members
    .filter((member) => member.user_id !== input.meId)
    .map((member) => {
      const user = userOf(member.user_id);
      const stats = user ? leaderboardUtils.calculateUserStats(user) : null;
      const rank = (user && input.users ? leaderboardUtils.rankOfUser(user, input.users) : null) ?? Number.MAX_SAFE_INTEGER;
      const busy = opponentBusy(member);
      const option: OpponentOption = {
        userId: member.user_id,
        name: member.name,
        initials: getInitials(member.name),
        pictureUrl: member.profile_picture ?? user?.profile_picture ?? null,
        note: stats
          ? `Level ${stats.level} · #${rank} · ${stats.avgXpPer14Days} XP / day`
          : `Level ${member.current_level}`,
        h2h: h2hHint(input.headToHead[member.user_id], firstName(member.name)),
        disabled: busy !== null,
        disabledReason: busy && BUSY_LABEL[busy],
      };
      return { option, rank };
    });

  // Lediga först (i XP-ordning, annars namn), upptagna sist.
  entries.sort(
    (a, b) => Number(a.option.disabled) - Number(b.option.disabled) || a.rank - b.rank || a.option.name.localeCompare(b.option.name),
  );
  return entries.map((entry) => entry.option);
}

// ─── Förval av nivå och token ─────────────────────────────────────────────────

/**
 * Vad send-flödet förväljer när det öppnas (ADR 006, addendum 2026-10-26, punkt 5): Send på ett tokenkort → nivå och kort;
 * en nivåchip → bara nivån (`tokenKey: null`). null = inget (rubrikens Send, Challenge från popupen, djuplänk). Motståndaren
 * förväljs aldrig här utan via `?opponent=`. Förvalet är komponenttillstånd och nollställs när flödet stängs.
 */
export interface SendPreselection {
  tier: ChallengeTier;
  tokenKey: string | null;
}

/**
 * Där send-flödet börjar: förvald nivå om den har tokens, annars första nivån som har det. Kortet är det förvalda om det
 * finns kvar på nivån, annars det ensamma kortet på nivån, annars inget — aldrig förra valet. null utan några tokens.
 */
export function startingChoice(groups: readonly TierGroup[], preselection: SendPreselection | null): SendPreselection | null {
  const preferred = groups.find((group) => group.tier === preselection?.tier && group.selectable);
  const group = preferred ?? groups.find((candidate) => candidate.selectable);
  if (!group) return null;

  const chosen = preferred && group.cards.find((card) => card.tokenKey === preselection?.tokenKey);
  const lone = group.cards.length === 1 ? group.cards[0] : undefined;
  return { tier: group.tier, tokenKey: (chosen ?? lone)?.tokenKey ?? null };
}

/** `?opponent=` gäller bara om personen går att utmana: i gruppen, inte jag själv, inte upptagen. */
export function resolveOpponentParam(param: string | null, options: readonly OpponentOption[]): string | null {
  return options.find((option) => option.userId === param && !option.disabled)?.userId ?? null;
}

// ─── "The bet" ────────────────────────────────────────────────────────────────

const STARTS_AFTER_ACCEPT = 'Midnight after it is accepted';

/** Det enda stället som vet att en legendary också startar av sig själv: "The bet" och bekräftelsen efter en skickad utmaning bygger båda på den. */
function unansweredClause(tier: ChallengeTier): string | null {
  return tier === 'legendary' ? `or after ${LEGENDARY_AUTO_START_DAYS} d unanswered` : null;
}

/**
 * "Starts" i "The bet": en utmaning börjar vid gruppens nästa midnatt efter accepten (routes/challenges.ts, `groupNextMidnight`), aldrig i samma ögonblick.
 * En legendary kan inte avböjas och startar av sig själv efter `LEGENDARY_AUTO_START_DAYS` dagar utan svar (challengeScheduler): dagarna kommer ur samma
 * konstant som schemaläggaren läser, så texten och regeln inte kan glida isär.
 */
export function startRuleText(tier: ChallengeTier): string {
  const clause = unansweredClause(tier);
  return clause ? `${STARTS_AFTER_ACCEPT}, ${clause}` : STARTS_AFTER_ACCEPT;
}

/** Samma regel som `startRuleText`, som en mening efter "Challenge sent to …". */
export function startRuleSentence(tier: ChallengeTier): string {
  const clause = unansweredClause(tier);
  return `It starts at midnight after they accept${clause ? `, ${clause}` : ''}.`;
}

/** Rubriken i "The bet": vad som saknas, och därefter vad vadet är ("Most km vs Karl · 7 days"). */
export function betSummary(card: TokenCard | null, opponentFirstName: string | null): string {
  if (!card) return opponentFirstName ? 'Pick a challenge' : 'Pick a challenge and an opponent';
  if (!opponentFirstName) return 'Pick an opponent';
  return `${card.metricLabel} vs ${opponentFirstName} · ${card.durationLabel}`;
}

