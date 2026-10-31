// Importgrafsvakten för den lean landningsingången (ADR 006, addendum 2026-10-19, S4 punkt 4; utökad i addendum 2026-10-26, punkt 6): vad landningens statiska graf aldrig får
// innehålla. Listan läses av landingBuild.test.ts mot det riktiga bygget och av landingGraphGuard.test.ts mot en syntetisk fixtur. Mönstren är sökvägsmönster, inte filnamn
// uppräknade en och en: en ny fil i popupen eller en ny positionskomponent fångas utan att listan ändras, och landingGraphGuard.test.ts kräver att varje mönster träffar en
// riktig källfil så att en omdöpt katalog inte gör ett mönster tomt i tysthet.

export interface ForbiddenInLanding {
  /** Vad mönstret skyddar landningen från, för felmeddelandet. */
  what: string;
  /** Prövas mot modulens id, med snedstreck som skiljetecken. */
  pattern: RegExp;
}

export const FORBIDDEN_IN_LANDING: readonly ForbiddenInLanding[] = [
  { what: 'an app page', pattern: /\/src\/pages\/(?:Board|Titles|Duels|Events|News|Log|Profile|Runner|Badges)Page/ },
  { what: 'the tour (driver.js)', pattern: /\/node_modules\/driver\.js\// },
  { what: 'the full app router or shell', pattern: /\/src\/(?:routes|App)\.tsx(?:\?|$)/ },
  // Hela featuren: RunnerPopup och allt den drar in (PopupSections, PopupBadgesPanel, PopupTitlesPanel, HeadToHeadBanner, PopupBanner …) bor i features/runner.
  { what: 'the runner popup or anything it brings in (features/runner)', pattern: /\/src\/features\/runner\// },
  // Positionsgraferna (profilens PositionChart/PositionPanel, leaderboardens PackPositionChart/PositionChartCard), positionsvyn (PositionView, PositionTab) och deras hook, vymodeller,
  // laddare och stil: "position" som eget ord i ett fil- eller mappnamn, i början (positionBoard.css, position/) eller efter ett ordbyte i camelCase/PascalCase (usePositionHistory,
  // PackPositionChart). Ordgränsen gör att Proposition, composition och Dispositions inte träffas; frågesuffixet (?…) räknas inte med.
  { what: 'a position chart, the position view or its model, hook, loader or stylesheet', pattern: /\/src\/[^?]*?(?:(?<![A-Za-z])[Pp]|(?<=[a-z0-9])P)ositions?(?![a-z])/ },
  { what: 'the read-only badge card (BadgeSeriesCard)', pattern: /\/src\/features\/badges\/components\/BadgeSeriesCard(?:[.?]|$)/ },
  // Send-flödet och dueller: SendSheet, DuelsScreen, StakeBlocks, OfferCards, HistoryList m.fl. Landningens graf når ingenting i featuren i dag (bygget visar det).
  { what: 'the send flow or the duels screen (features/challenges)', pattern: /\/src\/features\/challenges\// },
];

/** Modulerna i listan som landningens graf inte får nå: id och vad det är. Tom lista = vakten håller. */
export function forbiddenInLanding(moduleIds: readonly string[]): Array<{ id: string; what: string }> {
  const ids = moduleIds.map((id) => id.replace(/\\/g, '/'));
  return ids.flatMap((id) => FORBIDDEN_IN_LANDING.filter(({ pattern }) => pattern.test(id)).map(({ what }) => ({ id, what })));
}
