# Profile Feature

User profile display and management.

## Structure

- **components/** - Profile-related components
  - `UserProfile.tsx` - Own profile view (route `/profile`)
  - `RunnerCard.tsx` - Another runner's card (route `/runner/:id`; page on mobile, overlay on desktop)
  - `StatsTab.tsx`, `UserTitlesList.tsx`, `UserRunHistory.tsx`, `FrodoJourney.tsx` - Building blocks
  - `ProfilePictureUpload.tsx` - Profile picture upload

## Navigation

The account menu lives in the app shell (`src/app-shell/AvatarMenu.tsx`), not here.
Routes and shell are described in ADR 006.

## Data Sources

- User data: `useUsersWithRuns()` (`backendApi.getUsersWithRuns()`, shared TanStack cache)
- User titles: `backendApi.getUserTitles()`
- Profile pictures: Supabase Storage
