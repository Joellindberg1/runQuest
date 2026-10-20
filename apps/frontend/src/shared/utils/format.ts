import { MS_DAY, MS_HOUR, MS_MINUTE } from '@runquest/shared';

// Frontendens enda formatmodul: tal, km, multiplikator, månadsnamn, "tid sedan", nedräkning och förnamn.
// Engelskt UI med svenskt tusentalsmellanrum ("1 240"). Modulen använder aldrig Intl eller toLocale*: förrenderade
// Landing hydreras mot samma text i webbläsaren, och Intl ger olika svar på byggdatorn och hos användaren
// (lint förbjuder det här och på Landing). Månadsnamnen är egna, Intl:s förkortningar skiljer mellan ICU-versioner ("Sept").

const NBSP = ' ';

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** "1 240" — heltal med hårt mellanslag (U+00A0) som tusentalsavgränsare. */
export function formatInt(value: number): string {
  return groupThousands(String(Math.round(value)));
}

/** "8.0" — km med en decimal (punkt som decimaltecken) och samma tusentalsmellanrum som formatInt: "1 240.5". */
export function formatKm(km: number, digits = 1): string {
  const [whole, decimals] = km.toFixed(digits).split('.');
  return decimals === undefined ? groupThousands(whole) : `${groupThousands(whole)}.${decimals}`;
}

/** "1.4×" — multiplikatorn efter siffran (historikcellen, streaktrappan). */
export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(1)}×`;
}

/** "×1.4" — multiplikatorn före siffran (XP-uppställningen, texten på Landing). */
export function formatTimes(multiplier: number): string {
  return `×${multiplier.toFixed(1)}`;
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "21 Aug" för en kalenderdag (YYYY-MM-DD; ett klockslag efter datumet läses inte). */
export function formatDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/**
 * "Tid sedan" i fyra namngivna stilar. Varje skärm har sin egen text och den ändras inte här; vill vi ha en enhetlig stil
 * är det en designfråga, och då byts stilarna mot en.
 *  - spelled:   "just now" · "32 min ago" · "3 h ago" · "2 d ago" (Log, Settings)
 *  - compact:   "just now" · "5 m ago" · "7 h ago" · "4 d ago" (Board)
 *  - feed:      "now" · "12m" · "2h" · "3d" (raderna i News)
 *  - feed-long: "Just now" · "12m ago" · "2h ago" · "Yesterday" · "3 days ago" (News-popovern)
 */
export type AgoStyle = 'spelled' | 'compact' | 'feed' | 'feed-long';

interface AgoWording {
  now: string;
  minutes: (count: number) => string;
  hours: (count: number) => string;
  days: (count: number) => string;
}

const AGO_WORDING: Record<AgoStyle, AgoWording> = {
  spelled: { now: 'just now', minutes: (n) => `${n} min ago`, hours: (n) => `${n} h ago`, days: (n) => `${n} d ago` },
  compact: { now: 'just now', minutes: (n) => `${n} m ago`, hours: (n) => `${n} h ago`, days: (n) => `${n} d ago` },
  feed: { now: 'now', minutes: (n) => `${n}m`, hours: (n) => `${n}h`, days: (n) => `${n}d` },
  'feed-long': {
    now: 'Just now',
    minutes: (n) => `${n}m ago`,
    hours: (n) => `${n}h ago`,
    days: (n) => (n === 1 ? 'Yesterday' : `${n} days ago`),
  },
};

/** Tiden som gått, `ms`, som text i vald stil. Dagar är hela dygn; en kalenderdagsräkning skickar in `dagar * MS_DAY`. */
export function formatAgo(ms: number, style: AgoStyle = 'spelled'): string {
  const wording = AGO_WORDING[style];
  if (ms < MS_MINUTE) return wording.now;
  if (ms < MS_HOUR) return wording.minutes(Math.floor(ms / MS_MINUTE));
  if (ms < MS_DAY) return wording.hours(Math.floor(ms / MS_HOUR));
  return wording.days(Math.floor(ms / MS_DAY));
}

/**
 * Nedräkning i fyra namngivna stilar. Negativ tid räknas som noll.
 *  - hms:    "6h 12m 05s" (streakens nedräkning)
 *  - hm:     "6h 12m" · "25m" (streaklistans "left")
 *  - coarse: "3d 4h" · "6h 14m" · "14m" · "<1m" (Events)
 *  - pill:   "3 d" · "6h" · "28 m" · "<1 m" (Right now-pillen)
 */
export type CountdownStyle = 'hms' | 'hm' | 'coarse' | 'pill';

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function formatCountdown(ms: number, style: CountdownStyle): string {
  const left = Math.max(0, ms);
  switch (style) {
    case 'hms': {
      const totalSeconds = Math.floor(left / 1000);
      const minutesIntoHour = Math.floor((totalSeconds % 3600) / 60);
      return `${Math.floor(totalSeconds / 3600)}h ${pad2(minutesIntoHour)}m ${pad2(totalSeconds % 60)}s`;
    }
    case 'hm': {
      const totalMinutes = Math.floor(left / MS_MINUTE);
      const hours = Math.floor(totalMinutes / 60);
      return hours === 0 ? `${totalMinutes}m` : `${hours}h ${pad2(totalMinutes % 60)}m`;
    }
    case 'coarse':
      if (left < MS_MINUTE) return '<1m';
      if (left < MS_HOUR) return `${Math.floor(left / MS_MINUTE)}m`;
      if (left < MS_DAY) return `${Math.floor(left / MS_HOUR)}h ${Math.floor((left % MS_HOUR) / MS_MINUTE)}m`;
      return `${Math.floor(left / MS_DAY)}d ${Math.floor((left % MS_DAY) / MS_HOUR)}h`;
    case 'pill':
      if (left < MS_MINUTE) return '<1 m';
      if (left < MS_HOUR) return `${Math.floor(left / MS_MINUTE)} m`;
      if (left < MS_DAY) return `${Math.floor(left / MS_HOUR)}h`;
      return `${Math.floor(left / MS_DAY)} d`;
  }
}

/** Förnamnet ("Karl" ur "Karl Persson"). Ett tomt namn ger tomt. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
