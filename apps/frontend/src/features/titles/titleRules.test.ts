import { describe, expect, it } from 'vitest';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { buildTitleRuleRows } from './titleRules';

const title = (id: string, name: string, metric_key: string | undefined, unlock_requirement = 0): TitleLeaderboard => ({
  id, name, description: `${name}: regeln ur databasen.`, unlock_requirement, metric_key, holder: null, runners_up: [],
});

describe('buildTitleRuleRows', () => {
  it('namn och regel kommer ordagrant ur databasen, tröskeln skrivs som "Unlocks at …"', () => {
    const [row] = buildTitleRuleRows([title('t1', 'The Batman', 'nightRunCount', 7)]);
    expect(row).toMatchObject({ id: 't1', name: 'The Batman', rule: 'The Batman: regeln ur databasen.', unlock: 'Unlocks at 7 runs', icon: 'moon' });
  });

  it('ingen tröskel (0) eller ett mått som inte går att uttrycka ger ingen låsrad', () => {
    const rows = buildTitleRuleRows([title('t1', 'The Hamster', 'maxRunsOneWeek'), title('t2', 'The Finisher', 'lastRunOfWeek', 5)]);
    expect(rows.map((row) => row.unlock)).toEqual([null, null]);
  });

  it('kilometertitlar får enheten', () => {
    expect(buildTitleRuleRows([title('t1', 'The Ultra Man', 'totalKm', 100)])[0].unlock).toBe('Unlocks at 100.0 km');
  });

  it('ordnas som kategorierna på Titles-skärmen (tid före distans före tempo), databasordningen behålls inom en kategori', () => {
    const rows = buildTitleRuleRows([
      title('pace', 'Park Runner', 'fastest5km'),
      title('km-b', 'Weekend', 'weekendAvg'),
      title('time', 'Batman', 'nightRunCount'),
      title('km-a', 'Ultra', 'totalKm'),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['time', 'km-b', 'km-a', 'pace']);
  });

  it('ett mått utan känd mappning hamnar sist i stället för att försvinna', () => {
    const rows = buildTitleRuleRows([title('new', 'The Newcomer', 'someFutureMetric'), title('time', 'Batman', 'nightRunCount')]);
    expect(rows.map((row) => row.id)).toEqual(['time', 'new']);
  });

  it('en tom tavla ger en tom lista', () => {
    expect(buildTitleRuleRows([])).toEqual([]);
  });
});
