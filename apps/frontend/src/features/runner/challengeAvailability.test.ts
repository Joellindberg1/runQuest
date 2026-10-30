import { describe, expect, it } from 'vitest';
import type { MyChallengesData } from '@runquest/shared';
import { ADAM, KARL, ME, NAMES, NICK, challenge, stat, token } from '@/features/challenges/duels.fixture';
import { buildSent } from '@/features/challenges/duelsModel';
import { sendBlocker } from '@/features/challenges/sendModel';
import { challengeAvailability } from './challengeAvailability';

const mine = (over: Partial<MyChallengesData> = {}): MyChallengesData => ({
  tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [], ...over,
});
const group = [stat(ME), stat(KARL), stat(ADAM), stat(NICK)];

const ready = { meId: ME, runnerId: KARL, my: mine(), groupStats: group, loading: false };

describe('challengeAvailability', () => {
  it('is ready when I can send and the runner is free', () => {
    expect(challengeAvailability(ready)).toEqual({ status: 'ready' });
  });

  it('is loading, without a reason, while nothing says no and a query is still running', () => {
    expect(challengeAvailability({ ...ready, my: undefined, groupStats: undefined, loading: true })).toEqual({ status: 'loading' });
    expect(challengeAvailability({ ...ready, groupStats: undefined, loading: true })).toEqual({ status: 'loading' });
  });

  it('is ready when a query failed, because the server validates the send anyway', () => {
    expect(challengeAvailability({ ...ready, my: undefined, groupStats: undefined, loading: false })).toEqual({ status: 'ready' });
    expect(challengeAvailability({ ...ready, groupStats: undefined })).toEqual({ status: 'ready' });
    expect(challengeAvailability({ ...ready, my: undefined })).toEqual({ status: 'ready' });
  });

  it('gives the reason from sendBlocker when I have no tokens', () => {
    const expected = sendBlocker({ tokenCount: 0, inLiveDuel: false, sent: null, incomingCount: 0 })!.message;
    expect(challengeAvailability({ ...ready, my: mine({ tokens: [] }) })).toEqual({ status: 'blocked', reason: expected });
    expect(expected).toContain('no tokens');
  });

  it('gives the reason from sendBlocker when I am in a live duel, as challenger or as opponent', () => {
    const expected = sendBlocker({ tokenCount: 1, inLiveDuel: true, sent: null, incomingCount: 0 })!.message;
    const asChallenger = mine({ group_active: [challenge({ id: 'a', challenger_id: ME, opponent_id: ADAM, status: 'active' })] });
    const asOpponent = mine({ group_active: [challenge({ id: 'b', challenger_id: ADAM, opponent_id: ME, status: 'active' })] });
    expect(challengeAvailability({ ...ready, my: asChallenger })).toEqual({ status: 'blocked', reason: expected });
    expect(challengeAvailability({ ...ready, my: asOpponent })).toEqual({ status: 'blocked', reason: expected });
  });

  it('ignores a live duel between two other members', () => {
    const others = mine({ group_active: [challenge({ id: 'c', challenger_id: ADAM, opponent_id: NICK, status: 'active' })] });
    expect(challengeAvailability({ ...ready, my: others })).toEqual({ status: 'ready' });
  });

  it('gives the reason from sendBlocker when a challenge I sent waits, naming who it went to', () => {
    const sentChallenge = challenge({ id: 's', challenger_id: ME, opponent_id: ADAM });
    const expected = sendBlocker({ tokenCount: 1, inLiveDuel: false, sent: buildSent(sentChallenge, NAMES), incomingCount: 0 })!.message;
    expect(challengeAvailability({ ...ready, my: mine({ sent_challenge: sentChallenge }) })).toEqual({ status: 'blocked', reason: expected });
    expect(expected).toContain('Adam');
  });

  it('gives the reason from sendBlocker when a challenge waits on me', () => {
    const expected = sendBlocker({ tokenCount: 1, inLiveDuel: false, sent: null, incomingCount: 1 })!.message;
    const incoming = mine({ received_challenges: [challenge({ id: 'i', challenger_id: ADAM, opponent_id: ME })] });
    expect(challengeAvailability({ ...ready, my: incoming })).toEqual({ status: 'blocked', reason: expected });
  });

  it('shows my own reason as soon as it is known, also while the group is still loading', () => {
    const expected = sendBlocker({ tokenCount: 0, inLiveDuel: false, sent: null, incomingCount: 0 })!.message;
    expect(challengeAvailability({ ...ready, my: mine({ tokens: [] }), groupStats: undefined, loading: true })).toEqual({ status: 'blocked', reason: expected });
  });

  it('says the runner is in a live duel, with the first name', () => {
    const state = challengeAvailability({ ...ready, groupStats: [stat(ME), stat(KARL, { challenge_active: true })] });
    expect(state).toEqual({ status: 'blocked', reason: 'Karl is in a live duel right now.' });
  });

  it('says the runner is waiting on a reply, with the first name', () => {
    const state = challengeAvailability({ ...ready, groupStats: [stat(ME), stat(KARL, { has_pending_challenge: true })] });
    expect(state).toEqual({ status: 'blocked', reason: 'Karl is waiting on a reply to a challenge.' });
  });

  it('puts my own reason before the runner being busy', () => {
    const busy = [stat(ME), stat(KARL, { challenge_active: true })];
    const state = challengeAvailability({ ...ready, my: mine({ tokens: [] }), groupStats: busy });
    expect(state).toMatchObject({ status: 'blocked', reason: expect.stringContaining('no tokens') });
  });

  it('only looks at the runner of the popup, not at other busy members', () => {
    const busyElsewhere = [stat(ME), stat(KARL), stat(ADAM, { challenge_active: true }), stat(NICK, { has_pending_challenge: true })];
    expect(challengeAvailability({ ...ready, groupStats: busyElsewhere })).toEqual({ status: 'ready' });
  });
});
