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
    slug: 'patch_2026_04_02_v042',
    version: 'v0.4.2',
    title: 'Public profiles',
    items: [
      'Tap any leaderboard card to open a player\'s full profile in a modal',
      'Profile shows stats, Frodo\'s Journey progress and titles',
      'Also accessible from the group run history and challenge views',
      'Scheduled events now show a coming-soon countdown in the sidebar widget',
    ],
  },
  {
    slug: 'patch_2026_04_02_v041',
    version: 'v0.4.1',
    title: 'Onboarding system',
    items: [
      'Interactive feature tours — each page now has a guided walkthrough for new members',
      'Patch notes pop up automatically when new features ship so you never miss an update',
      'Frodo\'s Journey expanded with 24 new Tolkien waypoints and a three-level zoom function',
      'Journey moved to a full-width prominent card on the profile page',
    ],
  },
];
