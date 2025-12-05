# Profile Feature

User profile display and management.

## Structure

- **components/** - Profile-related components
  - `UserProfile.tsx` - Complete user profile view
  - `ProfileMenu.tsx` - Dropdown menu with navigation
  - `ProfilePictureUpload.tsx` - Profile picture upload
- **index.ts** - Public API exports

## Components

### UserProfile
Complete user profile with stats, runs history, and titles.

**Features:**
- User stats (XP, level, streak, total distance)
- Run history with edit/delete
- User titles display
- Level progress bar

### ProfileMenu
Navigation dropdown in header.

**Features:**
- Profile picture display
- Dashboard/Settings/Features navigation
- Admin panel link (for admins)
- Logout

### ProfilePictureUpload
Upload and manage profile pictures.

## Usage

```tsx
import { UserProfile, ProfileMenu } from '@/features/profile';

<ProfileMenu />
<UserProfile user={currentUser} />
```

## Data Sources

- User data: `backendApi.getUsersWithRuns()`
- User titles: `backendApi.getUserTitles()`
- Profile pictures: Supabase Storage
