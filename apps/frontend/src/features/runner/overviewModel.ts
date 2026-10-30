import type { StatCell, StatRow } from './runnerModel';

/**
 * Löparens totala utmaningsrekord (vunna–förlorade) som en rad i popupens Fun facts. Värdet läses ur samma cell som sidans hjältekort bygger (`buildStatCells`, via
 * `useRunnerPanelData`), så att formen bara finns på ett ställe. Raden hör till popupen: profilens modell (`statsModel`) har ingen.
 * Tonen är neutral, inte cellens up/down: raden är 17 px och går inte som large text, och grönt/rött ger 4,15:1 respektive lägre i ljust tema (kravet för ny text är 4,5:1).
 */
export function buildChallengeRecordRow(cells: readonly StatCell[]): StatRow | null {
  const cell = cells.find((candidate) => candidate.key === 'challenges');
  return cell ? { label: 'Challenges won–lost', value: cell.value, tone: 'default' } : null;
}
