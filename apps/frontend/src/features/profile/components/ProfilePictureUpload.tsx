import React from 'react';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Upload, User } from 'lucide-react';
import { useProfilePictureUpload } from '../hooks/useProfilePictureUpload';

interface ProfilePictureUploadProps {
  onUploadComplete?: () => void;
}

export const ProfilePictureUpload: React.FC<ProfilePictureUploadProps> = ({ onUploadComplete }) => {
  const { upload, uploading } = useProfilePictureUpload(onUploadComplete);

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
          onChange={upload}
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
