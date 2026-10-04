// 🎓 First-login onboarding tour steps (onboarding_v1)
// Ankarna ägs av app-skalet (ADR 006 beslut 8): bottenbar (mobil) eller sidnav (desktop).
// Steg som landar på olika element per skalvariant använder en kommaseparerad selektor.
import type { TourStep } from './components/OnboardingTour';

export const ONBOARDING_V1_STEPS: TourStep[] = [
  {
    title: 'Welcome to RunQuest',
    description: 'RunQuest turns your runs into a multiplayer game — earn XP, climb the leaderboard and unlock titles. This quick tour shows you around.',
  },
  {
    element: '[data-tour="nav-ranks"]',
    title: 'Ranks',
    description: 'Your group ranking sorted by XP. Every run earns base XP plus bonuses for distance, elevation and streaks. Check your position here.',
  },
  {
    element: '[data-tour="nav-titles"]',
    title: 'Titles',
    description: 'Unlock titles by hitting cumulative milestones — total km, elevation, streaks and more. Titles are displayed on your leaderboard card.',
  },
  {
    element: '[data-tour="nav-duels"]',
    title: 'Duels',
    description: 'Send 1v1 challenges to your group members. Win to earn XP boosts. Your active duel shows up in the "Right now" row.',
  },
  {
    element: '[data-tour="nav-events"], [data-tour="header-events"]',
    title: 'Events',
    description: 'Time-limited bonus events that drop randomly — morning runs, storm chasers, weekly distance competitions. Check in daily, you might miss one.',
  },
  {
    element: '[data-tour="nav-new"]',
    title: 'Log a run',
    description: 'Add a run manually if Strava isn\'t synced yet — treadmill runs and runs Strava missed belong here.',
  },
  {
    element: '[data-tour="nav-you"]',
    title: 'You',
    description: 'View your full run history, stats and earned titles under You.',
  },
  {
    element: '[data-tour="right-now-strava"]',
    title: 'Connect Strava',
    description: 'Link Strava once and all your runs sync automatically — no manual logging needed. Settings → Strava to connect.',
  },
];
