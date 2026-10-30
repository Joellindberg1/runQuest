import { TITLE_CATEGORIES, type TitleCategoryId } from '@/features/titles/titleCategories';
import type { SegmentedOption } from '@/shared/components/SegmentedControl';
import type { TitleRows } from './runnerModel';

// Typfiltret i popupens Titles held-flik. Kategorierna är titles-featurens (`TITLE_CATEGORIES`, härledda ur måttnyckeln): ingen egen regel här.

export type TitleFilter = 'all' | TitleCategoryId;
export const ALL_TITLES: TitleFilter = 'all';

/** Kategorins visningsnamn ("Time of day"): filtrets knapp och typraden på titeln. */
export function categoryLabel(id: TitleCategoryId): string {
  return TITLE_CATEGORIES.find((def) => def.id === id)?.label ?? id;
}

/**
 * "All" och de kategorier som löparens titlar i listan faktiskt har (innehavda och runner-up, eftersom båda visas och båda filtreras), i `TITLE_CATEGORIES`-ordning
 * och inte i datans. En kategori som löparen inte har en enda titel i får ingen knapp.
 */
export function titleFilterOptions(rows: TitleRows): SegmentedOption<TitleFilter>[] {
  const present = new Set<TitleCategoryId>([...rows.held, ...rows.runnersUp].map((row) => row.category));
  return [
    { value: ALL_TITLES, label: 'All' },
    ...TITLE_CATEGORIES.filter((def) => present.has(def.id)).map((def) => ({ value: def.id, label: categoryLabel(def.id) })),
  ];
}

/** Raderna i vald kategori, i given ordning (sorteringen är modellens, inte filtrets). */
export function filterTitleRows(rows: TitleRows, filter: TitleFilter): TitleRows {
  if (filter === ALL_TITLES) return rows;
  return {
    held: rows.held.filter((row) => row.category === filter),
    runnersUp: rows.runnersUp.filter((row) => row.category === filter),
  };
}
