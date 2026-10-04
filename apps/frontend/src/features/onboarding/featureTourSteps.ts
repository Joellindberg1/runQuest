// 🎓 Page-specific feature tour steps
// Each export maps to a slug in useOnboardingQueue.
import type { TourStep } from './components/OnboardingTour';

// ── /events — tour_events_v1 ──────────────────────────────────────────────
export const TOUR_EVENTS_V1: TourStep[] = [
  {
    title: 'Events',
    description: 'Events are time-limited challenges that drop randomly. You can have participation events and weekly competitions running at the same time.',
  },
  {
    element: '[data-tour="events-participation"]',
    title: 'Participation Events',
    description: 'These have a time window — run the required distance within the window to earn XP. Miss the window and the event is gone.',
  },
  {
    element: '[data-tour="events-competition"]',
    title: 'Weekly Competitions',
    description: 'Competitions last the full week. The leaderboard ranks everyone by total km or elevation. Top 3 earn XP — keep running to hold your spot.',
  },
  {
    element: '[data-tour="events-history"]',
    title: 'Event History',
    description: 'Past events and your results show up here. Check how you performed and how much XP you earned.',
  },
];

// ── /challenges — tour_challenges_v1 ─────────────────────────────────────
export const TOUR_CHALLENGES_V1: TourStep[] = [
  {
    title: 'Challenges',
    description: '1v1 challenges against your group members. Win to earn XP boosts that multiply your next run. You can only have one active challenge at a time.',
  },
  {
    element: '[data-tour="challenges-tokens"]',
    title: 'Challenge Tokens',
    description: 'You need tokens to send a challenge. Tokens drop as you unlock titles and hit milestones — they\'re earned, not bought.',
  },
  {
    element: '[data-tour="challenges-live-tab"]',
    title: 'Live Challenges',
    description: 'When you have an active challenge, it shows here alongside all other ongoing group challenges.',
  },
  {
    element: '[data-tour="challenges-leaderboard"]',
    title: 'Challenge Leaderboard',
    description: 'Overall wins, draws and losses for your group. Challenge the top players to climb faster.',
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
    title: 'Challenge Shields',
    description: 'The shields on a card are the challenge tokens that runner can still send: blue for minor, orange for major, gold for legendary. The number beside them is how many are left.',
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

// ── / (profile tab) — tour_profile_v1 ────────────────────────────────────
export const TOUR_PROFILE_V1: TourStep[] = [
  {
    title: 'Your Profile',
    description: 'Your personal stats, run history and titles all in one place.',
  },
  {
    element: '[data-tour="profile-fun-fact"]',
    title: 'Stats',
    description: 'Level, XP progress, total distance, longest run — and even how far you\'ve come if you were Frodo carrying the ring to Mordor. Everything updates automatically after each Strava sync.',
  },
  {
    element: '[data-tour="profile-run-history"]',
    title: 'Run History',
    description: 'Every synced run listed here. Click a run to expand it — use the edit button if a distance or date looks wrong.',
  },
  {
    element: '[data-tour="profile-titles-tab"]',
    title: 'Titles',
    description: 'Under the Titles tab you can see the titles where you are the current holder and where you are the runner-up.',
  },
];
