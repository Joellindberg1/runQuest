
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Upload, User } from 'lucide-react';

interface ProfilePictureUploadProps {
  onUploadComplete?: () => void;
}

export const ProfilePictureUpload: React.FC<ProfilePictureUploadProps> = ({ onUploadComplete }) => {
  const [uploading, setUploading] = useState(false);
  const { user } = useAuth();

  const uploadProfilePicture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('You must select an image to upload.');
      }

      const file = event.target.files[0];
      
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File size must be less than 5MB');
      }

      // Check file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      console.log('Uploading file:', fileName);

      // Delete old profile picture if it exists
      if (user?.profile_picture) {
        const oldFileName = user.profile_picture.split('/').pop();
        if (oldFileName && oldFileName !== fileName) {
          await supabase.storage
            .from('profile-pictures')
            .remove([oldFileName]);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data } = supabase.storage
        .from('profile-pictures')
        .getPublicUrl(filePath);

      console.log('File uploaded, updating user profile...');
      console.log('Public URL:', data.publicUrl);

      // Update user's profile_picture in the database
      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_picture: data.publicUrl })
        .eq('id', user?.id);

      if (updateError) {
        throw updateError;
      }

      toast.success('Profile picture updated successfully!');
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error: any) {
      console.error('Error uploading profile picture:', error);
      toast.error(error.message || 'Error uploading profile picture');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="profile-picture" className="flex items-center gap-2">
          <User className="w-4 h-4" />
          Upload Profile Picture
        </Label>
        <Input
          id="profile-picture"
          type="file"
          accept="image/*"
          onChange={uploadProfilePicture}
          disabled={uploading}
          className="mt-2"
        />
        <p className="text-xs text-gray-500 mt-1">
          Max file size: 5MB. Supported formats: JPG, PNG, GIF
        </p>
      </div>
      {uploading && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Upload className="w-4 h-4 animate-spin" />
          Uploading...
        </div>
      )}
    </div>
  );
};
