import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, XCircle, ExternalLink, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';

interface StravaStatus {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
}

export const SettingsPage: React.FC = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [stravaStatus, setStravaStatus] = useState<StravaStatus>({ connected: false, expired: false });
  const [loading, setLoading] = useState(true);
  const [stravaClientId, setStravaClientId] = useState<string | null>(null);

  const fetchStravaConfig = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('strava-config');
      if (error) {
        console.error('⚠️ Error fetching Strava config:', error);
        return;
      }
      console.log('⚙️ Client ID received:', data.client_id);
      setStravaClientId(data.client_id);
    } catch (error) {
      console.error('❌ Failed to fetch Strava config:', error);
    }
  };

  const fetchStravaStatus = async () => {
    if (!session) return;
    try {
      const { data, error } = await supabase.functions.invoke('strava-status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        toast.error('Failed to fetch Strava status');
        return;
      }
      setStravaStatus(data);
    } catch (error) {
      console.error('❌ Error fetching Strava status:', error);
      toast.error('Failed to fetch Strava status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.stravaCode) {
        const code = event.data.stravaCode;
        console.log('📨 Received Strava code:', code);

        if (!session) {
          toast.error('Session saknas');
          return;
        }

        try {
          const { data, error } = await supabase.functions.invoke('strava-callback', {
            body: { code },
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });

          if (error) {
            console.error('❌ strava-callback error:', error);
            toast.error('Strava-koppling misslyckades');
            return;
          }

          console.log('✅ Strava-koppling lyckades:', data);
          toast.success('Strava-konto kopplat!');
          fetchStravaStatus();
        } catch (err) {
          console.error('❌ Error handling Strava callback:', err);
          toast.error('Fel vid koppling till Strava');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session]);

  useEffect(() => {
    fetchStravaConfig();
    if (session) fetchStravaStatus();
    else setLoading(false);
  }, [session]);

  const handleConnectStrava = () => {
    if (!stravaClientId) {
      toast.error('Strava-konfiguration saknas');
      return;
    }

    const redirectUri = `${window.location.origin}/strava-popup.html`;
    const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=force&scope=activity:read`;

    const popup = window.open(stravaAuthUrl, '_blank', 'width=500,height=700');
    if (!popup) {
      toast.error('Tillåt popup-fönster för att koppla Strava');
    } else {
      console.log('🪟 Popup öppnad');
    }
  };

  const handleBackClick = () => navigate('/');

  const handleTestManualStravaCode = async () => {
    const testCode = "a3a25f358f358eea18c72589174c9a1cdcac7e10";

    if (!session) {
      toast.error("Ingen session");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("strava-callback", {
        body: { code: testCode },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        console.error("❌ Error:", error);
        toast.error("Misslyckades koppla Strava manuellt");
      } else {
        console.log("✅ Lyckades manuellt:", data);
        toast.success("Testkod skickad – Strava tokens bör vara sparade!");
        fetchStravaStatus();
      }
    } catch (err) {
      console.error("❌ Exception:", err);
      toast.error("Fel i test-försök");
    }
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="secondary">Loading...</Badge>;
    if (!stravaStatus.connected) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="w-3 h-3" /> Not Connected
        </Badge>
      );
    }
    if (stravaStatus.expired) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> Expired
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="flex items-center gap-1 bg-green-500">
        <CheckCircle className="w-3 h-3" /> Connected
      </Badge>
    );
  };

  const getStatusDescription = () => {
    if (!stravaStatus.connected) {
      return 'Your Strava account is not connected. Connect it to import your runs.';
    }
    if (stravaStatus.expired) {
      return 'Your Strava connection has expired. Reconnect to continue importing runs.';
    }
    const expiresDate = stravaStatus.expires_at ? new Date(stravaStatus.expires_at * 1000) : null;
    return `Your Strava connection is active.${expiresDate ? ` Expires: ${expiresDate.toLocaleDateString()}` : ''}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <Button variant="outline" onClick={handleBackClick} className="mb-4 flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Settings</h1>
            <p className="text-lg text-gray-600">Manage your account and Strava connection</p>
          </div>
        </header>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Strava Integration {getStatusBadge()}
              </CardTitle>
              <CardDescription>{getStatusDescription()}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(!stravaStatus.connected || stravaStatus.expired) && (
                  <Button onClick={handleConnectStrava} className="flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" /> Connect Strava
                  </Button>
                )}
                {stravaStatus.connected && !stravaStatus.expired && (
                  <div className="text-sm text-gray-600">
                    <p>✅ Your Strava runs are imported automatically every 3 hours.</p>
                    <p>✅ Only running activities (type "Run") are imported.</p>
                    <p>✅ Duplicate activities are automatically filtered.</p>
                  </div>
                )}
                <Separator className="my-4" />
                <Button variant="outline" onClick={handleTestManualStravaCode}>
                  💻 Testa Strava-kod manuellt
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p><strong>Username:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Level:</strong> {user?.current_level}</p>
              <p><strong>Total XP:</strong> {user?.total_xp}</p>
              <p><strong>Total Distance:</strong> {user?.total_km?.toFixed(1)} km</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
