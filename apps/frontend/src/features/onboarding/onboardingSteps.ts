// 🎓 First-login onboarding tour steps (onboarding_v1)
// Groups sidebar sections and explains key features.
import type { TourStep } from './components/OnboardingTour';

export const ONBOARDING_V1_STEPS: TourStep[] = [
  {
    title: 'Welcome to RunQuest',
    description: 'RunQuest turns your runs into a multiplayer game — earn XP, climb the leaderboard and unlock titles. This quick tour shows you around.',
  },
  {
    element: '[data-tour="sidebar-game-section"]',
    title: 'The Game',
    description: 'These are the core game features — everything here is driven by your runs. The more you run, the higher you climb.',
  },
  {
    element: '[data-tour="sidebar-leaderboard"]',
    title: 'Leaderboard',
    description: 'Your group ranking sorted by XP. Every run earns base XP plus bonuses for distance, elevation and streaks. Check your position here.',
  },
  {
    element: '[data-tour="sidebar-titles"]',
    title: 'Titles',
    description: 'Unlock titles by hitting cumulative milestones — total km, elevation, streaks and more. Titles are displayed on your leaderboard card.',
  },
  {
    element: '[data-tour="sidebar-challenges"]',
    title: 'Challenges',
    description: 'Send 1v1 challenges to your group members. Win to earn XP boosts. Your active challenge is always shown at the bottom of the sidebar.',
  },
  {
    element: '[data-tour="sidebar-events"]',
    title: 'Events',
    description: 'Time-limited bonus events that drop randomly — morning runs, storm chasers, weekly distance competitions. Check in daily, you might miss one.',
  },
  {
    element: '[data-tour="sidebar-you-section"]',
    title: 'Your Profile',
    description: 'View your full run history, stats and earned titles under Profile. Use Log Run to manually add a run if Strava isn\'t synced yet.',
  },
  {
    element: '[data-tour="sidebar-strava"]',
    title: 'Connect Strava',
    description: 'Link Strava once and all your runs sync automatically — no manual logging needed. Settings → Strava to connect.',
  },
];
