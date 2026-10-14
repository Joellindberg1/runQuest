// Notisslag och klassificering (ADR 011 beslut 3 och 4).
//
// Ett notisslag är det en användare slår av/på: en precis mening med en rad-typ och en roll. Varje rad i
// activity_log får EXAKT ETT slag ur betraktarens perspektiv (personliga slag före "others"), så att två reglage
// aldrig kan träffa samma rad. `isNotifiable` är den enda sanningen för "räknas den här raden på klockan?" och
// används av både servern (räknare, is_unread) och klienten (popover) — inget SQL-predikat dubblerar den.
//
// Våg 1 är registrerad sedan tidigare; våg 2 läggs till slag för slag tillsammans med sin skrivpunkt (ADR 011 beslut 1.3:
// inga reglage utan fakta bakom). Hittills: challenge_accepted_me och rank_passed_* (RUN-191); event_closed_me kommer med
// entrant_ids. En ny ActivityType utan klassificering fäller bygget (Record nedan) och kontraktstestet.

import { isActivityType, type ActivityType } from './activity.js';
import { readOwn, resolveSettingValue, userBooleanSetting } from './settingsCore.js';

export const NOTIFICATION_GROUPS = ['Titles', 'Challenges', 'Ranks', 'Events', 'The pack', 'System'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/** you = en rad som rör betraktaren, others = en rad som inte gör det, everyone = systemhändelser utan aktör. */
export type NotificationRole = 'you' | 'others' | 'everyone';

interface NotificationKindDefinition<K extends string> {
  kind: K;
  /** Inställningsnyckeln: `notify.<slag>` (ADR 011 beslut 2). */
  key: `notify.${K}`;
  /** Preliminär engelsk mening; slutlig copy kommer från Designern. */
  label: string;
  group: NotificationGroup;
  role: NotificationRole;
  default: boolean;
  /** Vilken våg slaget levereras i (ADR 011 beslut 12). */
  wave: 1 | 2;
}

function defineKind<K extends string>(
  kind: K,
  group: NotificationGroup,
  role: NotificationRole,
  label: string,
  wave: 1 | 2 = 1,
  defaultOn = true,
): NotificationKindDefinition<K> {
  return { kind, key: `notify.${kind}`, label, group, role, default: defaultOn, wave };
}

export const NOTIFICATION_KINDS = [
  defineKind('title_taken_from_me', 'Titles', 'you', 'Someone takes a title from you'),
  defineKind('title_others', 'Titles', 'others', 'Other title changes in the pack'),
  defineKind('challenge_received_me', 'Challenges', 'you', 'Someone challenges you'),
  defineKind('challenge_accepted_me', 'Challenges', 'you', 'Someone accepts your challenge', 2),
  defineKind('challenge_lost_me', 'Challenges', 'you', 'Someone beats you in a challenge'),
  defineKind('challenge_won_me', 'Challenges', 'you', 'You beat someone in a challenge'),
  defineKind('challenge_draw_me', 'Challenges', 'you', 'Your challenge ends in a draw'),
  defineKind('challenges_others', 'Challenges', 'others', 'Other challenges in the pack'),
  defineKind('rank_passed_xp_me', 'Ranks', 'you', 'Someone passes you on the leaderboard', 2),
  defineKind('rank_passed_challenge_me', 'Ranks', 'you', 'Someone passes you on the challenge standings', 2),
  // Ö1: enda slaget som startar avstängt — passeringar mellan andra är brus tills någon väljer in dem.
  defineKind('rank_passed_others', 'Ranks', 'others', 'Rank changes between others', 2, false),
  defineKind('event_open', 'Events', 'everyone', 'A new event opens'),
  defineKind('event_closed_others', 'Events', 'others', 'Other events close'),
  defineKind('level_up_others', 'The pack', 'others', 'Someone levels up'),
  defineKind('run_milestone_others', 'The pack', 'others', 'Someone passes a distance milestone'),
  defineKind('badge_earned_others', 'The pack', 'others', 'Someone earns a badge'),
  defineKind('streak_broken_others', 'The pack', 'others', 'Someone loses a streak'),
  defineKind('release_published', 'System', 'everyone', 'A new RunQuest version is out'),
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['kind'];

export function notifyKey(kind: NotificationKind): `notify.${NotificationKind}` {
  return `notify.${kind}`;
}

/** Indata till klassificeringen: den del av en activity_log-rad som slaget beror på. */
export interface ClassifiableRow {
  /** Råtext ur loggen: en typ som den här koden inte känner till (äldre/nyare klient) ger null. */
  type: string;
  actorId: string | null;
  targetId: string | null;
  payload: unknown;
}

export type NotificationClassification = NotificationKind | 'own' | null;

/** En raderad användare är null i loggen; null (och tomt id) är aldrig betraktaren. */
function isViewer(id: string | null | undefined, viewerId: string): boolean {
  return typeof id === 'string' && id !== '' && id === viewerId;
}

type Classifier = (row: ClassifiableRow, viewerId: string) => NotificationClassification;

/** Typer där egen handling aldrig är en notis och alla andra faller under ett "others"-slag. */
function ownOrOthers(others: NotificationKind): Classifier {
  return (row, viewerId) => (isViewer(row.actorId, viewerId) ? 'own' : others);
}

/** Slaget för "någon gick förbi mig", per mått. Ett mått som inte finns här ger null: aldrig fel reglage. */
const RANK_ME_KIND: ReadonlyMap<string, NotificationKind> = new Map<string, NotificationKind>([
  ['xp', 'rank_passed_xp_me'],
  ['challenge_points', 'rank_passed_challenge_me'],
]);

function rankMeKind(payload: unknown): NotificationKind | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const measure = (payload as { measure?: unknown }).measure;
  return typeof measure === 'string' ? (RANK_ME_KIND.get(measure) ?? null) : null;
}

// Record<ActivityType, …> är kompileringsgrinden: en ny typ i ACTIVITY_TYPES utan post här ger ett typfel.
const CLASSIFIERS: Record<ActivityType, Classifier> = {
  title_taken: (row, viewerId) => {
    if (isViewer(row.targetId, viewerId)) return 'title_taken_from_me';
    if (isViewer(row.actorId, viewerId)) return 'own';
    return 'title_others';
  },
  title_unlocked: ownOrOthers('title_others'),
  title_revoked: ownOrOthers('title_others'),
  challenge_received: (row, viewerId) => {
    if (isViewer(row.targetId, viewerId)) return 'challenge_received_me';
    if (isViewer(row.actorId, viewerId)) return 'own';
    return 'challenges_others';
  },
  // Undantaget från "egna handlingar räknas aldrig" (ADR 011 beslut 3): utfallet avgörs asynkront, så vinnaren
  // (actor) får en notis trots att raden är hens egen.
  challenge_won: (row, viewerId) => {
    if (isViewer(row.targetId, viewerId)) return 'challenge_lost_me';
    if (isViewer(row.actorId, viewerId)) return 'challenge_won_me';
    return 'challenges_others';
  },
  challenge_accepted: (row, viewerId) => {
    if (isViewer(row.targetId, viewerId)) return 'challenge_accepted_me';
    if (isViewer(row.actorId, viewerId)) return 'own';
    return 'challenges_others';
  },
  rank_passed: (row, viewerId) => {
    if (isViewer(row.targetId, viewerId)) return rankMeKind(row.payload);
    if (isViewer(row.actorId, viewerId)) return 'own';
    return 'rank_passed_others';
  },
  challenge_draw: (row, viewerId) =>
    isViewer(row.actorId, viewerId) || isViewer(row.targetId, viewerId)
      ? 'challenge_draw_me'
      : 'challenges_others',
  event_open: () => 'event_open',
  // entrant_ids finns inte än: event_closed_me kommer i våg 2 tillsammans med fältet.
  event_closed: () => 'event_closed_others',
  level_up: ownOrOthers('level_up_others'),
  run_milestone: ownOrOthers('run_milestone_others'),
  badge_earned: ownOrOthers('badge_earned_others'),
  streak_broken: ownOrOthers('streak_broken_others'),
  release_published: () => 'release_published',
};

/**
 * Vilket notisslag en rad har ur betraktarens perspektiv.
 * `'own'` = betraktarens egen handling (aldrig en notis), `null` = okänd typ (räknas aldrig).
 */
export function classifyNotification(row: ClassifiableRow, viewerId: string): NotificationClassification {
  if (!isActivityType(row.type)) return null;
  return CLASSIFIERS[row.type](row, viewerId);
}

/**
 * En activity_log-rad med det predikatet behöver för att avgöra om den räknas.
 * `id` måste vara ett JS-tal: anroparen konverterar med Number() (bigint-kolumner kan komma som strängar).
 * En sträng-id matchas aldrig mot readIds och ger false.
 */
export interface NotifiableRow extends ClassifiableRow {
  id: number;
  /** Bara exakt `false` släpps igenom; saknat eller null räknas som backfill. */
  isBackfill: boolean;
  /** ISO-8601 (activity_log.created_at). */
  createdAt: string;
}

export interface NotifyViewer {
  id: string;
  /** ISO-8601 (users.created_at): rader före registreringen är aldrig notiser. */
  createdAt: string;
  /** users.news_last_seen_id (nullbar): null = inget kvitterat än = 0. Allt med id <= golvet är läst. */
  floor: number | null;
  /** news_read-id:n ovanför golvet, som tal. */
  readIds: ReadonlySet<number>;
  /**
   * Användarens upplösta eller glesa inställningar, nyckel `notify.<slag>`. En saknad nyckel (eller ett värde som
   * inte är boolean) betyder slagets default, som i resolveSettings.
   */
  settings: Readonly<Record<string, unknown>>;
}

const KIND_BY_NAME: ReadonlyMap<string, (typeof NOTIFICATION_KINDS)[number]> = new Map(
  NOTIFICATION_KINDS.map((def) => [def.kind, def]),
);

/**
 * Är slaget påslaget? Boolean ur inställningarna, annars slagets default. EN källa för server och popover: värderegeln
 * är samma som resolveSettings använder (settingsCore.ts), så klockan och GET /api/settings aldrig kan vara oense.
 */
export function isKindEnabled(kind: NotificationKind, settings: Readonly<Record<string, unknown>>): boolean {
  const def = KIND_BY_NAME.get(kind);
  if (!def) return false;
  return resolveSettingValue(userBooleanSetting(def.key, def.default), readOwn(settings, def.key).value) === true;
}

/**
 * Oläst(U, rad) enligt ADR 011 beslut 4. Ren och fail-closed: ett golv eller ett radid som inte är ett ändligt tal,
 * ett backfill-flagga som inte är exakt false, en okänd tid eller en okänd typ ger false. (Ett null-golv är
 * giltigt och betyder 0.)
 */
export function isNotifiable(row: NotifiableRow, viewer: NotifyViewer): boolean {
  const floor = viewer.floor === null ? 0 : viewer.floor;
  if (!Number.isFinite(floor) || !Number.isFinite(row.id)) return false;
  if (row.id <= floor) return false;
  if (viewer.readIds.has(row.id)) return false;
  if (row.isBackfill !== false) return false;

  const rowTime = Date.parse(row.createdAt);
  const viewerTime = Date.parse(viewer.createdAt);
  if (Number.isNaN(rowTime) || Number.isNaN(viewerTime) || rowTime <= viewerTime) return false;

  const classification = classifyNotification(row, viewer.id);
  if (classification === null || classification === 'own') return false;
  return isKindEnabled(classification, viewer.settings);
}
