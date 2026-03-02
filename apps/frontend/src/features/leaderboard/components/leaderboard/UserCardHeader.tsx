
import React from 'react';
import { Trophy, Medal, Award } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import type { User, UserTitle } from '@/types/run';

interface UserCardHeaderProps {
  user: User;
  position: number;
  level: number;
  initials: string;
  titles: UserTitle[];
}

const formatTitlesDisplay = (titles: UserTitle[]): string | null => {
  if (titles.length === 0) return null;
  const names = titles.map((t) => t.title_name);
  if (titles.length === 1) return names[0];
  if (titles.length === 2) return `The one who is a bit too tryhard, ${names[0]} & ${names[1]}`;
  const last = names.pop();
  return `The one with too many names, ${names.join(', ')} & ${last}`;
};

export const UserCardHeader: React.FC<UserCardHeaderProps> = ({
  user,
  position,
  level,
  initials,
  titles,
}) => {
  const isPodium = position <= 3;
  const titlesDisplay = formatTitlesDisplay(titles);

  const getPodiumIcon = (pos: number) => {
    switch (pos) {
      case 1: return <Trophy className="w-6 h-6 text-yellow-500" />;
      case 2: return <Medal className="w-6 h-6 text-zinc-500" />;
      case 3: return <Award className="w-6 h-6 text-amber-800" />;
      default: return null;
    }
  };

  return (
    // Single row: avatar left, name+title center, position right — items-start so name floats to top
    <div className="flex items-start justify-between w-full gap-2">

      {/* Left: Avatar pushed down so it sits at the title line */}
      <div className="relative mt-4 shrink-0">
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

      {/* Center: Name at top, title below — fills the space between avatar and position */}
      <div className="flex-1 flex flex-col items-center min-w-0">
        <h3 className="font-semibold text-lg leading-tight text-center">{user.name}</h3>
        {titlesDisplay && (
          <p className="text-xs italic mt-1 text-center">{titlesDisplay}</p>
        )}
      </div>

      {/* Right: Position pushed down to sit at the title line */}
      <div className="mt-4 shrink-0">
        <span className="text-lg font-bold">#{position}</span>
      </div>

    </div>
  );
};

