// Höjdmeter som räknas för en runda. Ägarbeslut 2026-10-23: löpband räknas som vanliga rundor i titlar och badges, men utan
// höjdmeter (och utan väder). Regeln finns här och ingen annanstans: titelmotorerna The Mountain Goat och The Vertical Runner
// och badgemåttet total_elevation_m läser höjden genom den här funktionen.
// is_treadmill null (äldre rader) räknas som utomhus. Eventet Weekly elevation filtrerar i databasen (`is_treadmill = false`,
// vilket också utesluter null) och går inte genom den här funktionen: det vore en beteendeändring för null-rader.

/** Det som behövs av en runda för att avgöra dess höjdmeter. Fälten följer runs-tabellen. */
export interface ElevationRun {
  total_elevation_gain?: number | null;
  is_treadmill?: boolean | null;
}

/** Meter höjd som rundan bidrar med: 0 för en löpbandsrunda och för okänd höjd, annars den lagrade höjden. */
export function countedElevationGain(run: ElevationRun): number {
  if (run.is_treadmill === true) return 0;
  return run.total_elevation_gain ?? 0;
}
