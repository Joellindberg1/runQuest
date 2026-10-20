import { STOCKHOLM_TZ } from './calendar.js';

/**
 * Gruppens tidszon — DEN enda resolvern (ägarbeslut 2026-10-20: servern får en tid från gruppen som bestämmer vilken lokal tid
 * gruppen kör efter). Boostfönster, eventgränser, "idag" och 14-dagarssnittet räknar sina dygn i den här zonen, så en grupp i en annan
 * tidszon får sina dygn flyttade utan att någon räknefunktion ändras.
 *
 * Tidszon per grupp (RUN-21, reserverad nyckel `season.timezone` i group_settings, ADR 012 beslut 2) är inte byggd: utan `source`
 * svarar resolvern STOCKHOLM_TZ för varje grupp, och ingen inställning registreras här. RUN-21 byter resolverns källa (backend: setGroupTimeZoneSource)
 * och ändrar sedan de ställen som ännu inte går via resolvern. De är listade i apps/backend/src/utils/groupTimeZone.ts, RUN-21:s arbetslista.
 *
 * Fail-safe: en okänd grupp, en tom källa eller ett ogiltigt zonnamn ger STOCKHOLM_TZ, aldrig ett kast. En felstavad zon ska inte
 * ta ner en XP-omräkning; den räknar då som idag.
 */
export type GroupTimeZoneSource = (groupId: string) => string | null | undefined;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function groupTimeZone(groupId: string | null | undefined, source?: GroupTimeZoneSource): string {
  if (!groupId || !source) return STOCKHOLM_TZ;
  const zone = source(groupId);
  return typeof zone === 'string' && zone !== '' && isValidTimeZone(zone) ? zone : STOCKHOLM_TZ;
}
