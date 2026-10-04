import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { log } from '@/shared/utils/logger';
import { EmptyState } from '@/shared/components/EmptyState';
import { paths } from '@/paths';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    log.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <EmptyState
      title="Page not found"
      text="That address does not lead anywhere."
      actionLabel="Back to the board"
      actionTo={paths.board}
    />
  );
};

export default NotFound;
