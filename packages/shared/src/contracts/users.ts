// Användare: GET /api/auth/users-with-runs, adminvyn (GET/POST /api/auth/users, PUT /api/auth/users/:id/password),
// PUT /api/auth/me/displayed-titles och POST /api/users/profile-picture. Fältstil snake_case, utom admin-lösenorden (camelCase, som routen läser dem).
// Endast typer. Äldre endpoints behåller sin form (ADR 007 A2).
import type { ApiSuccess } from './common.js';
import type { RunRow } from './runs.js';

/** Antal osända utmaningstokens per nivå (user_challenge_tokens utan sent_at). */
export interface UserChallengeCounts {
  minor?: number;
  major?: number;
  legendary?: number;
}

/**
 * En gruppmedlem med sina rundor, som GET /api/auth/users-with-runs skickar den (sorterad på total_xp, fallande).
 * Delas av backend och klient; `User` i @runquest/types är samma typ.
 */
export interface UserWithRuns {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  profile_picture?: string;
  group_id?: string;
  runs?: RunRow[];
  wins?: number;
  draws?: number;
  losses?: number;
  challenge_active?: boolean;
  challenge_counts?: UserChallengeCounts;
  displayed_title_ids?: string[];
  gender?: string | null;
}

/** Svar för GET /api/auth/users-with-runs. Saknad group_id ger tom lista (ADR 007 A6). */
export type UsersWithRunsResponse = ApiSuccess<UserWithRuns[]>;

/** En medlem i adminvyn (GET /api/auth/users, bara admin, bara adminens grupp). `total_runs` är antalet rundor. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  created_at: string;
  total_runs: number;
}

/** Svar för GET /api/auth/users. */
export type AdminUsersResponse = ApiSuccess<AdminUser[]>;

/** Brödtext till POST /api/auth/users (admin): ett nytt konto i adminens grupp. */
export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
}

/** Det POST /api/auth/users svarar med om kontot: bara de sju kolumnerna, utan `total_km`, `longest_streak` och `total_runs`. */
export interface CreatedUser {
  id: string;
  name: string;
  email: string;
  total_xp: number;
  current_level: number;
  current_streak: number;
  created_at: string;
}

/** Svar för POST /api/auth/users. */
export type CreateUserResponse = ApiSuccess<CreatedUser>;

/** Brödtext till PUT /api/auth/users/:id/password (admin). */
export interface ResetUserPasswordRequest {
  newPassword: string;
}

/** Svar för PUT /api/auth/users/:id/password. */
export interface ResetUserPasswordResponse {
  success: true;
  message: string;
}

/** Brödtext till PUT /api/auth/me/displayed-titles: de titlar användaren visar (högst MAX_DISPLAYED_TITLES). */
export interface UpdateDisplayedTitlesRequest {
  title_ids: string[];
}

/** Svar för PUT /api/auth/me/displayed-titles. */
export interface UpdateDisplayedTitlesResponse {
  success: true;
}

/** Svar för POST /api/users/profile-picture: den publika adressen till den nya bilden. Brödtexten är själva bilden (Content-Type avgör formatet). */
export type UploadProfilePictureResponse = ApiSuccess<{ profile_picture: string }>;
