// 🎓 Page-specific feature tour steps
// Each export maps to a slug in useOnboardingQueue.
import type { TourStep } from './components/OnboardingTour';

// ── /events — tour_events_v2 ──────────────────────────────────────────────
// v2: skärmen är omritad (öppet nu / up next / veckan / historik med pager); v1-ankarna finns inte längre.
export const TOUR_EVENTS_V2: TourStep[] = [
  {
    title: 'Events',
    description: 'Events are time-limited challenges that drop at random, usually announced the evening before. Participation events pay XP the moment you finish them; weekly competitions rank the pack and pay the top three when the week ends on Sunday night.',
  },
  {
    element: '[data-tour="events-open"]',
    title: 'Open now and up next',
    description: 'A participation event is open inside its window: log a run that meets the minimum distance and the XP is yours straight away, no ranking. A competition ranks everyone on total distance or elevation for the week. Up next counts down to the next event that opens.',
  },
  {
    element: '[data-tour="events-history"]',
    title: 'History',
    description: 'Every finished event and what you got from it — done or missed, your place in a competition and the XP it paid. Use the arrows at the bottom to page back through them.',
  },
];

// ── /duels — tour_duels_v2 ───────────────────────────────────────────────
// v2: skärmen är omritad (Standings/Live/Rules/History, tokens, send-sheet); v1-ankarna finns inte längre.
export const TOUR_DUELS_V2: TourStep[] = [
  {
    title: 'Challenges',
    description: '1v1 duels against your pack. Win and you get an XP boost on top of your streak multiplier; lose and you take a penalty. You can only have one challenge going at a time.',
  },
  {
    element: '[data-tour="duels-tokens"]',
    title: 'Your tokens',
    description: 'A token is a challenge you can send. You earn them by levelling up, and each one fixes the metric and the length of the duel — you choose who gets it.',
  },
  {
    element: '[data-tour="duels-send"]',
    title: 'Send a challenge',
    description: 'Pick a token and an opponent. The duel starts the day after they accept; minor and major challenges lapse after three days without an answer.',
  },
  {
    element: '[data-tour="duels-tabs"]',
    title: 'Standings, Live, Rules, History',
    description: 'Standings ranks the pack by win rate. Live shows every duel in progress. Rules explains the stakes, and History lists every settled match.',
  },
];

// ── / (leaderboard tab) — tour_leaderboard_v2 ────────────────────────────
export const TOUR_LEADERBOARD_V1: TourStep[] = [
  {
    title: 'Leaderboard',
    description: 'Your group ranked by XP. Every run contributes — distance, streaks and bonus events all count.',
  },
  {
    // No element — floating step. The leaderboard is visible in the background.
    title: 'XP Rankings',
    description: 'The podium holds the top three, the list below ranks everyone else by total XP. Arrows show who moved since Monday and the bar is progress into the current level. The tabs switch between All-time, Week and Streaks.',
  },
  {
    element: '[data-tour="leaderboard-card"]',
    title: 'Challenge Pennants',
    description: 'The pennants on a card are the challenge tokens that runner can still send: blue for minor, orange for major, gold for legendary. The number beside them is how many are left.',
  },
  {
    element: '[data-tour="leaderboard-card"]',
    title: 'Player Profiles',
    description: 'Tap any card to open that player\'s full profile — stats, Frodo\'s Journey progress and titles. You can also open profiles from the group run history and challenge views.',
  },
];

// ── /titles — tour_titles_v2 ─────────────────────────────────────────────
export const TOUR_TITLES_V2: TourStep[] = [
  {
    title: 'Titles',
    description: 'Titles are records the group competes for: the best number holds the title until someone beats it. They are grouped by category — open a group to see each title, its rule, who holds it and who is chasing.',
  },
  {
    element: '[data-tour="titles-filter"]',
    title: 'Filter',
    description: 'All shows every title, Mine only the ones you hold, and Unclaimed the ones nobody has unlocked yet — with the runner who is closest so far.',
  },
  {
    element: '[data-tour="titles-display"]',
    title: 'On display',
    description: 'Pick up to three of your titles to show on your leaderboard card: press "Show on leaderboard" on a title you hold, then save.',
  },
];

// ── /news — tour_news_v2 ──────────────────────────────────────────────────
// v2: slugen är bumpad så att alla ser turen igen (tour_news_v1 ligger kvar som oanvänd rad i user_seen_items). Fem steg (ägarbeslut 7): flödet och
// läs-gesten är ett steg, "Involves me" nämns i filtersteget i stället för att få ett eget (det finns inget news-involves-ankare), och turen
// avslutas med ett flytande steg. Det första "Pack News"-introt är borta; flödet är nu första steget.
// Läs-gesten (ägarbeslut 2): mus efter rörelse, tryck, eller Enter. FOKUS markerar aldrig läst, så ordet får inte stå i copyn (featureTourSteps.test.ts).
// Klockan i headern (header-news) har ingen egen tourstep. Turen monteras bara när flödet har rader, och news-mark-read-steget bara när något är
// oläst (NewsScreen). news-settings är kortet i sidokolumnen på desktop och kugghjulsknappen på mobil (en och samma attribut).
// Våg 2 (Ranks, RUN-191) ingår i v0.7.0. Bryts den ut: stryk "ranks" ur filtersteget.
export const TOUR_NEWS_V2: TourStep[] = [
  {
    element: '[data-tour="news-feed"]',
    title: 'The feed',
    description: 'Everything the pack does, newest first and grouped by day. A gold dot and bold type mean you have not read it yet: move your mouse over it, tap it, or press Enter and it counts as read. Read rows stay in the feed; they just stop counting on the bell. Show more at the bottom goes further back.',
  },
  {
    element: '[data-tour="news-filter"]',
    title: 'Filter',
    description: 'Pick one or more kinds (titles, challenges, ranks, events, levels, badges or streaks) to narrow the feed. Involves me keeps only news about you: your moves, moves against you and events you joined. Pick nothing to see everything.',
  },
  {
    element: '[data-tour="news-settings"]',
    title: 'Notification settings',
    description: 'Choose what the bell counts and what its list shows: titles taken from you, challenges, rank changes, events and more. This page always shows everything, whatever you switch off.',
  },
  {
    element: '[data-tour="news-mark-read"]',
    title: 'Mark all read',
    description: 'Clears the unread count on the bell in one go. The bell in the header opens the five latest news that count for you, from anywhere in the app.',
  },
  {
    // No element — floating step, closes the tour.
    title: 'Your bell, your rules',
    description: 'The page always shows the whole pack. Switch off what you do not want on the bell and nothing is ever lost; change it again any time, here or in Settings.',
  },
];

// ── /profile — tour_profile_v2 ───────────────────────────────────────────
// v2: skärmen är omritad (hjältekort, Frodo-zoom, statflikar med Consistency, titlar, rundhistorik med redigera/radera);
// v1-ankarna (profile-fun-fact, profile-run-history, profile-titles-tab) finns inte längre.
export const TOUR_PROFILE_V2: TourStep[] = [
  {
    title: 'Your profile',
    description: 'Your level, stats, titles and every run you have logged, in one place.',
  },
  {
    element: '[data-tour="profile-hero"]',
    title: 'Level and totals',
    description: 'The ring shows how far you are into your current level. Below it: total XP, total km, your challenge record and, on a wide screen, runs and titles held. Tap Change photo to set your profile picture.',
  },
  {
    element: '[data-tour="profile-journey"]',
    title: 'Frodo’s journey',
    description: 'Your total distance as a walk to Mount Doom, 3 266 km. Press the zoom button to cycle Overview, Zoomed and Close-up and see the next checkpoint.',
  },
  {
    element: '[data-tour="profile-stats"]',
    title: 'Stats',
    description: 'Distance, Streak and Fun facts, plus Consistency: a square for every day you ran, darker the longer the run, with your current and longest streak underneath.',
  },
  {
    element: '[data-tour="profile-titles"]',
    title: 'My titles',
    description: 'The titles you hold, with the record that earned each one. Runner-up shows who holds a title you are chasing and how far behind you are.',
  },
  {
    element: '[data-tour="profile-history"]',
    title: 'Run history',
    description: 'Every run you have logged. Manual runs can be edited or deleted if a distance or date looks wrong; Strava runs come from Strava and are read-only here. Your streak and XP are recalculated from that day on.',
  },
];
