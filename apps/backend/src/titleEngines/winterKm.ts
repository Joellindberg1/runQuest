import type { TitleEngine, RunData, UserStats, TitleContext } from './types';
import { winterWindow } from './_utils';

/** Winter Warrior: flest km i innevarande vinter (dec–feb); utanför vintern senast avslutade vinter. */
export const winterKmEngine: TitleEngine = {
  metricKey: 'winterKm',
  calculate(runs: RunData[], _: UserStats, ctx?: TitleContext): number {
    const { start, end } = winterWindow(ctx?.now ?? new Date());

    // Hela hundradelar som heltal: många små rundor ska inte ge flyttalsdrift i jämförelsen mellan användare.
    const hundredths = runs
      .filter(r => r.date >= start && r.date < end)
      .reduce((sum, r) => sum + Math.round(r.distance_km * 100), 0);

    return hundredths / 100;
  }
};
