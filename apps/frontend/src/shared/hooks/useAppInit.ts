import { useEffect } from 'react';
import { frontendLevelService } from '@/shared/services/levelService';
import { log } from '@/shared/utils/logger';

export const useAppInit = () => {
  useEffect(() => {
    frontendLevelService
      .initialize()
      .catch((error) => log.error('Failed to initialize level service', error));
  }, []);
};
