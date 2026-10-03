import { useState } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function useProfilePictureUpload(onUploadComplete?: () => void) {
  const [uploading, setUploading] = useState(false);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('You must select an image to upload.');
      }

      const file = event.target.files[0];

      if (file.size > MAX_FILE_SIZE) {
        throw new Error('File size must be less than 5MB');
      }

      if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }

      // Uppladdning + users-uppdatering sker i backend (service role) —
      // frontend har ingen skrivåtkomst mot storage/users i RLS.
      const result = await backendApi.uploadProfilePicture(file);

      if (!result.success) {
        throw new Error(result.error || 'Error uploading profile picture');
      }

      toast.success('Profile picture updated successfully!');
      onUploadComplete?.();
    } catch (error) {
      log.error('Error uploading profile picture', error);
      const errorMessage = error instanceof Error ? error.message : 'Error uploading profile picture';
      toast.error(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}
