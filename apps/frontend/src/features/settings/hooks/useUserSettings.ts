import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_PATCH_KEYS, isAnalyticsSettingKey, resolveSettings, type SettingsValue } from '@runquest/shared';
import { track } from '@/shared/analytics/track';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/providers/authContext';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';

// Användarens inställningar (ADR 011 beslut 2 och 9): EN hook för båda platserna där panelen bor (Settings och /news).
// Cachen är användarbunden och rensas av AuthProvider vid login, logout och 401.

export const USER_SETTINGS_QUERY_KEY = ['settings', 'user'] as const;
const WRITE_KEY = ['settings', 'user', 'write'] as const;
const SAVE_FAILED = 'Failed to save settings';
const STALE_MS = 60_000;

/** Serverns tillstånd som det ligger i cachen: alla nycklar upplösta, plus de som användaren uttryckligen satt. */
export interface UserSettingsState {
  values: Record<string, SettingsValue>;
  customised: string[];
}

/** Defaults för användarscopet. Modulkonstant så att referensen är stabil medan inget är laddat. */
const DEFAULT_STATE: UserSettingsState = { values: resolveSettings({}, 'user'), customised: [] };

/** En skrivning: nyckel → nytt värde, eller `null` = återställ nyckeln till standard (raden raderas, som i PUT /settings). */
type Patch = Record<string, SettingsValue | null>;

interface Snapshot {
  value: SettingsValue | undefined;
  wasCustomised: boolean;
}

function withValue(state: UserSettingsState, key: string, value: SettingsValue): UserSettingsState {
  return {
    values: { ...state.values, [key]: value },
    customised: state.customised.includes(key) ? state.customised : [...state.customised, key],
  };
}

function withDefault(state: UserSettingsState, key: string): UserSettingsState {
  const values = { ...state.values };
  const fallback = DEFAULT_STATE.values[key];
  if (fallback === undefined) delete values[key];
  else values[key] = fallback;
  return { values, customised: state.customised.filter((existing) => existing !== key) };
}

function withPatch(state: UserSettingsState, patch: Patch): UserSettingsState {
  return Object.entries(patch).reduce((next, [key, value]) => (value === null ? withDefault(next, key) : withValue(next, key, value)), state);
}

/** Delar nycklarna i PUT-bitar om högst MAX_PATCH_KEYS (servern avvisar fler). */
function chunked(keys: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < keys.length; start += MAX_PATCH_KEYS) chunks.push(keys.slice(start, start + MAX_PATCH_KEYS));
  return chunks;
}

function withSnapshot(state: UserSettingsState, key: string, before: Snapshot): UserSettingsState {
  const values = { ...state.values };
  if (before.value === undefined) delete values[key];
  else values[key] = before.value;
  const others = state.customised.filter((existing) => existing !== key);
  return { values, customised: before.wasCustomised ? [...others, key] : others };
}

/**
 * Inställningarna för den inloggade (GET/PUT /settings).
 *
 * - **Optimistiskt per nyckel:** reglaget byter läge direkt. Skrivningarna går en i taget i ordning (`scope`), så två snabba val av samma
 *   nyckel aldrig kan landa omkastade på servern. Ett fel återställer BARA den nyckeln (resten av cachen rörs inte) och visas som
 *   `error` för en `role="alert"`; nästa ändring tar bort felet.
 * - **Servern har sista ordet:** svaret på en PUT är hela tillståndet (`values` + `meta.customised`) och skrivs in i cachen. Medan fler
 *   skrivningar väntar hoppas det över, så att det inte skriver över deras optimistiska värden; den sista skrivningen skriver in tillståndet.
 * - **Ett fel är inte sanningen om lagringen:** en PUT kan svara 500 fast skrivningen lyckades (återläsningen föll). Efter ett fel
 *   läses därför tillståndet om (och nyhetsflödet, vars räknare beror på inställningarna) när sista skrivningen är klar, i stället för att
 *   bara lita på den lokala återställningen.
 * - **Nyhetsflödet invalideras efter lyckad skrivning:** räknaren ändras serverside när ett slag slås av eller på.
 * - **Känd begränsning:** en hämtning som STARTAR efter den optimistiska ändringen (t.ex. en omhämtning) men läser innan servern tagit emot skrivningen kan
 *   kort visa det gamla värdet. Hämtningar som redan pågår när reglaget byts avbryts (onMutate); den sista skrivningens svar skriver in serverns tillstånd och rättar resten.
 * - **Laddningsfel blockerar inte:** `values` är då defaults och `isError` är sann; reglagen fungerar och en lyckad skrivning ger serverns tillstånd.
 * - **Laddningsfel eller bakgrundsfel:** `isError` är sann även när en OMHÄMTNING misslyckas medan värden finns i cachen (t.ex. omläsningen efter ett misslyckat PUT).
 *   `loadFailed` är sann bara när det inte finns något data alls (första hämtningen föll): då är `values` gissade defaults. Vyer som varnar eller låser
 *   reglagen ska titta på `loadFailed`, inte `isError`; vid ett bakgrundsfel är värdena de senast kända och reglagen fortsätter fungera.
 */
export function useUserSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const enabled = !!user;

  const query = useQuery({
    queryKey: USER_SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<UserSettingsState> => {
      const res = await backendApi.getSettings();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to fetch settings');
      return { values: res.data.values, customised: res.meta?.customised ?? [] };
    },
    enabled,
    staleTime: STALE_MS,
    retry: 1,
  });

  const current = () => queryClient.getQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY);
  /** Sant när den pågående skrivningen är den sista i kön (den räknas själv med medan dess callbacks körs). */
  const isLastWrite = () => queryClient.isMutating({ mutationKey: WRITE_KEY }) <= 1;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: USER_SETTINGS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot });
  };

  // Ref, inte state: callbackarna nedan lever kvar från renderingen där skrivningen startade.
  const needsRefresh = useRef(false);

  const write = useMutation({
    mutationKey: WRITE_KEY,
    scope: { id: 'user-settings-write' },
    mutationFn: async (patch: Patch): Promise<UserSettingsState> => {
      const res = await backendApi.putSettings(patch);
      if (!res.success || !res.data) throw new Error(res.error || SAVE_FAILED);
      return { values: res.data.values, customised: res.meta?.customised ?? [] };
    },
    onMutate: async (patch): Promise<Record<string, Snapshot>> => {
      setError(null);
      // En hämtning i flykt har läst innan ändringen och får inte skriva tillbaka det gamla värdet över den.
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_QUERY_KEY });
      const before = current() ?? DEFAULT_STATE;
      queryClient.setQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY, withPatch(before, patch));
      return Object.fromEntries(Object.keys(patch).map((key) => [key, { value: before.values[key], wasCustomised: before.customised.includes(key) }]));
    },
    onError: (failure, patch, snapshots) => {
      if (snapshots) {
        queryClient.setQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY, (state) =>
          state ? Object.keys(patch).reduce((next, key) => withSnapshot(next, key, snapshots[key]), state) : state,
        );
      }
      setError(failure instanceof Error && failure.message ? failure.message : SAVE_FAILED);
      needsRefresh.current = true;
    },
    onSuccess: (state, patch) => {
      // Bara vilken inställning som rördes, aldrig vad den sattes till (se ANALYTICS_EVENTS i shared). Efter sparandet, så en misslyckad skrivning inte räknas.
      for (const key of Object.keys(patch)) if (isAnalyticsSettingKey(key)) track('setting-changed', { setting: key });
      if (isLastWrite()) queryClient.setQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY, state);
      void queryClient.invalidateQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot });
    },
    onSettled: () => {
      if (needsRefresh.current && isLastWrite()) {
        needsRefresh.current = false;
        refresh();
      }
    },
  });

  const { mutate } = write;
  const setValue = useCallback((key: string, value: SettingsValue) => mutate({ [key]: value }), [mutate]);
  const toggle = useCallback(
    (key: string) => {
      const value = (queryClient.getQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY) ?? DEFAULT_STATE).values[key];
      if (typeof value === 'boolean') mutate({ [key]: !value });
    },
    [mutate, queryClient],
  );
  // Ett PUT per MAX_PATCH_KEYS nycklar; skrivningarna går ändå i ordning (scope).
  const reset = useCallback(
    (keys: readonly string[]) => {
      for (const chunk of chunked(keys)) mutate(Object.fromEntries(chunk.map((key) => [key, null])));
    },
    [mutate],
  );
  const { refetch } = query;
  const reload = useCallback(() => void refetch(), [refetch]);

  const state = query.data ?? DEFAULT_STATE;
  return {
    values: state.values,
    customised: state.customised,
    /** Första hämtningen pågår (aldrig sann för en utloggad). */
    isLoading: query.isLoading,
    isError: query.isError,
    /** Inget data alls: `values` är defaults, inte serverns tillstånd. Falskt vid ett bakgrundsfel med värden i cachen. */
    loadFailed: query.isError && query.data === undefined,
    isSaving: write.isPending,
    /** Texten för `role="alert"`, eller null. */
    error,
    setValue,
    toggle,
    /** Återställ nycklarna till standard (PUT med null). Den optimistiska ändringen och felhanteringen är samma som för en växling. */
    reset,
    /** Läs om inställningarna (Retry efter ett laddningsfel). */
    reload,
  };
}
