import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ShowMoreButtonProps {
  showAll: boolean;
  onClick: () => void;
  moreText?: string;
  lessText?: string;
  className?: string;
}

export const ShowMoreButton: React.FC<ShowMoreButtonProps> = ({
  showAll,
  onClick,
  moreText = "Show More",
  lessText = "Show Less",
  className = ""
}) => {
  return (
    <div className={`text-center pt-4 ${className}`}>
      <Button onClick={onClick} variant="outline">
        {showAll ? (
          <>
            <ChevronUp className="w-4 h-4 mr-2" />
            {lessText}
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4 mr-2" />
            {moreText}
          </>
        )}
      </Button>
    </div>
  );
};