// 👤 User Routes — profilbild m.m. Skrivningar mot users/storage går via
// backend (service role); frontend har ingen skrivåtkomst i RLS.
import express, { type NextFunction, type Request, type Response } from 'express';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { errorCode } from '../utils/errorCode.js';
import { PROFILE_PICTURE_EXTENSIONS, PROFILE_PICTURE_MAX_BYTES } from '@runquest/shared';

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
        logger.error(`❌ Profile picture upload failed (${errorCode(uploadError)})`);
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
        logger.error(`❌ Profile picture user update failed (${errorCode(updateError)})`);
        res.status(500).json({ error: 'Failed to update profile picture' });
        return;
      }

      if (oldFileName && oldFileName !== fileName) {
        await supabase.storage.from('profile-pictures').remove([oldFileName]);
      }

      logger.info(`🖼️ Profile picture updated for user ${userId}`);
      res.json({ success: true, data: { profile_picture: publicUrlData.publicUrl } });
    } catch (error) {
      logger.error(`❌ Profile picture error (${errorCode(error)})`);
      res.status(500).json({ error: 'Failed to upload profile picture' });
    }
  }
);

// Fel från body-parsern (för stor bild) som JSON i ADR 007-formen i stället för Express HTML-felsida (som väntelistan).
router.use((err: { type?: string }, _req: Request, res: Response, next: NextFunction): void => {
  if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large' }); return; }
  next(err);
});

export default router;
