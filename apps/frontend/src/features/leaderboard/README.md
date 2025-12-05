# Leaderboard Feature

XP-based leaderboard with user rankings and level progression.

## Structure

- **components/** - Leaderboard UI components
  - `Leaderboard.tsx` - Main leaderboard component
  - `leaderboard/` - Sub-components (UserCard, UserStats, etc.)
- **index.ts** - Public API exports

## Components

### Leaderboard
Displays ranked list of users with XP, level, and titles.

**Features:**
- Real-time user rankings
- XP and level display
- User title badges
- Profile pictures
- Streak multipliers

## Usage

```tsx
import { Leaderboard } from '@/features/leaderboard';

<Leaderboard />
```

## Data Flow

1. Fetches users via `backendApi.getUsersWithRuns()`
2. Fetches user titles via `backendApi.getUserTitles()`
3. Calculates rankings and displays sorted list
