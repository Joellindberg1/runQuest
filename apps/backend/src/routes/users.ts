// 👤 User Routes — profilbild m.m. Skrivningar mot users/storage går via
// backend (service role); frontend har ingen skrivåtkomst i RLS.
import express from 'express';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { errorCode } from '../utils/errorCode.js';
import { PROFILE_PICTURE_EXTENSIONS, PROFILE_PICTURE_MAX_BYTES } from '@runquest/shared';
import type { UploadProfilePictureResponse } from '@runquest/shared';
import { fail, ok } from '../utils/respond.js';

const router = express.Router();

// POST /api/users/profile-picture — rå bilddata i body, Content-Type avgör format
router.post(
  '/profile-picture',
  authenticateJWT,
  express.raw({ type: 'image/*', limit: PROFILE_PICTURE_MAX_BYTES }),
  async (req, res): Promise<void> => {
    try {
      const userId = req.user!.user_id;
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const ext = PROFILE_PICTURE_EXTENSIONS[contentType];

      if (!ext) {
        fail(res, 400, 'Only jpeg, png, webp or gif images are allowed');
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        fail(res, 400, 'Empty image body');
        return;
      }

      const supabase = getSupabaseClient();
      const fileName = `${userId}-${Date.now()}.${ext}`;

      const { data: userRow } = await supabase
        .from('users')
        .select('profile_picture')
        .eq('id', userId)
        .single();
      const oldFileName: string | undefined = userRow?.profile_picture?.split('/').pop();

      const { error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, req.body, { contentType, cacheControl: '3600', upsert: true });

      if (uploadError) {
        logger.error(`❌ Profile picture upload failed (${errorCode(uploadError)})`);
        fail(res, 500, 'Failed to upload profile picture');
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('profile-pictures')
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_picture: publicUrlData.publicUrl })
        .eq('id', userId);

      if (updateError) {
        logger.error(`❌ Profile picture user update failed (${errorCode(updateError)})`);
        fail(res, 500, 'Failed to update profile picture');
        return;
      }

      if (oldFileName && oldFileName !== fileName) {
        await supabase.storage.from('profile-pictures').remove([oldFileName]);
      }

      logger.info(`🖼️ Profile picture updated for user ${userId}`);
      ok<UploadProfilePictureResponse>(res, { profile_picture: publicUrlData.publicUrl });
    } catch (error) {
      logger.error(`❌ Profile picture error (${errorCode(error)})`);
      fail(res, 500, 'Failed to upload profile picture');
    }
  }
);

// Fel från body-parsern (för stor bild) tas av den centrala felhanteraren i createApp() (jsonErrorHandler): 413 payload_too_large.

export default router;
