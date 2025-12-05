# Titles Feature

Competitive title system with automatic leaderboards.

## Structure

- **components/** - Title display components
  - `TitleSystem.tsx` - Main title overview
  - `title-system/` - Sub-components (TitleCard, TitleRequirements, etc.)
- **hooks/** - React Query hooks
  - `useTitleQueries.ts` - Title data fetching
- **index.ts** - Public API exports

## Components

### TitleSystem
Displays all available titles and current holders.

**Features:**
- 4 competitive titles (Total XP, Distance, Streak, Runs)
- Real-time holder display
- Top 10 rankings
- Title requirements breakdown

### Title Types

**Competitive Titles (4):**
- 👑 **XP King/Queen** - Highest total XP
- 🏃 **Distance Master** - Most total kilometers
- 🔥 **Streak Warrior** - Longest active streak
- 📊 **Run Champion** - Most total runs

**Features:**
- Automatic position tracking
- Change hands when records broken
- Real-time updates

## Usage

```tsx
import { TitleSystem } from '@/features/titles';

<TitleSystem />
```

## Data Flow

1. Fetch title leaderboard via `backendApi.getTitleLeaderboard()`
2. Filter by user for personal titles
3. Auto-refresh on run updates
4. Display with proper status indicators

## Hooks

### useTitleQueries
React Query hooks for title data.

```tsx
const { userTitles, isLoading, isError } = useUserTitles(userId);
```
