import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';

export const StravaCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (!code || loading || !session || processing) {
      return;
    }

    const handleCallback = async () => {
      setProcessing(true);

      if (error) {
        toast.error('Strava-auktorisering avbröts');
        navigate('/settings');
        return;
      }

      try {
        log.info('Strava callback: connecting via backend API');
        const result = await backendApi.connectStrava(code);

        if (!result.success) throw new Error(result.error || 'Strava connection failed');

        toast.success('Strava-konto kopplat!');
        if (window.opener) {
          window.opener.postMessage({ stravaConnected: true }, window.location.origin);
          setTimeout(() => window.close(), 1500);
        } else {
          navigate('/settings');
        }
      } catch (err) {
        log.error('Strava callback failed', err);
        toast.error('Kunde inte koppla Strava-konto');
        navigate('/settings');
      }
    };

    handleCallback();
  }, [searchParams, session, loading, processing, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-current mx-auto mb-4"></div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Kopplar Strava-konto...</h2>
        <p className="text-muted-foreground">Vänta medan vi kopplar ditt Strava-konto</p>
      </div>
    </div>
  );
};

export default StravaCallbackPage;

