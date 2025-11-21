
import React from 'react';
import { Trophy, Medal, Award } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { User } from '@/types/run';

interface UserCardHeaderProps {
  user: User;
  position: number;
  level: number;
  initials: string;
}

export const UserCardHeader: React.FC<UserCardHeaderProps> = ({ 
  user, 
  position, 
  level, 
  initials 
}) => {
  const getPodiumIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="w-6 h-6 text-yellow-500" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-400" />;
      case 3:
        return <Award className="w-6 h-6 text-amber-600" />;
      default:
        return null;
    }
  };

  const isPodium = position <= 3;

  return (
    <div className="flex items-center justify-between w-full">
      <div className="relative">
        <Avatar className="h-12 w-12">
          <AvatarImage src={user.profile_picture || ''} />
          <AvatarFallback className="text-sm font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
          {level}
        </div>
        {isPodium && (
          <div className="absolute -top-1 -left-1">
            {getPodiumIcon(position)}
          </div>
        )}
      </div>
      
      <div className="flex-1 flex justify-center">
        <h3 className="font-semibold text-lg">{user.name}</h3>
      </div>
      
      <div className="text-right">
        <span className="text-lg font-bold">#{position}</span>
      </div>
    </div>
  );
};

