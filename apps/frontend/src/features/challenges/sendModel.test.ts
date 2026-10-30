import { describe, expect, it } from 'vitest';
import type { User } from '@runquest/types';
import { LEGENDARY_AUTO_START_DAYS } from '@runquest/shared';
import { buildSent, buildTokenGroups } from './duelsModel';
import { betSummary, buildOpponents, h2hHint, resolveOpponentParam, sendBlocker, startingChoice, startRuleText } from './sendModel';
import { ADAM, DAN, KARL, ME, NAMES, NICK, challenge, stat, token } from './duels.fixture';

const sent = buildSent(challenge({ id: 's1', challenger_id: ME, opponent_id: KARL }), NAMES);

describe('sendBlocker', () => {
  const free = { tokenCount: 2, inLiveDuel: false, sent: null, incomingCount: 0 };

  it('inget hinder → null', () => {
    expect(sendBlocker(free)).toBeNull();
  });

  it('ett live-duell, en skickad utmaning eller en inkommande stoppar (backend avvisar alla tre)', () => {
    expect(sendBlocker({ ...free, inLiveDuel: true })?.reason).toBe('live');
    expect(sendBlocker({ ...free, sent })).toMatchObject({ reason: 'sent' });
    expect(sendBlocker({ ...free, sent })?.message).toContain('Karl');
    expect(sendBlocker({ ...free, incomingCount: 1 })?.reason).toBe('incoming');
  });

  it('inga tokens sist: det som går att göra något åt kommer först', () => {
    expect(sendBlocker({ ...free, tokenCount: 0 })?.reason).toBe('no-tokens');
    expect(sendBlocker({ tokenCount: 0, inLiveDuel: true, sent: null, incomingCount: 0 })?.reason).toBe('live');
  });
});

describe('h2hHint', () => {
  const record = (wins: number, draws: number, losses: number) => ({ wins, draws, losses, total: wins + draws + losses });

  it('visar poängställningen ur mitt perspektiv och vem som leder', () => {
    expect(h2hHint(record(2, 0, 0), 'Karl')).toEqual({ text: '2–0 to you', tone: 'up' });
    expect(h2hHint(record(0, 0, 1), 'Nicklas')).toEqual({ text: '0–1 to Nicklas', tone: 'down' });
  });

  it('oavgjort, jämnt och aldrig mötts', () => {
    expect(h2hHint(record(0, 1, 0), 'Daniel')).toEqual({ text: 'drawn 1', tone: 'muted' });
    expect(h2hHint(record(1, 0, 1), 'Daniel')).toEqual({ text: '1–1 level', tone: 'muted' });
    expect(h2hHint(record(0, 0, 0), 'Johan')).toEqual({ text: 'never met', tone: 'muted' });
  });

  it('inget svar än → ingen text (ingen gissning)', () => {
    expect(h2hHint(undefined, 'Karl')).toBeNull();
  });

  it('names the opponent, or says "to them" when there is no name, and never uses him or her', () => {
    expect(h2hHint(record(0, 0, 2), 'Karl')?.text).toBe('0–2 to Karl');
    expect(h2hHint(record(0, 0, 2), '')?.text).toBe('0–2 to them');
    for (const counts of [record(2, 0, 0), record(0, 0, 1), record(0, 1, 0), record(1, 0, 1), record(0, 0, 0)]) {
      expect(h2hHint(counts, 'Karl')?.text).not.toMatch(/\b(him|her|his|hers)\b/i);
    }
  });
});

describe('startRuleText', () => {
  it('minor and major start at the midnight after the accept; legendary also starts on its own after the unanswered days of the scheduler', () => {
    expect(startRuleText('minor')).toBe('Midnight after it is accepted');
    expect(startRuleText('major')).toBe('Midnight after it is accepted');
    expect(startRuleText('legendary')).toBe(`Midnight after it is accepted, or after ${LEGENDARY_AUTO_START_DAYS} d unanswered`);
  });

  it('never claims that it starts when it is accepted', () => {
    for (const tier of ['minor', 'major', 'legendary'] as const) expect(startRuleText(tier)).not.toMatch(/when accepted/i);
  });
});

describe('betSummary', () => {
  const [group] = buildTokenGroups([token({ id: 'a', tier: 'minor', metric: 'km', duration_days: 7 })]);
  const card = group.cards[0];

  it('says what is still missing, and names the bet once both are chosen', () => {
    expect(betSummary(null, null)).toBe('Pick a challenge and an opponent');
    expect(betSummary(null, 'Karl')).toBe('Pick a challenge');
    expect(betSummary(card, null)).toBe('Pick an opponent');
    expect(betSummary(card, 'Karl')).toBe('Most km vs Karl · 7 days');
  });
});

describe('buildOpponents', () => {
  const members = [
    stat(ME),
    stat(DAN),
    stat(KARL),
    stat(ADAM, { challenge_active: true }),
    stat(NICK, { has_pending_challenge: true }),
  ];
  const user = (id: string, total_xp: number, over: Partial<User> = {}): User => ({
    id, name: NAMES[id], total_xp, current_level: 1, total_km: 0, current_streak: 0, longest_streak: 0, runs: [], ...over,
  });
  const users = [user(ME, 9000), user(KARL, 9500), user(ADAM, 6000), user(NICK, 7000), user(DAN, 3000)];

  it('utan mig själv; lediga först i XP-ordning, upptagna sist', () => {
    const options = buildOpponents({ members, users, meId: ME, headToHead: {} });
    expect(options.map((option) => option.userId)).toEqual([KARL, DAN, NICK, ADAM]);
    expect(options.map((option) => option.disabledReason)).toEqual([null, null, 'Waiting on a reply', 'In a duel']);
  });

  it('you cannot challenge yourself: I am never in the list, however the group is ordered', () => {
    for (const order of [members, [...members].reverse()]) {
      const options = buildOpponents({ members: order, users, meId: ME, headToHead: {} });
      expect(options.map((option) => option.userId)).not.toContain(ME);
      expect(options).toHaveLength(members.length - 1);
    }
  });

  it('notisen: nivå · placering · XP per dag', () => {
    const [karl] = buildOpponents({ members, users, meId: ME, headToHead: {} });
    expect(karl.note).toMatch(/^Level \d+ · #1 · \d+ XP \/ day$/);
    expect(karl.initials).toBe('KP');
  });

  it('initialer: första och sista namnets, så Anna Maria Lindqvist är AL', () => {
    const [anna] = buildOpponents({ members: [stat(KARL, { name: 'Anna Maria Lindqvist' })], users, meId: ME, headToHead: {} });
    expect(anna.initials).toBe('AL');
  });

  it('utan användardata: bara nivån ur group-stats', () => {
    const [first] = buildOpponents({ members, users: undefined, meId: ME, headToHead: {} });
    expect(first.note).toBe('Level 20');
  });

  it('head-to-head per motståndare', () => {
    const options = buildOpponents({
      members, users, meId: ME, headToHead: { [KARL]: { wins: 2, draws: 0, losses: 0, total: 2 } },
    });
    expect(options.find((option) => option.userId === KARL)?.h2h).toEqual({ text: '2–0 to you', tone: 'up' });
    expect(options.find((option) => option.userId === DAN)?.h2h).toBeNull();
  });
});

describe('resolveOpponentParam', () => {
  const options = buildOpponents({
    members: [stat(ME), stat(KARL), stat(ADAM, { challenge_active: true })], users: undefined, meId: ME, headToHead: {},
  });

  it('en ledig gruppmedlem förväljs', () => {
    expect(resolveOpponentParam(KARL, options)).toBe(KARL);
  });

  it('jag själv, en okänd, en upptagen eller saknad parameter förväljer ingen', () => {
    expect(resolveOpponentParam(ME, options)).toBeNull();
    expect(resolveOpponentParam('u-someone-else', options)).toBeNull();
    expect(resolveOpponentParam(ADAM, options)).toBeNull();
    expect(resolveOpponentParam(null, options)).toBeNull();
  });
});

describe('startingChoice', () => {
  const groups = buildTokenGroups([
    token({ id: 'a', tier: 'minor', metric: 'km' }),
    token({ id: 'b', tier: 'minor', metric: 'km' }),
    token({ id: 'm', tier: 'major', metric: 'runs' }),
  ]);

  it('Send on a token card preselects its tier and that card', () => {
    expect(startingChoice(groups, { tier: 'minor', tokenKey: 'b' })).toEqual({ tier: 'minor', tokenKey: 'b' });
  });

  it('a tier chip preselects the tier only, unless the tier has a lone card', () => {
    expect(startingChoice(groups, { tier: 'minor', tokenKey: null })).toEqual({ tier: 'minor', tokenKey: null });
    expect(startingChoice(groups, { tier: 'major', tokenKey: null })).toEqual({ tier: 'major', tokenKey: 'm' });
  });

  it('no preselection starts at the first tier that has tokens, never at a chosen card', () => {
    expect(startingChoice(groups, null)).toEqual({ tier: 'minor', tokenKey: null });
    expect(startingChoice(buildTokenGroups([token({ id: 'm', tier: 'major' })]), null)).toEqual({ tier: 'major', tokenKey: 'm' });
  });

  it('a preselection that is no longer valid falls back instead of selecting a card that is gone', () => {
    expect(startingChoice(groups, { tier: 'legendary', tokenKey: null })).toEqual({ tier: 'minor', tokenKey: null });
    expect(startingChoice(groups, { tier: 'minor', tokenKey: 'gone' })).toEqual({ tier: 'minor', tokenKey: null });
  });

  it('without any tokens there is nothing to start at', () => {
    expect(startingChoice(buildTokenGroups([]), null)).toBeNull();
  });
});
