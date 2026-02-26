import { useState } from 'react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { useAuth } from '@/features/auth';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function useProfilePictureUpload(onUploadComplete?: () => void) {
  const [uploading, setUploading] = useState(false);
  const { user } = useAuth();

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

      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}-${Date.now()}.${fileExt}`;

      if (user?.profile_picture) {
        const oldFileName = user.profile_picture.split('/').pop();
        if (oldFileName && oldFileName !== fileName) {
          await supabase.storage.from('profile-pictures').remove([oldFileName]);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, file, { cacheControl: '3600', upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('profile-pictures').getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_picture: data.publicUrl })
        .eq('id', user?.id);

      if (updateError) throw updateError;

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
