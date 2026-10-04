import type { EventItem, EventLeaderboardRow, EventMyEntry } from '@runquest/shared';

// Gemensamma testdata för Events-testerna (modell + skärm). Fasta klockslag så att inget beror på dagens datum.
// Stockholm är CEST (UTC+2) till 25 oktober 2026.

/** Fredag 2026-10-02 17:46 i Stockholm. */
export const NOW = new Date('2026-10-02T15:46:00Z');

export const ME = 'u-me';
export const KARL = 'u-karl';
export const ADAM = 'u-adam';

const BASE_TEMPLATE = {
  icon: 'calendar',
  description: '',
  minKm: 0,
  rewardXp: 0,
  rewardXp1st: 0,
  rewardXp2nd: 0,
  rewardXp3rd: 0,
  requiresWeather: null as string | null,
};

export const MEMBERS = 6;

export function event(over: Partial<EventItem> & Pick<EventItem, 'id'>): EventItem {
  return {
    type: 'participation',
    // Backend skickar null för participation-event; kontraktstypen säger string (kontraktsluckan rapporterad).
    metric: null as unknown as string,
    status: 'active',
    startsAt: '2026-10-01T22:00:00Z',
    endsAt: '2026-10-02T21:59:00Z',
    template: { name: 'Event', ...BASE_TEMPLATE },
    myEntry: null,
    leaderboard: null,
    participantCount: 0,
    memberCount: MEMBERS,
    ...over,
  };
}

export const mine = (over: Partial<EventMyEntry> = {}): EventMyEntry => ({
  qualified: true, qualifiedAt: '2026-10-02T08:00:00Z', rank: null, xpAwarded: 25, totalValue: null, ...over,
});

export const row = (over: Partial<EventLeaderboardRow> & Pick<EventLeaderboardRow, 'userId' | 'userName'>): EventLeaderboardRow => ({
  totalValue: 0, rank: null, isMe: false, ...over,
});

/** Fredagens event, öppet hela dagen: 5 km ger 25 XP. */
export const FIVE_K = event({
  id: 'e-5k',
  template: { name: '5K Friday', ...BASE_TEMPLATE, description: 'Run 5 km or more before midnight', minKm: 5, rewardXp: 25 },
  participantCount: 4,
});

/** Lördagens event — det första som öppnar. */
export const HANGOVER = event({
  id: 'e-hangover',
  status: 'scheduled',
  startsAt: '2026-10-02T22:00:00Z',
  endsAt: '2026-10-03T21:59:00Z',
  template: { name: 'Hangover Run', ...BASE_TEMPLATE, description: '5 km before 11:00 on a weekend', minKm: 5, rewardXp: 40 },
});

/** Veckotävlingen som öppnar på måndag 00:01 och avräknas söndag natt. */
export const WEEKLY_KM = event({
  id: 'e-weekly-km',
  type: 'competition',
  metric: 'km',
  status: 'scheduled',
  startsAt: '2026-10-04T22:01:00Z',
  endsAt: '2026-10-11T21:59:00Z',
  template: {
    name: 'Weekly km', ...BASE_TEMPLATE, description: 'Most kilometres in the week', rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30,
  },
});

/** Pågående tävling (vecka 40, mån 28 sep – sön 4 okt) — jag är tvåa. */
export const LIVE_ELEVATION = event({
  id: 'e-elevation',
  type: 'competition',
  metric: 'elevation',
  startsAt: '2026-09-27T22:01:00Z',
  endsAt: '2026-10-04T21:59:00Z',
  template: {
    name: 'Weekly elevation', ...BASE_TEMPLATE, description: 'Most metres climbed in the week', rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30,
  },
  myEntry: mine({ rank: 2, xpAwarded: null, totalValue: 540 }),
  participantCount: 3,
  leaderboard: [
    row({ userId: KARL, userName: 'Karl Persson', totalValue: 612, rank: 1 }),
    row({ userId: ME, userName: 'Du', totalValue: 540, rank: 2, isMe: true }),
    row({ userId: ADAM, userName: 'Adam Einstein', totalValue: 198.4, rank: 3 }),
  ],
});

// ── Historik ─────────────────────────────────────────────────────────────────

export const SETTLED = { status: 'settled' as const };

export const H_MORNING_DONE = event({
  id: 'h-morning',
  ...SETTLED,
  startsAt: '2026-09-28T03:00:00Z',
  endsAt: '2026-09-28T07:00:00Z',
  template: { name: 'Morning Run', ...BASE_TEMPLATE, description: '3 km before 09:00', minKm: 3, rewardXp: 25 },
  myEntry: mine({ xpAwarded: 25 }),
  participantCount: 4,
});

export const H_HANGOVER_MISSED = event({
  id: 'h-hangover',
  ...SETTLED,
  startsAt: '2026-09-26T22:00:00Z',
  endsAt: '2026-09-27T21:59:00Z',
  template: { name: 'Hangover Run', ...BASE_TEMPLATE, description: '5 km before 11:00 on a weekend', minKm: 5, rewardXp: 40 },
  participantCount: 2,
});

export const H_STORM_DONE = event({
  id: 'h-storm',
  ...SETTLED,
  startsAt: '2026-09-18T22:00:00Z',
  endsAt: '2026-09-19T21:59:00Z',
  template: { name: 'Storm Chaser', ...BASE_TEMPLATE, description: 'Run while the forecast says rain', minKm: 3, rewardXp: 50, requiresWeather: 'rain' },
  myEntry: mine({ xpAwarded: 50 }),
  participantCount: 6,
});

export const H_COMPETITION_SECOND = event({
  id: 'h-comp-2',
  type: 'competition',
  metric: 'km',
  ...SETTLED,
  startsAt: '2026-09-20T22:01:00Z',
  endsAt: '2026-09-27T21:59:00Z',
  template: { name: 'Weekly km', ...BASE_TEMPLATE, description: 'Most kilometres in the week', rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30 },
  myEntry: mine({ rank: 2, xpAwarded: 60, totalValue: 41.2 }),
  participantCount: 5,
});

export const H_COMPETITION_FOURTH = event({
  id: 'h-comp-4',
  type: 'competition',
  metric: 'km',
  ...SETTLED,
  startsAt: '2026-09-13T22:01:00Z',
  endsAt: '2026-09-20T21:59:00Z',
  template: { name: 'Weekly km', ...BASE_TEMPLATE, description: 'Most kilometres in the week', rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30 },
  myEntry: mine({ rank: 4, xpAwarded: 0, totalValue: 12 }),
  participantCount: 5,
});

export const H_COMPETITION_SKIPPED = event({
  id: 'h-comp-skip',
  type: 'competition',
  metric: 'elevation',
  ...SETTLED,
  startsAt: '2026-09-06T22:01:00Z',
  endsAt: '2026-09-13T21:59:00Z',
  template: { name: 'Weekly elevation', ...BASE_TEMPLATE, description: 'Most metres climbed in the week', rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30 },
  participantCount: 3,
});
