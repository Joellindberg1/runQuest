import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveSettings, type SettingsValue } from '@runquest/shared';
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

interface Change {
  key: string;
  value: SettingsValue;
}

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
    mutationFn: async ({ key, value }: Change): Promise<UserSettingsState> => {
      const res = await backendApi.putSettings({ [key]: value });
      if (!res.success || !res.data) throw new Error(res.error || SAVE_FAILED);
      return { values: res.data.values, customised: res.meta?.customised ?? [] };
    },
    onMutate: async ({ key, value }): Promise<Snapshot> => {
      setError(null);
      // En hämtning i flykt har läst innan ändringen och får inte skriva tillbaka det gamla värdet över den.
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_QUERY_KEY });
      const before = current() ?? DEFAULT_STATE;
      queryClient.setQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY, withValue(before, key, value));
      return { value: before.values[key], wasCustomised: before.customised.includes(key) };
    },
    onError: (failure, { key }, snapshot) => {
      if (snapshot) {
        queryClient.setQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY, (state) => (state ? withSnapshot(state, key, snapshot) : state));
      }
      setError(failure instanceof Error && failure.message ? failure.message : SAVE_FAILED);
      needsRefresh.current = true;
    },
    onSuccess: (state) => {
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
  const setValue = useCallback((key: string, value: SettingsValue) => mutate({ key, value }), [mutate]);
  const toggle = useCallback(
    (key: string) => {
      const value = (queryClient.getQueryData<UserSettingsState>(USER_SETTINGS_QUERY_KEY) ?? DEFAULT_STATE).values[key];
      if (typeof value === 'boolean') mutate({ key, value: !value });
    },
    [mutate, queryClient],
  );

  const state = query.data ?? DEFAULT_STATE;
  return {
    values: state.values,
    customised: state.customised,
    /** Första hämtningen pågår (aldrig sann för en utloggad). */
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: write.isPending,
    /** Texten för `role="alert"`, eller null. */
    error,
    setValue,
    toggle,
  };
}
