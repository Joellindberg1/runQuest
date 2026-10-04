# Runs Feature

Det som blev kvar av `features/runs` när Log-skärmen byggdes om (inkrement 7): bara `hooks/useRunUpdates.ts`.

- **Logga runda och Group history** → `features/log` (se dess README). `RunLogger`, `RunHistoryGroup`, `useCreateRun` och `useGroupRunHistory` är borta.
- **Redigera/radera en runda** ligger i Profile: `features/profile/components/UserRunHistory` → `shared/components/EditRunDialog` →
  `shared/hooks/useRunMutations` (`PUT/DELETE /runs/:id`). Efter en ändring anropas `onRunUpdated` (`useRunUpdates`), som hämtar om `users-with-runs`.
  Profile ritas om i inkrement 8 — flytta `useRunUpdates` dit då, så kan den här mappen tas bort.
