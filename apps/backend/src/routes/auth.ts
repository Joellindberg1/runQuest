// 🔐 Authentication Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';
import { invalidateXpConfigCache } from '../services/xpConfig.js';
import { groupIdOrRespondEmpty, groupIdOrRespondForbidden } from '../utils/groupScope.js';
import {
  DEFAULT_ADMIN_SETTINGS, MAX_DISPLAYED_TITLES, MULTIPLIER_MAX, MULTIPLIER_MIN, PASSWORD_MIN_LENGTH, compareXpStandings, multiplierProblem,
} from '@runquest/shared';
import type {
  AdminSettingsResponse, AdminSettingsRow, AdminUsersResponse, ChangePasswordResponse, CreateUserResponse, LoginResponse, RecalculateTotalsResponse,
  ResetUserPasswordResponse, StreakMultipliersResponse, UpdateAdminSettingsResponse, UpdateDisplayedTitlesResponse, UpdateStreakMultipliersResponse,
  UsersWithRunsResponse,
} from '@runquest/shared';
import { fail, ok, okWithLegacy } from '../utils/respond.js';
import { BCRYPT_COST, getDummyPasswordHash } from '../utils/passwordHash.js';
import { errorCode } from '../utils/errorCode.js';
import { isUuid } from '../utils/uuid.js';
import { joinGroup } from '../utils/membership.js';
import { rebuildGroupRankingAfterJoin } from '../services/groupRanking.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Login attempt received');
    const { name, email, password } = req.body;
    const nameOrEmail = name || email;

    if (!nameOrEmail || !password) {
      logger.info('❌ Missing name/email or password');
      fail(res, 400, 'Name/email and password required'); return;
    }

    // Inloggningsfältet kan vara en e-postadress — det får inte hamna i loggen.
    logger.info('🔍 Looking up user by name/email');
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    // Find user by email, then by name (e-post vinner). Båda uppslagen görs alltid och samtidigt, så att antalet
    // databasrundturer inte skiljer sig mellan känt och okänt konto. .eq() skickar värdet parametriserat —
    // användarinput får aldrig bli en del av filteruttrycket (PostgREST-injektion).
    const lookupBy = (column: 'email' | 'name') => supabase
      .from('users')
      .select('id, name, email, password_hash, is_admin, group_id')
      .eq(column, nameOrEmail)
      .limit(1);
    const emailLookup = lookupBy('email');
    // Namnuppslaget fångar sitt eget kast så att det inte fäller ett svar som e-postuppslaget redan avgjort.
    const nameLookup = (async () => lookupBy('name'))().then(
      (result) => ({ result, thrown: null as unknown }),
      (thrown: unknown) => ({ result: null, thrown }),
    );
    const [{ data: byEmail, error }, named] = await Promise.all([emailLookup, nameLookup]);

    // Som förut: namnet slås bara upp "efter" en tom e-posträff utan fel. Då blir ett returnerat fel ingen träff och
    // ett kast ett 500 via catch nedan; efter en e-posträff eller ett e-postfel spelar namnuppslaget ingen roll.
    let user = byEmail?.[0] ?? null;
    if (!user && !error) {
      if (named.result === null) throw named.thrown;
      user = named.result.data?.[0] ?? null;
    }

    // bcrypt-arbetet görs i alla fall (okänt konto, databasfel, fel lösenord) så att svarstiden inte avslöjar
    // vilka konton som finns. Mot dummy-hashen kan jämförelsen aldrig lyckas, och `user` styr utfallet.
    const passwordMatch = await bcrypt.compare(password, !error && user ? user.password_hash : await getDummyPasswordHash());

    if (error || !user) {
      logger.info(`❌ User not found or database error (${error ? errorCode(error) : 'no row'})`);
      fail(res, 401, 'Invalid credentials', 'invalid_credentials'); return;
    }

    logger.info(`🔑 User found, password checked for user ${user.id}`);

    if (!passwordMatch) {
      logger.info('❌ Password mismatch');
      fail(res, 401, 'Invalid credentials', 'invalid_credentials'); return;
    }

    logger.info('✅ Password verified, creating JWT token');

    // Create JWT token with proper typing
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    
    if (!jwtSecret) {
      logger.error('❌ JWT_SECRET not configured');
      fail(res, 500, 'Server configuration error'); return;
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin || false,
        group_id: user.group_id ?? null
      },
      jwtSecret,
      { 
        expiresIn: jwtExpiresIn
      } as jwt.SignOptions
    );

    logger.info(`🎉 Login successful for user ${user.id} (Admin: ${user.is_admin})`);

    // Return token and user info. Steg 1 (dubbelsvar): token och user ligger kvar på toppnivå för en klient från före kuvertet, och i data för den nya.
    const login = {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin || false
      }
    };
    okWithLegacy<LoginResponse>(res, login, login);

  } catch (error) {
    logger.error(`❌ Login error (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Password change attempt received');
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user.user_id;

    if (!currentPassword || !newPassword) {
      logger.info('❌ Missing current or new password');
      fail(res, 400, 'Current password and new password required'); return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      logger.info('❌ New password too short');
      fail(res, 400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters long`); return;
    }

    logger.info(`🔍 Looking up user for password change: ${userId}`);
    
    // Get Supabase client and query users table
    const supabase = getSupabaseClient();
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, password_hash')
      .eq('id', userId)
      .single();

    // PGRST116 = .single() fann ingen rad: användaren finns inte (JWT:n är giltig men raden borta), inget serverfel. Varje annat fel är
    // databasen som felar: 500 och en felhändelse med koden, aldrig ett 404 som döljer avbrottet.
    if (error && error.code !== 'PGRST116') {
      logger.error(`❌ Could not read the user for a password change (${errorCode(error)})`);
      fail(res, 500, 'Failed to change password'); return;
    }
    if (!user) {
      logger.info('❌ User not found for password change');
      fail(res, 404, 'User not found'); return;
    }

    logger.info(`🔑 User found, verifying current password for user ${user.id}`);

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      logger.info('❌ Current password is incorrect');
      fail(res, 401, 'Current password is incorrect', 'current_password_incorrect'); return;
    }

    logger.info('✅ Current password verified, hashing new password');

    // Hash new password
    const saltRounds = BCRYPT_COST;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', userId);

    if (updateError) {
      logger.error(`❌ Error updating password (${errorCode(updateError)})`);
      fail(res, 500, 'Failed to update password'); return;
    }

    logger.info(`🎉 Password successfully changed for user ${user.id}`);

    okWithLegacy<ChangePasswordResponse>(res, null, { message: 'Password changed successfully' });

  } catch (error) {
    logger.error(`❌ Password change error (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// GET /api/auth/users - Admin only: Get all users in same group
router.get('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('👥 Admin request to fetch all users');

    // Saknad group_id ger tom data, aldrig alla grupper (ADR 007 A6)
    const groupId = groupIdOrRespondEmpty(req, res);
    if (!groupId) return;

    const supabase = getSupabaseClient();

    // runs(count) ger total_runs — admin-UI:t visade tidigare ett tomt fält
    // eftersom kolumnen aldrig selectades (bugg #12)
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, total_xp, current_level, total_km, current_streak, longest_streak, created_at, runs(count)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error(`❌ Error fetching users (${errorCode(error)})`);
      fail(res, 500, 'Failed to fetch users'); return;
    }

    const usersWithRunCount = (users ?? []).map((u: any) => {
      const { runs, ...rest } = u;
      return { ...rest, total_runs: runs?.[0]?.count ?? 0 };
    });

    logger.info(`✅ Successfully fetched ${usersWithRunCount.length} users`);

    ok<AdminUsersResponse>(res, usersWithRunCount);

  } catch (error) {
    logger.error(`❌ Error fetching users (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// POST /api/auth/users - Admin only: Create new user
router.post('/users', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('👤 Admin request to create new user');

    // Aldrig ett konto utan grupp: en admin utan grupp får 403 innan något annat prövas eller skrivs.
    const groupId = groupIdOrRespondForbidden(req, res);
    if (!groupId) return;

    const { name, email, password } = req.body;

    if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      logger.info('❌ Missing required fields');
      fail(res, 400, 'Name, email, and password are required'); return;
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      logger.info('❌ Password too short');
      fail(res, 400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`); return;
    }

    logger.info('🔍 Creating a new user');
    
    const supabase = getSupabaseClient();
    
    // Check if user already exists. Två parametriserade .eq-frågor (aldrig ett .or() byggt av body-strängar: kommatecken och
    // operatorer i namnet skulle annars ändra filtret). limit(1) i stället för single(), som svarar fel när båda träffar olika rader.
    const [byName, byEmail] = await Promise.all([
      supabase.from('users').select('id').eq('name', name).limit(1),
      supabase.from('users').select('id').eq('email', email).limit(1),
    ]);
    if (byName.error || byEmail.error) {
      // Bara felkoden: PostgREST-meddelandet kan bära radvärden och går via Sentry-kopplingen vidare som log_detail.
      logger.error(`❌ Error checking for existing user (${errorCode(byName.error ?? byEmail.error)})`);
      fail(res, 500, 'Internal server error'); return;
    }

    if ((byName.data?.length ?? 0) > 0 || (byEmail.data?.length ?? 0) > 0) {
      logger.info('❌ User already exists');
      fail(res, 409, 'User with this name or email already exists', 'user_exists'); return;
    }

    // Hash password
    const saltRounds = BCRYPT_COST;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user. Gruppen sätts inte här: join_group ger medlemskapet och sätter pekaren users.group_id (ADR 012 beslut 2.2).
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name,
        email,
        password_hash: passwordHash,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        longest_streak: 0,
        total_km: 0.0
      })
      .select('id, name, email, total_xp, current_level, current_streak, created_at')
      .single();

    if (error) {
      logger.error(`❌ Error creating user (${errorCode(error)})`);
      fail(res, 500, 'Failed to create user'); return;
    }

    // Medlemskapet i adminens grupp (rollen member; första medlemskapet räknar hela historiken). Misslyckas det tas kontot bort igen:
    // supabase-js har inga flerstegstransaktioner, och ett konto utan grupp får aldrig bli kvar (F2, ADR 007 A6).
    // Misslyckas även borttagningen blir kontot kvar utan group_id och utan rad i group_members; loggen har då båda felkoderna och användar-id:t.
    // Manuell städning (Lead/ägaren, prod-radering kräver ägarens ja): verifiera i läsfråga att id:t saknar aktivt medlemskap och group_id
    // (`select id from users u where u.id = '<id>' and u.group_id is null and not exists (select 1 from group_members m where m.user_id = u.id)`),
    // radera sedan exakt den raden (`delete from users where id = '<id>'`; inget annat följer med, kontot har inga rundor eller medlemskap).
    try {
      await joinGroup({ userId: newUser.id, groupId, role: 'member' }, supabase);
    } catch (joinError) {
      const { error: cleanupError } = await supabase.from('users').delete().eq('id', newUser.id);
      logger.error(`❌ Error adding new user ${newUser.id} to the group (${errorCode(joinError)})${cleanupError ? `; the user could not be removed again (${errorCode(cleanupError)})` : ''}`);
      fail(res, 500, 'Failed to create user'); return;
    }

    // Gruppens ranking byggs om efter en lyckad join (ADR 012 beslut 2.4), utan titelnyheter. Ett fel fäller inte kontot: medlemskapet är sparat.
    await rebuildGroupRankingAfterJoin(groupId, supabase);

    logger.info(`🎉 Successfully created user ${newUser.id}`);

    ok<CreateUserResponse>(res, newUser);

  } catch (error) {
    logger.error(`❌ Error creating user (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// PUT /api/auth/users/:id/password - Admin only: Reset user password
router.put('/users/:id/password', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('🔐 Admin request to reset user password');

    // Admin utan grupp får inte röra något (403), före bodyvalideringen som i POST /users. Målet måste ligga i adminens grupp;
    // annars svarar vi 404 som för ett id som saknas, så att svaret inte avslöjar att användaren finns i en annan grupp.
    const groupId = groupIdOrRespondForbidden(req, res);
    if (!groupId) return;

    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      logger.info('❌ Missing new password');
      fail(res, 400, 'New password is required'); return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      logger.info('❌ New password too short');
      fail(res, 400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters long`); return;
    }

    // Ett id som inte är ett uuid kan inte finnas: samma 404 som för en saknad rad, före frågan (annars svarar databasen 22P02 och det blir ett 500).
    if (!isUuid(id)) {
      logger.info('❌ User not found (id is not a uuid)');
      fail(res, 404, 'User not found'); return;
    }

    logger.info(`🔍 Resetting password for user ID: ${id}`);

    const supabase = getSupabaseClient();

    // Verify user exists in the admin's group
    // maybeSingle: en saknad rad (eller en i en annan grupp) är null utan fel (404 nedan), medan ett databasfel är ett serverfel (500).
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .eq('group_id', groupId)
      .maybeSingle();

    if (findError) {
      logger.error(`❌ Error looking up the user for a password reset (${errorCode(findError)})`);
      fail(res, 500, 'Failed to look up the user'); return;
    }

    if (!user) {
      logger.info('❌ User not found');
      fail(res, 404, 'User not found'); return;
    }

    logger.info(`✅ User ${user.id} found, hashing new password`);

    // Hash new password
    const saltRounds = BCRYPT_COST;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    // Filtret på grupp sitter även här: målet kan ha bytt grupp sedan uppslaget. select('id') visar hur många rader som uppdaterades;
    // noll rader (flyttad eller borttagen under tiden) är ett 404 som för ett id som saknas, aldrig ett falskt "Password reset successfully".
    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', id)
      .eq('group_id', groupId)
      .select('id');

    if (updateError) {
      logger.error(`❌ Error updating password (${errorCode(updateError)})`);
      fail(res, 500, 'Failed to update password'); return;
    }

    if (!updated?.length) {
      logger.info('❌ User not found when updating the password (moved or removed since the lookup)');
      fail(res, 404, 'User not found'); return;
    }

    logger.info(`🎉 Password successfully reset for user ${user.id}`);

    okWithLegacy<ResetUserPasswordResponse>(res, null, { message: 'Password reset successfully' });

  } catch (error) {
    logger.error(`❌ Password reset error (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

/**
 * POST /api/auth/recalculate-totals
 * Recalculate user totals and trigger title system
 */
router.post('/recalculate-totals', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user!.user_id;
    logger.info(`🔄 Recalculating totals for user ${userId}...`);
    
    const { calculateUserTotals } = await import('../utils/calculateUserTotals.js');
    await calculateUserTotals(userId);
    
    const recalculated = { userId, timestamp: new Date().toISOString() };
    okWithLegacy<RecalculateTotalsResponse>(res, recalculated, { message: 'User totals recalculated successfully', ...recalculated });
  } catch (error) {
    logger.error(`❌ Error recalculating user totals (${errorCode(error)})`);
    // Aldrig error.message i svaret: det kan bära databasvärden. Detaljerna finns i loggen som felkod.
    fail(res, 500, 'Failed to recalculate user totals');
  }
});

function validateMultipliers(input: unknown): string | null {
  if (!Array.isArray(input) || input.length === 0) return 'multipliers must be a non-empty array';
  const seen = new Set<number>();
  for (const step of input) {
    const days = (step as { days?: unknown })?.days;
    const multiplier = (step as { multiplier?: unknown })?.multiplier;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) return 'days must be a whole number of at least 1';
    // Kolumnen är numeric(3,2): över 9.99 ger överflöd, fler decimaler avrundas tyst.
    const problem = multiplierProblem(multiplier);
    if (problem === 'range') return `multiplier must be a number between ${MULTIPLIER_MIN} and ${MULTIPLIER_MAX}`;
    if (problem === 'decimals') return 'multiplier can have at most two decimals';
    if (seen.has(days)) return `days ${days} appears more than once`;
    seen.add(days);
  }
  return null;
}

// admin_settings har EN rad med uuid-id och ingen streak_multipliers-kolumn (multiplikatorerna bor i egen tabell, ADR 004).
// Svaret byggs fält för fält så att admin_password_hash aldrig kan följa med.
const ADMIN_SETTINGS_COLUMNS = 'id, base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance, updated_at';

function toAdminSettingsResponse(row: AdminSettingsRow): AdminSettingsRow {
  return {
    id: row.id,
    base_xp: row.base_xp,
    xp_per_km: row.xp_per_km,
    bonus_5km: row.bonus_5km,
    bonus_10km: row.bonus_10km,
    bonus_15km: row.bonus_15km,
    bonus_20km: row.bonus_20km,
    min_run_distance: row.min_run_distance,
    updated_at: row.updated_at,
  };
}

// GET /api/auth/admin-settings - Get admin settings
router.get('/admin-settings', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    logger.info('🔍 Admin: Fetching admin settings...');

    const supabase = getSupabaseClient();
    const { data: settings, error } = await supabase
      .from('admin_settings')
      .select(ADMIN_SETTINGS_COLUMNS)
      .limit(1)
      .single();

    if (error || !settings) {
      logger.error(`❌ Failed to fetch admin settings (${errorCode(error)})`);
      fail(res, 500, 'Failed to fetch admin settings'); return;
    }

    logger.info('✅ Admin settings fetched successfully');
    ok<AdminSettingsResponse>(res, toAdminSettingsResponse(settings));
    
  } catch (error) {
    logger.error(`❌ Error fetching admin settings (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch admin settings'); return;
  }
});

// PUT /api/auth/admin-settings - Update admin settings
router.put('/admin-settings', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('💾 Admin: Updating admin settings...');
    const { 
      base_xp, 
      xp_per_km, 
      bonus_5km, 
      bonus_10km, 
      bonus_15km, 
      bonus_20km, 
      min_run_distance 
    } = req.body;
    
    // Validate required fields
    if (base_xp === undefined || xp_per_km === undefined) {
      fail(res, 400, 'base_xp and xp_per_km are required'); return;
    }
    
    const supabase = getSupabaseClient();

    const { data: current, error: findError } = await supabase
      .from('admin_settings')
      .select('id')
      .limit(1)
      .single();
    if (findError || !current) {
      logger.error(`❌ Failed to find admin settings row (${errorCode(findError)})`);
      fail(res, 500, 'Failed to update admin settings'); return;
    }

    const { data: updatedSettings, error } = await supabase
      .from('admin_settings')
      .update({
        base_xp,
        xp_per_km,
        bonus_5km: bonus_5km ?? DEFAULT_ADMIN_SETTINGS.bonus_5km,
        bonus_10km: bonus_10km ?? DEFAULT_ADMIN_SETTINGS.bonus_10km,
        bonus_15km: bonus_15km ?? DEFAULT_ADMIN_SETTINGS.bonus_15km,
        bonus_20km: bonus_20km ?? DEFAULT_ADMIN_SETTINGS.bonus_20km,
        min_run_distance: min_run_distance ?? DEFAULT_ADMIN_SETTINGS.min_run_distance,
        updated_at: new Date().toISOString()
      })
      .eq('id', current.id)
      .select(ADMIN_SETTINGS_COLUMNS)
      .single();

    if (error || !updatedSettings) {
      invalidateXpConfigCache(); // släng cachen oavsett utfall — raden kan ha ändrats
      logger.error(`❌ Failed to update admin settings (${errorCode(error)})`);
      fail(res, 500, 'Failed to update admin settings'); return;
    }
    
    invalidateXpConfigCache();
    logger.info('✅ Admin settings updated successfully');
    okWithLegacy<UpdateAdminSettingsResponse>(res, toAdminSettingsResponse(updatedSettings), { message: 'Admin settings updated successfully' });
    
  } catch (error) {
    logger.error(`❌ Error updating admin settings (${errorCode(error)})`);
    fail(res, 500, 'Failed to update admin settings'); return;
  }
});

// GET /api/auth/streak-multipliers - Get streak multipliers
router.get('/streak-multipliers', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    logger.info('🔍 Admin: Fetching streak multipliers...');
    
    const supabase = getSupabaseClient();
    const { data: multipliers, error } = await supabase
      .from('streak_multipliers')
      .select('id, days, multiplier')
      .order('days');
    
    if (error) {
      logger.error(`❌ Failed to fetch streak multipliers (${errorCode(error)})`);
      fail(res, 500, 'Failed to fetch streak multipliers'); return;
    }
    
    logger.info('✅ Streak multipliers fetched successfully');
    ok<StreakMultipliersResponse>(res, multipliers);
    
  } catch (error) {
    logger.error(`❌ Error fetching streak multipliers (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch streak multipliers'); return;
  }
});

// PUT /api/auth/streak-multipliers - Update streak multipliers
router.put('/streak-multipliers', authenticateJWT, requireAdmin, async (req, res): Promise<void> => {
  try {
    logger.info('💾 Admin: Updating streak multipliers...');
    const { multipliers } = req.body;
    
    const invalid = validateMultipliers(multipliers);
    if (invalid) {
      fail(res, 400, invalid); return;
    }
    const ladder = (multipliers as Array<{ days: number; multiplier: number }>).map(({ days, multiplier }) => ({ days, multiplier }));

    const supabase = getSupabaseClient();

    // Upsert först (unik nyckel på days), borttagning sist: avbryts flödet finns alltid en trappa kvar —
    // gammal orörd om upserten felar, gammal+ny om borttagningen felar. Aldrig tom (= ingen streakbonus).
    const { data: insertedMultipliers, error } = await supabase
      .from('streak_multipliers')
      .upsert(ladder, { onConflict: 'days' })
      .select('id, days, multiplier');

    if (error) {
      invalidateXpConfigCache();
      logger.error(`❌ Failed to update streak multipliers (${errorCode(error)})`);
      fail(res, 500, 'Failed to update streak multipliers'); return;
    }

    const { error: pruneError } = await supabase
      .from('streak_multipliers')
      .delete()
      .not('days', 'in', `(${ladder.map((step) => step.days).join(',')})`);

    invalidateXpConfigCache();
    if (pruneError) {
      logger.error(`❌ Failed to remove old streak multipliers (new steps were saved) (${errorCode(pruneError)})`);
      fail(res, 500, 'Saved the new steps but could not remove old ones — try saving again'); return;
    }

    logger.info('✅ Streak multipliers updated successfully');
    okWithLegacy<UpdateStreakMultipliersResponse>(res, insertedMultipliers, { message: 'Streak multipliers updated successfully' });
    
  } catch (error) {
    logger.error(`❌ Error updating streak multipliers (${errorCode(error)})`);
    fail(res, 500, 'Failed to update streak multipliers'); return;
  }
});

// PUT /api/auth/me/displayed-titles - Update current user's displayed title IDs
router.put('/me/displayed-titles', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { title_ids } = req.body;

    if (!Array.isArray(title_ids) || title_ids.length > MAX_DISPLAYED_TITLES) {
      fail(res, 400, `title_ids must be an array of up to ${MAX_DISPLAYED_TITLES} IDs`); return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({ displayed_title_ids: title_ids })
      .eq('id', userId);

    if (error) {
      logger.error(`❌ Error updating displayed titles (${errorCode(error)})`);
      fail(res, 500, 'Failed to update displayed titles'); return;
    }

    logger.info(`✅ Updated displayed titles for user ${userId} (${title_ids.length} selected)`);
    ok<UpdateDisplayedTitlesResponse>(res, null);
  } catch (error) {
    logger.error(`❌ Error updating displayed titles (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// GET /api/auth/users-with-runs - Get all users in same group with their runs
router.get('/users-with-runs', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('👥 Fetching users with runs');

    // Saknad group_id ger tom data, aldrig alla grupper (ADR 007 A6)
    const groupId = groupIdOrRespondEmpty(req, res);
    if (!groupId) return;

    const supabase = getSupabaseClient();

    const { data: usersWithRuns, error } = await supabase
      .from('users')
      .select(`
        id, name, total_xp, current_level, total_km,
        current_streak, longest_streak, profile_picture,
        wins, draws, losses, challenge_active, displayed_title_ids, gender,
        runs(id, user_id, date, distance, xp_gained, multiplier,
             streak_day, base_xp, km_xp, distance_bonus, streak_bonus, is_treadmill,
             start_time, created_at, source)
      `)
      .eq('group_id', groupId);

    if (error) {
      logger.error(`❌ Error fetching users with runs (${errorCode(error)})`);
      fail(res, 500, 'Failed to fetch users'); return;
    }

    // Boardens All-time-ordning = rank_passed-komparatorn (ADR 011 beslut 6): xp fallande, namn (skiftlägesokänsligt), id. Sorteras i TS
    // med den delade komparatorn: PostgREST:s order på name är skiftlägeskänsligt och en ensam total_xp-sortering ger lika XP i godtycklig ordning.
    usersWithRuns?.sort((a: any, b: any) =>
      compareXpStandings({ id: a.id, name: a.name, xp: a.total_xp ?? 0 }, { id: b.id, name: b.name, xp: b.total_xp ?? 0 }));

    // Count unsent tokens per tier per user (= challenges available to send)
    const userIds = (usersWithRuns ?? []).map((u: any) => u.id);
    const challengeCounts: Record<string, { minor: number; major: number; legendary: number }> = {};
    if (userIds.length > 0) {
      const { data: unsentTokens } = await supabase
        .from('user_challenge_tokens')
        .select('user_id, tier')
        .is('sent_at', null)
        .in('user_id', userIds);

      for (const t of unsentTokens ?? []) {
        const tier = t.tier as 'minor' | 'major' | 'legendary';
        if (!challengeCounts[t.user_id]) challengeCounts[t.user_id] = { minor: 0, major: 0, legendary: 0 };
        challengeCounts[t.user_id][tier]++;
      }
    }

    const data = (usersWithRuns ?? []).map((u: any) => ({
      ...u,
      challenge_counts: challengeCounts[u.id] ?? { minor: 0, major: 0, legendary: 0 },
    }));

    logger.info(`✅ Successfully fetched ${data.length} users with runs`);

    ok<UsersWithRunsResponse>(res, data);

  } catch (error) {
    logger.error(`❌ Error fetching users with runs (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

export default router;
