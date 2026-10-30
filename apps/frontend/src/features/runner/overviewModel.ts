import type { StatCell, StatRow } from './runnerModel';

/**
 * Löparens totala utmaningsrekord (vunna–förlorade) som en rad i popupens Fun facts. Värdet och tonen läses ur samma cell som sidans hjältekort bygger
 * (`buildStatCells`, via `useRunnerPanelData`), så att formen bara finns på ett ställe. Raden hör till popupen: profilens modell (`statsModel`) har ingen.
 */
export function buildChallengeRecordRow(cells: readonly StatCell[]): StatRow | null {
  const cell = cells.find((candidate) => candidate.key === 'challenges');
  return cell ? { label: 'Challenges won–lost', value: cell.value, tone: cell.tone } : null;
}
