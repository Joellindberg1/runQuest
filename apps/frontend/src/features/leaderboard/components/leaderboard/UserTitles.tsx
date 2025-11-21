
import React from 'react';
import { Crown } from 'lucide-react';
import { UserTitle } from '@/types/run';

interface UserTitlesProps {
  titles: UserTitle[];
  isLoading?: boolean;
}

export const UserTitles: React.FC<UserTitlesProps> = ({ titles, isLoading = false }) => {
  const formatTitlesDisplay = (titles: UserTitle[]) => {
    if (titles.length === 0) return null;

    const titleNames = titles.map(title => title.title_name);

    if (titles.length === 1) {
      return titleNames[0];
    } else if (titles.length === 2) {
      return `The one who is a bit too tryhard, ${titleNames[0]} & ${titleNames[1]}`;
    } else {
      const lastTitle = titleNames.pop();
      return `The one with too many names, ${titleNames.join(', ')} & ${lastTitle}`;
    }
  };

  const titlesDisplay = formatTitlesDisplay(titles);

  if (isLoading) {
    return (
      <div className="mt-3 px-0">
        <div className="text-xs text-muted-foreground bg-gray-50 border border-gray-300 rounded-md p-2">
          <div className="flex items-center">
            <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full mr-2"></div>
            <span>Loading titles...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!titlesDisplay) return null;

  return (
    <div className="mt-3 px-0">
      <div className="text-xs text-muted-foreground bg-yellow-50 border border-black rounded-md p-2">
        <div className="flex items-center mb-1">
          <Crown className="w-4 h-4 mr-1 text-yellow-600" />
          <span className="font-medium">{titles.length === 1 ? 'Title:' : 'Titles:'}</span>
        </div>
        <div>{titlesDisplay}</div>
      </div>
    </div>
  );
};

