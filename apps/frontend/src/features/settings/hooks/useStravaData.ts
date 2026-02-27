import { useState, useEffect } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import { formatTime } from '@/shared/utils/formatters';

export interface StravaStatus {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
  connection_date?: string;
  last_sync?: string;
}

export interface SyncInfo {
  last_sync_attempt: string | null;
  last_sync_status: string;
  next_sync_estimated: string | null;
  users_synced?: number;
  total_users?: number;
  new_runs?: number;
}

export const formatLastSync = (syncInfo: SyncInfo | null): string => {
  if (!syncInfo?.last_sync_attempt) return 'No server sync yet';
  return formatTime(syncInfo.last_sync_attempt);
};

export const formatNextSync = (syncInfo: SyncInfo | null): string => {
  if (!syncInfo?.next_sync_estimated) return 'Unknown';
  const next = new Date(syncInfo.next_sync_estimated);
  if (next.getTime() < Date.now()) return 'Overdue';
  return formatTime(syncInfo.next_sync_estimated);
};

export const useStravaData = () => {
  const [stravaStatus, setStravaStatus] = useState<StravaStatus>({ connected: false, expired: false });
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [stravaClientId, setStravaClientId] = useState<string | null>(null);

  const fetchStravaConfig = async () => {
    try {
      const result = await backendApi.getStravaConfig();
      if (result.success && result.data) {
        setStravaClientId(result.data.client_id);
      }
    } catch (error) {
      log.error('Failed to fetch Strava config', error);
    }
  };

  const refreshStatus = async () => {
    if (!backendApi.isAuthenticated()) return;
    try {
      const [statusResult, syncResult] = await Promise.all([
        backendApi.getStravaStatus(),
        backendApi.getStravaLastSync(),
      ]);

      if (statusResult.success && statusResult.data) {
        setStravaStatus(statusResult.data);
        if (statusResult.data.auto_refreshed) toast.success('Strava-anslutning automatiskt förnyad!');
        else if (statusResult.data.refresh_failed) toast.warning('Strava-token kunde inte förnyas automatiskt');
      } else {
        toast.error('Failed to fetch Strava status');
      }

      if (syncResult.success && syncResult.data) setSyncInfo(syncResult.data);
    } catch (error) {
      log.error('Error fetching Strava status', error);
      toast.error('Failed to fetch Strava status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStravaConfig();
    if (backendApi.isAuthenticated()) refreshStatus();
    else setLoading(false);
  }, []);

  return { stravaStatus, setStravaStatus, syncInfo, loading, stravaClientId, refreshStatus };
};
