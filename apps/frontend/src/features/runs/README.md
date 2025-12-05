# Runs Feature

Run logging, editing, and history display.

## Structure

- **components/** - Run-related components
  - `RunLogger.tsx` - Manual run entry form
  - `EditRunDialog.tsx` - Edit existing runs
  - `RunHistoryGroup.tsx` - Group run history feed
- **index.ts** - Public API exports

## Components

### RunLogger
Manual run entry with date and distance.

**Features:**
- Date picker (max: today)
- Distance input with validation
- Smart XP calculation preview
- Strava import option

### EditRunDialog
Edit or delete existing runs.

**Features:**
- Update distance
- Update date
- Delete run
- Automatic XP recalculation

### RunHistoryGroup
Chronological feed of all users' runs.

**Features:**
- User avatars and names
- Run details (distance, XP, streak)
- Strava/Manual indicators
- Date grouping

## Usage

```tsx
import { RunLogger, EditRunDialog, RunHistoryGroup } from '@/features/runs';

<RunLogger onRunSubmit={handleSubmit} />
<EditRunDialog run={selectedRun} onClose={handleClose} />
<RunHistoryGroup />
```

## API Integration

- Create run: `backendApi.createRun()`
- Update run: `backendApi.updateRun()`
- Delete run: `backendApi.deleteRun()`
- Get history: `backendApi.getGroupRunHistory()`
