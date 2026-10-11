# Auth Feature

Authentication and authorization for the application. Inloggningsdialogen (popup över Landing, adress `/login`) bor här; sessionshanteringen ligger i `providers/AuthProvider.tsx`.

## Struktur

- **components/LoginDialog** — inloggningen som popup (RUN-145): Radix Dialog + skalets `.rq-scrim`/`.rq-modal`, formulärkitets fält. Monteras av `pages/Index` när adressen är `/login`.
- **hooks/useLoginForm** — formulärets tillstånd (egen laddning, ingen global loader: ett fel avmonterar aldrig formuläret)
- **hooks/useCloseLogin** — stängning (Esc, ✕, scrim): Back om dialogen öppnades från Landings knapp (router-state `FROM_LANDING_STATE`), annars `replace` till `/`
- `login.css` — mått (`--rq-login-w`) i temafilen, sektion 1.29

## Inloggningsdialogen

- Ingen egen sida längre (`LoginPage`/`LoginScreen` är borta): Landing ligger kvar bakom scrimmen och dialogen ligger över. Ingen prototyp finns; komposition = `WhatsNew`-modalens ram (rubrik "Sign in", "Continue your journey") + Components-filens fält (`shared/components/form/TextField`).
- **Semantik och fokus.** `role=dialog`, `aria-modal`, `aria-labelledby` (rubriken) och `aria-describedby` (raden under); fokus går till Username (inte ✕), fokusfällan och Escape kommer från Radix, och fokus lämnas tillbaka till det som hade det före (Landings Sign in-länk).
  Radix gömmer allt utanför dialogen för hjälpmedel medan den är öppen.
- **Stängning.** Esc, ✕, klick på scrimmen och Back stänger — även under pågående inloggning (`backendApi.login` har ingen timeout; en spärr hade gett en död ✕). Försöket avbryts då (`AbortSignal` → `AuthProvider.login`): ett svar som kommer efter att dialogen lämnats kastas (token rensas, ingen användare sätts, inget fel visas), så man aldrig skickas till `/board` mot sin vilja.
- **`next` är skyddad** (`app-shell/safeNext.ts`): bara interna adresser, inga kontrolltecken (tab/LF/CR strippas av webbläsaren och kan göra `/<tab>/evil.com` till `//evil.com`), och samma origin efter tolkning — annars `/board`.
- **EN guldknapp** (Sign In). Felet landar i en permanent `role=alert`-region (`FormNotices`); båda fälten får `aria-invalid` och `aria-describedby` mot felet och står kvar med sitt innehåll. Serverns felsträng (t.ex. rate-limit-texten) visas som den är.
  Under inloggning är fälten `readOnly` och knappen `aria-disabled` (inte `disabled`) — fokus tappas aldrig, och ett nytt submit ignoreras.
- Etiketterna "Username"/"Password" och knapptexterna "Sign In"/"Signing in…" är kontrakt mot `App.login.test.tsx`.
- **Adresser och flöden** (ADR 006 beslut 1, addendum 2026-10-11): `/login` = Landing + dialogen; `/login?next=<path>` bevarar målet (bara interna adresser, `resolveNextPath`). Skyddad sida utloggad → `RequireAuth` → `/login?next=<path>`.
  Medveten utloggning (AvatarMenu → Log out) → `/` utan dialog och utan `next`. 401 mitt i sessionen → `/login?next=<sidan>` (dialogen öppen; efter inloggning tillbaka dit man var). Testat i `App.login.test.tsx` och `App.logout.test.tsx`.

## useAuth Hook
Provides access to authentication state and methods.

```tsx
const { user, login, logout, loading, isAdmin } = useAuth();
```

## Authentication Flow

Auth går uteslutande mot backenden (egen JWT) — frontend har ingen Supabase-klient och ingen Supabase Auth.

1. **Login:** `AuthProvider.login` → `backendApi.login` → `POST /auth/login`. Backend svarar med JWT + användare, som sparas i `localStorage`
   under `runquest_token` och `runquest_user`.
2. **Återställning vid appstart:** `AuthProvider` läser `runquest_token`/`runquest_user` (`backendApi.isAuthenticated()`, `getCurrentUser()`);
   `loading` är sant tills det är gjort (App.tsx gate:ar på det).
3. **Anrop:** `backendApi.authenticatedRequest` skickar `Authorization: Bearer <token>`. Svarar backenden 401 rensas båda nycklarna och
   `backendApi.onUnauthorized` rensar hela query-cachen och nollställer användaren i `AuthProvider`.
4. **Logout:** `backendApi.logout()` tar bort de två nycklarna; `AuthProvider` rensar hela query-cachen (`queryClient.clear()`, samma som vid login och 401 — inga undantag,
   så att en ny features användardata aldrig glöms bort) och nollställer användaren. `clear()` startar ingen omhämtning; det gör först en observatör som renderas om, så 401 → rensa → omhämtning blir ingen loop.
