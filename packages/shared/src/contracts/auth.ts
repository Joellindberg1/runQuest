// Inloggning, lösenord och adminens XP-inställningar: POST /api/auth/login, POST /api/auth/change-password, POST /api/auth/recalculate-totals,
// GET/PUT /api/auth/admin-settings och GET/PUT /api/auth/streak-multipliers. Endast typer.
// Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20): varje svar är { success, data }, och de gamla toppnivånycklarna (token, user, message ...) finns kvar bredvid `data`
// i ett dubbelsvar (DualEnvelope) tills steg 2 (RUN-364) tar bort dem.
import type { AdminSettings, StreakMultiplier } from '../xpCalculation.js';
import type { ApiSuccess, DualEnvelope } from './common.js';

/** Brödtext till POST /api/auth/login: `name` eller `email` (servern provar e-posten först, sedan namnet) och `password`. */
export interface LoginRequest {
  name?: string;
  email?: string;
  password: string;
}

/** Användaren i inloggningssvaret. Klienten sparar den i sessionen (localStorage) tillsammans med token. */
export interface LoginUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

/** Svar från POST /api/auth/login: `{ success, token, user, data: { token, user } }`. Fel (400/401/500) är `ApiError`; 401 har alltid koden `invalid_credentials`. */
export type LoginResponse = DualEnvelope<{ token: string; user: LoginUser }>;

/** Brödtext till POST /api/auth/change-password. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Svar från POST /api/auth/change-password: `{ success, message, data: null }`. Fel nuvarande lösenord är 401 med koden `current_password_incorrect` (loggar inte ut sessionen). */
export type ChangePasswordResponse = DualEnvelope<{ message: string }, null>;

/** Svar från POST /api/auth/recalculate-totals: anroparens egna summor omräknade. Misslyckas det är svaret `ApiError` (500). */
export type RecalculateTotalsResponse = DualEnvelope<{ message: string; userId: string; timestamp: string }, { userId: string; timestamp: string }>;

/** admin_settings-raden som GET/PUT /api/auth/admin-settings skickar: de sju värdena plus radens id och ändringstid. Aldrig lösenordshashen. */
export interface AdminSettingsRow extends AdminSettings {
  id: string;
  updated_at: string;
}

/** Svar för GET /api/auth/admin-settings. */
export type AdminSettingsResponse = ApiSuccess<AdminSettingsRow>;

/** Brödtext till PUT /api/auth/admin-settings: `base_xp` och `xp_per_km` krävs, de andra faller tillbaka på standardvärdena. */
export type UpdateAdminSettingsRequest = AdminSettings;

/** Svar för PUT /api/auth/admin-settings: raden efter ändringen (`data`), och serverns text (`message`, kvar under dubbelsvarsfönstret). */
export type UpdateAdminSettingsResponse = DualEnvelope<{ message: string }, AdminSettingsRow>;

/** Ett trappsteg ur streak_multipliers som servern skickar: `days` och `multiplier` plus radens id. */
export interface StreakMultiplierRow extends StreakMultiplier {
  id: string;
}

/** Svar för GET /api/auth/streak-multipliers (stigande på days). */
export type StreakMultipliersResponse = ApiSuccess<StreakMultiplierRow[]>;

/** Brödtext till PUT /api/auth/streak-multipliers: hela trappan. Steg som saknas tas bort av servern. */
export interface UpdateStreakMultipliersRequest {
  multipliers: StreakMultiplier[];
}

/** Svar för PUT /api/auth/streak-multipliers: trappan efter ändringen (`data`), och serverns text (`message`, kvar under dubbelsvarsfönstret). */
export type UpdateStreakMultipliersResponse = DualEnvelope<{ message: string }, StreakMultiplierRow[]>;
