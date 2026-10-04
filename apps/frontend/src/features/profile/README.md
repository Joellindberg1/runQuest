# Profile Feature

User profile display and management.

## Structure

- **components/** - Profile-related components
  - `UserProfile.tsx` - Own profile view (route `/profile`)
  - `StatsTab.tsx`, `UserTitlesList.tsx`, `UserRunHistory.tsx`, `FrodoJourney.tsx` - Building blocks (ritas om i inkrement 8)
  - `ProfilePictureUpload.tsx` - Profile picture upload
- **frodoModel.ts** - Ren waypoint-/viewport-matematik för Frodo's journey; delas med Runner card

Runner card (`/runner/:id`) bor i `features/runner`.

## Navigation

The account menu lives in the app shell (`src/app-shell/AvatarMenu.tsx`), not here.
Routes and shell are described in ADR 006.

## Data Sources

- User data: `useUsersWithRuns()` (`backendApi.getUsersWithRuns()`, shared TanStack cache)
- User titles: `backendApi.getUserTitles()`
- Profile pictures: Supabase Storage
