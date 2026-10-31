import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_IN_LANDING, forbiddenInLanding } from './landingGraphGuard';

// Listan över vad landningens graf inte får nå (landingGraphGuard.ts) prövas här utan bygge: den fäller de moduler den ska, släpper de den inte ska, och varje mönster träffar
// en riktig källfil. Att vakten fäller ett helt bygge (en modul nåd genom flera led) prövas med en syntetisk fixtur i landingBuild.test.ts.

const SRC = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const inSrc = (file: string) => `${SRC}/${file}`;

// Modulerna som ändringen uttryckligen nämner: popupen med det den drar in, positionsgraferna, positionsvyn och den skrivskyddade badgekort-varianten.
const MUST_BE_FORBIDDEN = [
  'features/runner/components/RunnerPopup.tsx',
  'features/runner/components/PopupSections.tsx',
  'features/runner/components/PopupBadgesPanel.tsx',
  'features/runner/components/PopupTitlesPanel.tsx',
  'features/runner/components/PopupBanner.tsx',
  'features/runner/components/HeadToHeadBanner.tsx',
  'features/profile/components/PositionChart.tsx',
  'features/profile/components/PositionPanel.tsx',
  'features/leaderboard/components/PackPositionChart.tsx',
  'features/leaderboard/components/PositionChartCard.tsx',
  'features/leaderboard/components/PositionView.tsx',
  'features/leaderboard/components/PositionTab.tsx',
  'features/badges/components/BadgeSeriesCard.tsx',
];

// Det landningen står på i dag och därför ska få vara kvar: landningsfeaturen, ingångens egna filer, delade primitiver och bara det av leaderboardens delar som landningens exempelpaket använder.
const MUST_STAY_ALLOWED = [
  'landing-main.tsx',
  'landing-entry/LandingApp.tsx',
  'features/landing/components/LandingScreen.tsx',
  'features/auth/components/LoginDialog.tsx',
  'features/leaderboard/previewUsers.ts',
  'features/leaderboard/components/BoardParts.tsx',
  'features/badges/components/badgeTier.ts',
  'shared/components/icons/RQIcon.tsx',
  'index.css',
];

describe('the landing import graph list', () => {
  it.each(MUST_BE_FORBIDDEN)('forbids %s', (file) => {
    expect(existsSync(inSrc(file)), `${file} finns (annars har den bytt namn och listan ska följa med)`).toBe(true);
    expect(forbiddenInLanding([inSrc(file)])).toHaveLength(1);
  });

  it.each(MUST_STAY_ALLOWED)('allows %s', (file) => {
    expect(existsSync(inSrc(file)), `${file} finns`).toBe(true);
    expect(forbiddenInLanding([inSrc(file)])).toEqual([]);
  });

  it('matches a Windows path with backslashes and a query suffix the same way', () => {
    expect(forbiddenInLanding(['C:\\repo\\apps\\frontend\\src\\features\\runner\\components\\RunnerPopup.tsx?used'])).toHaveLength(1);
    expect(forbiddenInLanding(['C:\\repo\\apps\\frontend\\src\\features\\landing\\components\\LandingScreen.tsx?used'])).toEqual([]);
  });

  it('catches a file added later: a new popup component and a new position module need no change to the list', () => {
    expect(forbiddenInLanding([inSrc('features/runner/components/PopupFuture.tsx'), inSrc('features/runner/hooks/usePopupFuture.ts')])).toHaveLength(2);
    expect(forbiddenInLanding([inSrc('features/leaderboard/components/PositionSomethingNew.tsx'), inSrc('features/profile/positionNewModel.ts'), inSrc('features/profile/positionNew.css')])).toHaveLength(3);
  });

  it('has a pattern that matches a real file for every entry, so a rename cannot leave a pattern empty', () => {
    const sourceFiles = (readdirSync(SRC, { recursive: true }) as string[]).map((file) => inSrc(file.replace(/\\/g, '/')));
    const driverJs = createRequire(import.meta.url).resolve('driver.js').replace(/\\/g, '/');
    const candidates = [...sourceFiles, driverJs];
    const empty = FORBIDDEN_IN_LANDING.filter(({ pattern }) => !candidates.some((id) => pattern.test(id))).map(({ what }) => what);
    expect(empty).toEqual([]);
  });
});
