import { describe, expect, it } from 'vitest';
import type { User } from '@runquest/types';
import { buildSent } from './duelsModel';
import { buildOpponents, h2hHint, resolveOpponentParam, sendBlocker } from './sendModel';
import { ADAM, DAN, KARL, ME, NAMES, NICK, challenge, stat } from './duels.fixture';

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

  it('notisen: nivå · placering · XP per dag', () => {
    const [karl] = buildOpponents({ members, users, meId: ME, headToHead: {} });
    expect(karl.note).toMatch(/^Level \d+ · #1 · \d+ XP \/ day$/);
    expect(karl.initials).toBe('KP');
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
