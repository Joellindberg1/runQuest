import type { RQIconName } from '@/shared/components/icons';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { TITLE_CATEGORIES, categoryOf, iconOf } from './titleCategories';
import { unlockText } from './titleFormat';

// Titlarnas regler som text — namn, regel och låsgräns ur databasen (GET /titles/leaderboard, samma rader som Titles-skärmen),
// utan innehavare och värden. Delas av Playbook (kapitlet Titles) och Admin (Titles). Ren logik.

export interface TitleRuleRow {
  id: string;
  name: string;
  /** titles.description — titelns regel, ordagrant ur databasen. */
  rule: string;
  /** "Unlocks at 7 runs"; null när titeln inte har någon gräns (eller gränsen inte går att uttrycka). */
  unlock: string | null;
  icon: RQIconName;
}

const categoryOrder = (metricKey: string | undefined): number => {
  const index = TITLE_CATEGORIES.findIndex((category) => category.id === categoryOf(metricKey));
  return index === -1 ? TITLE_CATEGORIES.length : index;
};

/** Kategorins ordning som på Titles-skärmen; inom en kategori behålls databasens ordning (stabil sortering). */
export function buildTitleRuleRows(board: readonly TitleLeaderboard[]): TitleRuleRow[] {
  return board
    .map((title, position) => ({ title, position }))
    .sort((a, b) => categoryOrder(a.title.metric_key) - categoryOrder(b.title.metric_key) || a.position - b.position)
    .map(({ title }) => {
      const threshold = unlockText(title.metric_key, title.unlock_requirement);
      return {
        id: title.id,
        name: title.name,
        rule: title.description,
        unlock: threshold ? `Unlocks at ${threshold}` : null,
        icon: iconOf(title.metric_key),
      };
    });
}
