// Backendens datumhjälpare. Själva kalender- och tidszonsaritmetiken (addDays, mondayOf, zoneDay, klockslag -> ögonblick) ligger i
// packages/shared/src/calendar.ts (RUN-218), och gruppens tidszon kommer ur utils/groupTimeZone.ts. Här finns bara veckointervallet:
// ingen "idag"-hjälpare, för "idag" är zoneDay(new Date(), groupTimeZone(groupId)) och tas fram där klockan läses.
import { addDays, mondayOf } from '@runquest/shared';

/** Veckan (mån–sön) som datumet tillhör, plus förra veckans måndag. */
export function weekRange(dateStr: string): { start: string; end: string; previous_start: string } {
  const start = mondayOf(dateStr);
  return { start, end: addDays(start, 6), previous_start: addDays(start, -7) };
}
