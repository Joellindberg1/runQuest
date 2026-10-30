import { describe, expect, it } from 'vitest';
import { user } from '@/features/profile/profile.fixture';
import { buildChallengeRecordRow } from './overviewModel';
import { buildStatCells } from './runnerModel';

const runner = (wins: number, losses: number) => user({ id: 'u-karl', name: 'Karl Persson', total_xp: 5539, wins, losses });

describe('buildChallengeRecordRow', () => {
  it('reads the record from the same cell the banner and the page build: won–lost, in the cell\'s tone', () => {
    expect(buildChallengeRecordRow(buildStatCells(runner(1, 3), 0))).toEqual({ label: 'Challenges won–lost', value: '1–3', tone: 'down' });
    expect(buildChallengeRecordRow(buildStatCells(runner(5, 2), 0))).toEqual({ label: 'Challenges won–lost', value: '5–2', tone: 'up' });
  });

  it('treats an even record as up, like the cell, and no challenges as 0–0', () => {
    expect(buildChallengeRecordRow(buildStatCells(runner(2, 2), 0))).toMatchObject({ value: '2–2', tone: 'up' });
    expect(buildChallengeRecordRow(buildStatCells(runner(0, 0), 0))).toMatchObject({ value: '0–0', tone: 'up' });
  });

  it('gives no row when there is no challenges cell to read', () => {
    expect(buildChallengeRecordRow([])).toBeNull();
    expect(buildChallengeRecordRow(buildStatCells(runner(1, 3), 0).filter((cell) => cell.key !== 'challenges'))).toBeNull();
  });
});
