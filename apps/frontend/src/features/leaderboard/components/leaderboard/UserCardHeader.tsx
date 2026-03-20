
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import type { User, UserTitle } from '@runquest/types';

interface UserCardHeaderProps {
  user: User;
  position: number;
  level: number;
  initials: string;
  titles: UserTitle[];
  totalHeld: number;
}

const formatTitlesDisplay = (titles: UserTitle[], totalHeld: number): string | null => {
  if (titles.length === 0) return null;
  const names = titles.map((t) => t.title_name);
  if (totalHeld > 3) {
    if (names.length === 1) return `${names[0]} & The one with too many names to mention!`;
    return `${names.slice(0, -1).join(', ')}, ${names[names.length - 1]} & The one with too many names to mention!`;
  }
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
};

const RANK: Record<number, string> = {
  1: 'var(--rq-rank-1)',
  2: 'var(--rq-rank-2)',
  3: 'var(--rq-rank-3)',
};

export const UserCardHeader: React.FC<UserCardHeaderProps> = ({
  user,
  position,
  level,
  initials,
  titles,
  totalHeld,
}) => {
  const titlesDisplay = formatTitlesDisplay(titles, totalHeld);
  const accent = RANK[position];

  return (
    <div className="flex items-center gap-3 w-full">

      {/* Avatar */}
      <div className="relative shrink-0">
        <Avatar
          className="h-12 w-12"
          style={{ border: `1.5px solid ${accent ?? 'var(--rq-avatar-border)'}` }}
        >
          <AvatarImage src={user.profile_picture || ''} />
          <AvatarFallback
            className="text-sm font-bold"
            style={{ fontFamily: 'Silkscreen, monospace', background: 'hsl(var(--muted))', color: accent ?? 'var(--rq-text-muted)' }}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <div
          className="absolute -bottom-1 -right-1 text-[14px] w-5 h-5 flex items-center justify-center font-bold"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', background: 'var(--rq-gold)', color: '#000' }}
        >
          {level}
        </div>
      </div>

      {/* Name + titles */}
      <div className="flex flex-col min-w-0 flex-1" style={{ minHeight: '75px' }}>
        <h3
          className="font-bold leading-tight tracking-wide uppercase truncate"
          style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.2rem' }}
        >
          {user.name}
        </h3>
        <p
          className="text-[13px] leading-snug mt-0.5 tracking-wide"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            color: titlesDisplay ? (accent ?? 'var(--rq-text-muted)') : 'transparent',
            opacity: 1,
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {titlesDisplay ?? '​'}
        </p>
      </div>

    </div>
  );
};
