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
  'features/challenges/components/SendSheet.tsx',
  'features/challenges/components/DuelsScreen.tsx',
  'features/challenges/components/StakeBlocks.tsx',
  'features/challenges/components/OfferCards.tsx',
  'features/challenges/components/HistoryList.tsx',
];

// Ett id per rad i listan, med raden som ska träffa: tas en rad bort ur listan (eller ändras så att den inte träffar) blir den här tabellen röd. Mönstren för sidorna, touren och
// routern prövas inte av filerna ovan, eftersom touren ligger i node_modules och sidorna och routern inte är landningens riktiga innehåll.
const ONE_ID_PER_ENTRY: Array<[string, string]> = [
  [inSrc('pages/BoardPage.tsx'), 'an app page'],
  [inSrc('pages/RunnerPage.tsx'), 'an app page'],
  ['C:/repo/node_modules/driver.js/dist/driver.js.mjs', 'the tour (driver.js)'],
  [inSrc('routes.tsx'), 'the full app router or shell'],
  [`${inSrc('App.tsx')}?used`, 'the full app router or shell'],
  [inSrc('features/runner/components/RunnerPopup.tsx'), 'the runner popup or anything it brings in (features/runner)'],
  [inSrc('features/leaderboard/components/PositionView.tsx'), 'a position chart, the position view or its model, hook, loader or stylesheet'],
  [inSrc('features/badges/components/BadgeSeriesCard.tsx'), 'the read-only badge card (BadgeSeriesCard)'],
  [inSrc('features/challenges/components/SendSheet.tsx'), 'the send flow or the duels screen (features/challenges)'],
];

// "position" är ett eget ord i namnet: ord som bara innehåller bokstavsföljden släpps igenom, och frågesuffix och mappnamn hanteras.
const POSITION_WORD_FORBIDDEN = [
  'features/leaderboard/components/PositionChart.tsx?x=1',
  'features/x/position/Foo.tsx',
  'features/x/usePositionHistory.ts',
  'features/x/positionBoard.css',
  'features/x/PackPositionChart.tsx',
  'features/x/Position.tsx',
  'features/x/Positions.tsx',
];
const POSITION_LOOKALIKES_ALLOWED = ['features/x/PropositionCard.tsx', 'features/x/composition.ts', 'features/x/Dispositions.ts', 'features/x/decomposition/Foo.tsx', 'features/x/Foo.tsx?position=1'];

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

  it.each(ONE_ID_PER_ENTRY)('flags %s as: %s', (id, what) => {
    expect(forbiddenInLanding([id]).map((hit) => hit.what)).toEqual([what]);
  });

  it('has an entry in the table above for every entry in the list', () => {
    expect(ONE_ID_PER_ENTRY.map(([, what]) => what).sort()).toEqual(expect.arrayContaining(FORBIDDEN_IN_LANDING.map(({ what }) => what)));
  });

  it.each(POSITION_WORD_FORBIDDEN)('treats position as a word: forbids %s', (file) => {
    expect(forbiddenInLanding([inSrc(file)])).toHaveLength(1);
  });

  it.each(POSITION_LOOKALIKES_ALLOWED)('treats position as a word: allows %s (Proposition, composition and Dispositions only contain the letters)', (file) => {
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
