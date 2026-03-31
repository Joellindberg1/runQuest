// 📋 Patch notes config — add new entries here when releasing updates.
// Each entry gets its own slug. If content changes significantly, bump
// the version suffix (patch_2026_03_31_v2) so all users see it again.

export interface PatchNote {
  slug: string;
  version: string;
  title: string;
  items: string[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    slug: 'patch_2026_03_31',
    version: 'v0.4.1',
    title: 'Events & Onboarding update',
    items: [
      'Events now have a smarter scheduling system — daily, weekly and weekend pools',
      'XP from events now counts toward your level',
      'Half Marathon Chaser added to the Thursday event pool',
      'Weather now shown on run history cards',
    ],
  },
];
