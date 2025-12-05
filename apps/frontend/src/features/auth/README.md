# Auth Feature

Authentication and authorization for the application.

## Structure

- **pages/** - Login page
- **index.ts** - Public API exports

## Components

### useAuth Hook
Provides access to authentication state and methods.

```tsx
const { user, session, login, logout, loading, isAdmin } = useAuth();
```

## Authentication Flow

1. Backend JWT authentication (primary)
2. Supabase auth (fallback)
3. Session persistence via localStorage

## Usage

```tsx
import { useAuth } from '@/features/auth';

const { user, login, logout } = useAuth();
```
