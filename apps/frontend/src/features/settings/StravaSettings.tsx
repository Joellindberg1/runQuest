import React, { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Separator } from '@/shared/components/ui/separator';
import { CheckCircle, AlertCircle, XCircle, ExternalLink } from 'lucide-react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { log } from '@/shared/utils/logger';
import { formatConnectionDate } from '@/shared/utils/formatters';
import { useStravaData, formatLastSync, formatNextSync } from './hooks/useStravaData';

export const StravaSettings: React.FC = () => {
  const { stravaStatus, setStravaStatus, syncInfo, loading, stravaClientId, refreshStatus } = useStravaData();
  const [syncLoading, setSyncLoading] = useState(false);

  // Listen for OAuth popup callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const code = event.data?.stravaCode || event.data?.code || null;
      if (code) {
        if (!backendApi.isAuthenticated()) { toast.error('Authentication required'); return; }
        try {
          const result = await backendApi.connectStrava(code);
          if (result.success) {
            toast.success('Strava-konto kopplat!');
            refreshStatus();
          } else {
            toast.error('Strava-koppling misslyckades');
          }
        } catch {
          toast.error('Fel vid koppling till Strava');
        }
      }
      if (event.data?.error) toast.error('Strava-auktorisering misslyckades');
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectStrava = async () => {
    if (!stravaClientId) { toast.error('Strava-konfiguration saknas'); return; }

    if (stravaStatus.expired && stravaStatus.connected) {
      try {
        await backendApi.disconnectStrava();
        setStravaStatus({ connected: false, expired: false });
        toast.info('Gamla Strava-tokens rensade');
      } catch {
        // Continue anyway
      }
    }

    const redirectUri = `${window.location.origin}/strava-popup.html`;
    const encodedRedirectUri = encodeURIComponent(redirectUri);
    const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=${encodedRedirectUri}&approval_prompt=force&scope=activity:read`;

    const popup = window.open(stravaAuthUrl, '_blank', 'width=500,height=700');
    if (!popup) toast.error('Tillåt popup-fönster för att koppla Strava');
  };

  const handleSyncStrava = async () => {
    if (!backendApi.isAuthenticated()) { toast.error('Authentication required'); return; }
    setSyncLoading(true);
    try {
      const result = await backendApi.syncStrava();
      if (result.success && result.data) {
        toast.success(`Synced ${result.data.newRuns} new runs from Strava!`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        toast.error(result.error || 'Failed to sync Strava activities');
      }
    } catch {
      toast.error('Failed to sync Strava activities');
    } finally {
      setSyncLoading(false);
    }
  };

  const handleDebugStrava = async () => {
    if (!backendApi.isAuthenticated()) { toast.error('Authentication required'); return; }
    try {
      const result = await backendApi.debugStravaActivities();
      if (result.success && result.data) {
        toast.info(result.data.new_runs_count > 0
          ? `Found ${result.data.new_runs_count} new runs. Check console for details.`
          : 'No new runs found. Check console for details.'
        );
        log.debug('Strava debug data', result.data);
      } else {
        toast.error(result.error || 'Failed to fetch debug info');
      }
    } catch {
      toast.error('Failed to fetch debug info');
    }
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="secondary">Loading...</Badge>;
    if (!stravaStatus.connected) return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="w-3 h-3" /> Not Connected
      </Badge>
    );
    if (stravaStatus.expired) return (
      <Badge variant="secondary" className="flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Expired
      </Badge>
    );
    return (
      <Badge variant="default" className="flex items-center gap-1 bg-green-500">
        <CheckCircle className="w-3 h-3" /> Connected
      </Badge>
    );
  };

  const statusDescription = stravaStatus.connected
    ? 'Your Strava connection is active and tokens are automatically renewed as needed.'
    : 'Your Strava account is not connected. Connect it to import your runs.';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Strava Integration</CardTitle>
            <CardDescription>{statusDescription}</CardDescription>
            {stravaStatus.connected && (
              <div className="text-sm text-gray-600 space-y-1 mt-6">
                <p>✅ Your Strava runs are imported automatically every 3 hours.</p>
                <p>✅ Only running activities (type "Run") are imported.</p>
                <p>✅ Duplicate activities are automatically filtered.</p>
              </div>
            )}
          </div>
          {stravaStatus.connected && (
            <div className="flex flex-col items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              {getStatusBadge()}
              <StravaIcon size={24} />
              <div className="text-xs text-gray-500 text-center space-y-1">
                <div>Connected: {formatConnectionDate(stravaStatus.connection_date)}</div>
                <div>Last sync: {formatLastSync(syncInfo)}</div>
                <div>Next sync: {formatNextSync(syncInfo)}</div>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!stravaStatus.connected && (
            <Button onClick={handleConnectStrava} className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4" /> Connect Strava
            </Button>
          )}
          {stravaStatus.connected && (
            <div className="flex items-center gap-4">
              <Button onClick={handleSyncStrava} variant="outline" className="flex items-center gap-2" disabled={syncLoading}>
                {syncLoading
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />Syncing...</>
                  : <>🔄 Sync Now</>
                }
              </Button>
              <Button onClick={handleDebugStrava} variant="secondary" className="flex items-center gap-2">
                🔍 Debug Strava
              </Button>
              <span className="text-xs text-gray-400">Remember, your data will be automatically synced!</span>
            </div>
          )}
          <Separator className="my-4" />
        </div>
      </CardContent>
    </Card>
  );
};
