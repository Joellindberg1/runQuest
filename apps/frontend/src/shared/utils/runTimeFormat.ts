import { pad2 } from './format';

// Löptid och tempo (ADR 007 addendum 2026-10-26, punkt 2). Egen modul, inte en del av format.ts: format.ts delas med landningen, och vad som ligger där hamnar
// i landningens chunk så fort något använder det. Tid och tempo används bara av Log, Profile och mobilens rader, så de får inte dra JS till `/`.
// Samma regel som format.ts: aldrig Intl eller toLocale* (lint). Formatfunktionerna tar bara giltiga tal; null (saknad tid) hanteras i vymodellerna.

/**
 * Löptid som "52:10" under en timme och "1:09:40" från en timme (timmarna obegränsade: "111:06:40"). Sekunderna avrundas först,
 * sedan delas de upp, så 3599.6 blir "1:00:00" och aldrig "59:60". Tar bara giltiga tal; saknad tid (null) hanteras i vymodellen.
 */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = pad2(total % 60);
  return hours === 0 ? `${minutes}:${rest}` : `${hours}:${pad2(minutes)}:${rest}`;
}

/** Tempo som "5:13" (sekunder per km, avrundat före uppdelningen: 359.6 blir "6:00", aldrig "5:60"). */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** Skärmläsartexten för en tid- och tempocell: "Time 52:10, pace 5:13 per kilometre". */
export function timePaceLabel(seconds: number, paceSecPerKm: number): string {
  return `Time ${formatDuration(seconds)}, pace ${formatPace(paceSecPerKm)} per kilometre`;
}
