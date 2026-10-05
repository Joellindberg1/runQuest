# Runs Feature

Det som delas av allt som ändrar rundorna: `runEffects.ts` — `invalidateAfterRunChange(queryClient)` och `EVENT_FOLLOW_UP_MS`.

- **Logga en runda och Group history** → `features/log` (`useCreateRun` anropar kedjan efter POST).
- **Redigera/radera en runda** → `features/profile` (`useUpdateRun`/`useDeleteRun` anropar kedjan efter PUT/DELETE; rutan är `EditRunSheet`).
- **Kedjan:** users-with-runs (väntas in), `['leaderboard']`, öppna event (exakt, direkt + en gång efter 4 s — servern kvalificerar event i bakgrunden), `['titles']`,
  `['multiple-user-titles']`, `['challenges']`, Runner cards head-to-head och gruppens historik. EN definition, så POST, PUT och DELETE aldrig glider isär.
  Testas via `useCreateRun.test.tsx` och `profile/hooks/useRunChanges.test.tsx`.
