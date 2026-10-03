// 👤 User Routes — profilbild m.m. Skrivningar mot users/storage går via
// backend (service role); frontend har ingen skrivåtkomst i RLS.
import express from 'express';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — samma gräns som frontend visar
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// POST /api/users/profile-picture — rå bilddata i body, Content-Type avgör format
router.post(
  '/profile-picture',
  authenticateJWT,
  express.raw({ type: 'image/*', limit: MAX_FILE_SIZE }),
  async (req, res): Promise<void> => {
    try {
      const userId = req.user!.user_id;
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const ext = ALLOWED_IMAGE_TYPES[contentType];

      if (!ext) {
        res.status(400).json({ error: 'Only jpeg, png, webp or gif images are allowed' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Empty image body' });
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
        logger.error('❌ Profile picture upload failed:', uploadError.message);
        res.status(500).json({ error: 'Failed to upload profile picture' });
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
        logger.error('❌ Profile picture user update failed:', updateError.message);
        res.status(500).json({ error: 'Failed to update profile picture' });
        return;
      }

      if (oldFileName && oldFileName !== fileName) {
        await supabase.storage.from('profile-pictures').remove([oldFileName]);
      }

      logger.info(`🖼️ Profile picture updated for user ${userId}`);
      res.json({ success: true, data: { profile_picture: publicUrlData.publicUrl } });
    } catch (error) {
      logger.error('❌ Profile picture error:', error);
      res.status(500).json({ error: 'Failed to upload profile picture' });
    }
  }
);

export default router;
