import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { LOG_QUERY_KEYS } from '@/features/log/hooks/useLogQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { log } from '@/shared/utils/logger';
import { validatePicture } from '../profileModel';

export interface PictureNotice {
  tone: 'ok' | 'error';
  text: string;
}

/** Där en profilbild syns i appen: gruppens användare, leaderboard, historiken, utmaningarna och head-to-head. */
const PICTURE_KEYS = [USERS_WITH_RUNS_QUERY_KEY, ['leaderboard'], LOG_QUERY_KEYS.history, ['challenges'], HEAD_TO_HEAD_ROOT] as const;

/**
 * Ladda upp en profilbild (POST /users/profile-picture; uppladdning och users-uppdatering sker i backend med service role).
 * Valet valideras först (bild, högst 5 MB) — ett nej gör inget anrop. Meddelandet (`notice`) visas i en permanent live-region
 * på skärmen (statusregion i stället för toast).
 */
export function useProfilePictureUpload() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<PictureNotice | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const res = await backendApi.uploadProfilePicture(file);
      if (!res.success) throw new Error(res.error || 'Error uploading the profile picture');
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all(PICTURE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });

  const upload = async (file: File | undefined) => {
    const problem = validatePicture(file);
    if (problem || !file) {
      setNotice({ tone: 'error', text: problem ?? 'Choose an image to upload' });
      return;
    }
    setNotice(null);
    try {
      await mutation.mutateAsync(file);
      setNotice({ tone: 'ok', text: 'Profile picture updated' });
    } catch (error) {
      log.error('Error uploading profile picture', error);
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Error uploading the profile picture' });
    }
  };

  return { upload, uploading: mutation.isPending, notice };
}
