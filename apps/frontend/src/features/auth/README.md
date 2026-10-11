# Auth Feature

Authentication and authorization for the application. Inloggningssidan (`/login`) bor här; sessionshanteringen ligger i `providers/AuthProvider.tsx`.

## Struktur

- **components/LoginScreen** — `/login`, ritad i Landingens språk (glöd, logotyp, hjältekort) med formulärkitets fält. `pages/LoginPage.tsx` är tunn.
- **hooks/useLoginForm** — formulärets tillstånd (egen laddning, ingen global loader: ett fel avmonterar aldrig formuläret)
- `login.css` — mått (`--rq-login-*`) i temafilen, sektion 1.29

## Inloggningssidan

- Ingen prototyp finns; komposition = Landing (logotyp, rubrik "Sign in", "Continue your journey") + Components-filens fält (`shared/components/form/TextField`).
- **EN guldknapp** (Sign In). Felet landar i en permanent `role=alert`-region (`FormNotices`); båda fälten får `aria-invalid` och `aria-describedby` mot felet och står kvar med sitt innehåll.
  Under inloggning är fälten `readOnly` och knappen `aria-disabled` (inte `disabled`) — fokus tappas aldrig, och ett nytt submit ignoreras.
- Etiketterna "Username"/"Password" och knapptexterna "Sign In"/"Signing in…" är kontrakt mot `App.login.test.tsx`.

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
