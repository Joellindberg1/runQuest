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
const { user, session, login, logout, loading, isAdmin } = useAuth();
```

## Authentication Flow

1. Backend JWT authentication (primary)
2. Supabase auth (fallback)
3. Session persistence via localStorage
