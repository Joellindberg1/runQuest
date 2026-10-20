// Inloggning, lösenord och adminens XP-inställningar: POST /api/auth/login, POST /api/auth/change-password, POST /api/auth/recalculate-totals,
// GET/PUT /api/auth/admin-settings och GET/PUT /api/auth/streak-multipliers. Endast typer.
// Äldre endpoints behåller sin form (ADR 007 A2): kuvertet är { success, data } för listorna och { success, message } för kvittenserna.
import type { AdminSettings, StreakMultiplier } from '../xpCalculation.js';
import type { ApiSuccess } from './common.js';

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

/** Svar från POST /api/auth/login. Fel (400/401/500) är `{ error }`. */
export interface LoginResponse {
  success: true;
  token: string;
  user: LoginUser;
}

/** Brödtext till POST /api/auth/change-password. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Svar från POST /api/auth/change-password. */
export interface ChangePasswordResponse {
  success: true;
  message: string;
}

/** Svar från POST /api/auth/recalculate-totals: anroparens egna summor omräknade. Misslyckas det är svaret `ApiFailure` (500). */
export interface RecalculateTotalsResponse {
  success: true;
  message: string;
  userId: string;
  timestamp: string;
}

/** admin_settings-raden som GET/PUT /api/auth/admin-settings skickar: de sju värdena plus radens id och ändringstid. Aldrig lösenordshashen. */
export interface AdminSettingsRow extends AdminSettings {
  id: string;
  updated_at: string;
}

/** Svar för GET /api/auth/admin-settings. */
export type AdminSettingsResponse = ApiSuccess<AdminSettingsRow>;

/** Brödtext till PUT /api/auth/admin-settings: `base_xp` och `xp_per_km` krävs, de andra faller tillbaka på standardvärdena. */
export type UpdateAdminSettingsRequest = AdminSettings;

/** Svar för PUT /api/auth/admin-settings: raden efter ändringen. */
export interface UpdateAdminSettingsResponse extends ApiSuccess<AdminSettingsRow> {
  message: string;
}

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

/** Svar för PUT /api/auth/streak-multipliers: trappan efter ändringen. */
export interface UpdateStreakMultipliersResponse extends ApiSuccess<StreakMultiplierRow[]> {
  message: string;
}
