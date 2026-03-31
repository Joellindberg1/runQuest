// 🎓 First-login onboarding tour steps (onboarding_v1)
// Uses data-tour attributes on DOM elements for reliable targeting.
// Add data-tour="..." to elements in the relevant components.
import type { TourStep } from './components/OnboardingTour';

export const ONBOARDING_V1_STEPS: TourStep[] = [
  {
    title: 'Welcome to RunQuest 🏃',
    description: 'RunQuest turns your runs into a game — earn XP, climb the leaderboard and unlock titles. Let\'s take a quick tour.',
  },
  {
    element: '[data-tour="sidebar-leaderboard"]',
    title: 'Leaderboard',
    description: 'See how you rank against your group. Every run earns XP — distance, elevation and streaks all count.',
  },
  {
    element: '[data-tour="sidebar-challenges"]',
    title: 'Challenges',
    description: 'Complete long-term challenges to unlock unique titles. They track your cumulative stats automatically.',
  },
  {
    element: '[data-tour="sidebar-events"]',
    title: 'Events',
    description: 'Time-limited events drop randomly — morning runs, storm chasers, weekly competitions. Check in daily.',
  },
  {
    element: '[data-tour="sidebar-strava"]',
    title: 'Connect Strava',
    description: 'Link your Strava account so runs sync automatically. No manual logging needed.',
  },
];
