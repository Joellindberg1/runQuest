import type { User } from '@runquest/types';
import type { HeadToHeadRecord } from '@runquest/shared';
import { getInitials, leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { firstName } from './duelsFormat';
import type { GroupStat, ResultTone, SentCard } from './duelsModel';

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

/** Head-to-head ur mitt perspektiv: "2–0 to you" · "0–1 to Nicklas" · "drawn 1" · "never met". */
export function h2hHint(record: HeadToHeadRecord | undefined, opponentFirstName: string): OpponentOption['h2h'] {
  if (!record) return null;
  if (record.total === 0) return { text: 'never met', tone: 'muted' };
  const score = `${record.wins}–${record.losses}`;
  if (record.wins > record.losses) return { text: `${score} to you`, tone: 'up' };
  if (record.losses > record.wins) return { text: `${score} to ${opponentFirstName}`, tone: 'down' };
  return { text: record.wins === 0 ? `drawn ${record.draws}` : `${score} level`, tone: 'muted' };
}

export function buildOpponents(input: {
  members: readonly GroupStat[];
  users: readonly User[] | undefined;
  meId: string;
  headToHead: Record<string, HeadToHeadRecord | undefined>;
}): OpponentOption[] {
  const sortedUsers = input.users ? leaderboardUtils.filterAndSortUsers([...input.users]) : [];
  const userOf = (id: string) => input.users?.find((user) => user.id === id);

  const entries = input.members
    .filter((member) => member.user_id !== input.meId)
    .map((member) => {
      const user = userOf(member.user_id);
      const stats = user ? leaderboardUtils.calculateUserStats(user) : null;
      const rank = user ? leaderboardUtils.getUserPosition(user, sortedUsers) : Number.MAX_SAFE_INTEGER;
      const busy = member.challenge_active ? 'In a duel' : member.has_pending_challenge ? 'Waiting on a reply' : null;
      const option: OpponentOption = {
        userId: member.user_id,
        name: member.name,
        initials: getInitials(member.name).slice(0, 2),
        pictureUrl: member.profile_picture ?? user?.profile_picture ?? null,
        note: stats
          ? `Level ${stats.level} · #${rank} · ${stats.avgXpPer14Days} XP / day`
          : `Level ${member.current_level}`,
        h2h: h2hHint(input.headToHead[member.user_id], firstName(member.name)),
        disabled: busy !== null,
        disabledReason: busy,
      };
      return { option, rank };
    });

  // Lediga först (i XP-ordning, annars namn), upptagna sist.
  entries.sort(
    (a, b) => Number(a.option.disabled) - Number(b.option.disabled) || a.rank - b.rank || a.option.name.localeCompare(b.option.name),
  );
  return entries.map((entry) => entry.option);
}

/** `?opponent=` gäller bara om personen går att utmana: i gruppen, inte jag själv, inte upptagen. */
export function resolveOpponentParam(param: string | null, options: readonly OpponentOption[]): string | null {
  return options.find((option) => option.userId === param && !option.disabled)?.userId ?? null;
}

