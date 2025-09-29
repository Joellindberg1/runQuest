import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, XCircle, ExternalLink, ArrowLeft } from 'lucide-react';
import { backendApi } from '@/services/backendApi';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';

interface StravaStatus {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
}

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stravaStatus, setStravaStatus] = useState<StravaStatus>({ connected: false, expired: false });
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  const [stravaClientId, setStravaClientId] = useState<string | null>(null);

  const fetchStravaConfig = async () => {
    try {
      const result = await backendApi.getStravaConfig();
      if (result.success && result.data) {
        console.log('⚙️ Client ID received:', result.data.client_id);
        setStravaClientId(result.data.client_id);
      } else {
        console.error('⚠️ Error fetching Strava config:', result.error);
      }
    } catch (error) {
      console.error('❌ Failed to fetch Strava config:', error);
    }
  };

  const fetchStravaStatus = async () => {
    if (!backendApi.isAuthenticated()) return;
    try {
      const result = await backendApi.getStravaStatus();
      if (result.success && result.data) {
        setStravaStatus(result.data);
        
        // Visa meddelande om token auto-refreshades
        if (result.data.auto_refreshed) {
          toast.success('Strava-anslutning automatiskt förnyad!');
        } else if (result.data.refresh_failed) {
          toast.warning('Strava-token kunde inte förnyas automatiskt');
        }
      } else {
        toast.error('Failed to fetch Strava status');
      }
    } catch (error) {
      console.error('❌ Error fetching Strava status:', error);
      toast.error('Failed to fetch Strava status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      console.log('📨 Message received:', event.data);
      console.log('🌍 Event origin:', event.origin);
      console.log('🏠 Window origin:', window.location.origin);
      
      if (event.origin !== window.location.origin) {
        console.log('❌ Origin mismatch, ignoring message');
        return;
      }

      // Hantera både gamla och nya message format
      let code = null;
      if (event.data?.stravaCode) {
        code = event.data.stravaCode;
        console.log('📨 Received Strava code (old format):', code);
      } else if (event.data?.code) {
        code = event.data.code;
        console.log('📨 Received Strava code (new format):', code);
      }

      if (code) {
        if (!backendApi.isAuthenticated()) {
          toast.error('Authentication required');
          return;
        }

        try {
          console.log('🔄 Sending code to backend...');
          const result = await backendApi.connectStrava(code);
          
          if (result.success) {
            console.log('✅ Strava-koppling lyckades:', result.data);
            toast.success('Strava-konto kopplat!');
            fetchStravaStatus();
          } else {
            console.error('❌ strava-callback error:', result.error);
            toast.error('Strava-koppling misslyckades');
          }
        } catch (err) {
          console.error('❌ Error handling Strava callback:', err);
          toast.error('Fel vid koppling till Strava');
        }
      }

      if (event.data?.error) {
        console.error('❌ Strava error:', event.data.error);
        toast.error('Strava-auktorisering misslyckades');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    fetchStravaConfig();
    if (backendApi.isAuthenticated()) fetchStravaStatus();
    else setLoading(false);
  }, []);

  const handleConnectStrava = async () => {
    console.log('🚀 handleConnectStrava called');
    console.log('🆔 stravaClientId:', stravaClientId);
    console.log('🌍 window.location.origin:', window.location.origin);
    console.log('🌐 window.location.href:', window.location.href);
    
    if (!stravaClientId) {
      console.error('❌ Strava client ID saknas');
      toast.error('Strava-konfiguration saknas');
      return;
    }

    // Om vi har en expired token, rensa den först
    if (stravaStatus.expired && stravaStatus.connected) {
      console.log('🧹 Clearing expired Strava token before reconnecting...');
      try {
        await backendApi.disconnectStrava();
        setStravaStatus({ connected: false, expired: false });
        console.log('✅ Expired token cleared');
        toast.info('Gamla Strava-tokens rensade');
      } catch (error) {
        console.warn('⚠️ Could not clear expired token, continuing anyway:', error);
      }
    }

    // Använd en mer robust metod för att bestämma redirect URI
    let redirectUri;
    const currentOrigin = window.location.origin;
    
    if (currentOrigin.includes('localhost')) {
      redirectUri = `${currentOrigin}/strava-popup.html`;
      console.log('🏠 Localhost detected');
    } else if (currentOrigin.includes('runquest.dev')) {
      // Använd samma protokoll och domän som nuvarande sida
      redirectUri = `${currentOrigin}/strava-popup.html`;
      console.log('🌐 Production domain detected');
    } else {
      // Fallback för Railway eller andra domäner
      redirectUri = `${currentOrigin}/strava-popup.html`;
      console.log('� Railway or other domain detected');
    }
    
    console.log('🔗 Strava redirect URI:', redirectUri);
    
    const encodedRedirectUri = encodeURIComponent(redirectUri);
    console.log('📝 Encoded redirect URI:', encodedRedirectUri);
    
    const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=${encodedRedirectUri}&approval_prompt=force&scope=activity:read`;
    console.log('🌐 Complete Strava auth URL:', stravaAuthUrl);

    console.log('🪟 Opening popup...');
    const popup = window.open(stravaAuthUrl, '_blank', 'width=500,height=700');
    if (!popup) {
      console.error('❌ Popup blocked');
      toast.error('Tillåt popup-fönster för att koppla Strava');
    } else {
      console.log('🪟 Popup öppnad');
    }
  };

  const handleBackClick = () => navigate('/');

  const handleTestManualStravaCode = async () => {
    const testCode = "a3a25f358f358eea18c72589174c9a1cdcac7e10";

    if (!backendApi.isAuthenticated()) {
      toast.error("Authentication required");
      return;
    }

    try {
      const result = await backendApi.connectStrava(testCode);

      if (result.success) {
        console.log("✅ Lyckades manuellt:", result.data);
        toast.success("Testkod skickad – Strava tokens bör vara sparade!");
        fetchStravaStatus();
      } else {
        console.error("❌ Error:", result.error);
        toast.error("Misslyckades koppla Strava manuellt");
      }
    } catch (err) {
      console.error("❌ Exception:", err);
      toast.error("Fel i test-försök");
    }
  };

  const handleSyncStrava = async () => {
    if (!backendApi.isAuthenticated()) {
      toast.error("Authentication required");
      return;
    }

    setSyncLoading(true);
    try {
      console.log("🔄 Manual Strava sync started...");
      const result = await backendApi.syncStrava();

      if (result.success && result.data) {
        console.log("✅ Sync completed:", result.data);
        toast.success(`Synced ${result.data.newRuns} new runs from Strava!`);
        
        // Refresh page data to show new runs
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        console.error("❌ Sync error:", result.error);
        toast.error(result.error || "Failed to sync Strava activities");
      }
    } catch (err) {
      console.error("❌ Sync exception:", err);
      toast.error("Failed to sync Strava activities");
    } finally {
      setSyncLoading(false);
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
                  <>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>✅ Your Strava runs are imported automatically every 3 hours.</p>
                      <p>✅ Only running activities (type "Run") are imported.</p>
                      <p>✅ Duplicate activities are automatically filtered.</p>
                    </div>
                    <Button 
                      onClick={handleSyncStrava} 
                      variant="outline" 
                      className="flex items-center gap-2"
                      disabled={syncLoading}
                    >
                      {syncLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                          Syncing...
                        </>
                      ) : (
                        <>
                          🔄 Sync Now
                        </>
                      )}
                    </Button>
                  </>
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
              <p><strong>Username:</strong> {(user as any)?.name}</p>
              <p><strong>Email:</strong> {(user as any)?.email}</p>
              <p><strong>Level:</strong> {(user as any)?.current_level}</p>
              <p><strong>Total XP:</strong> {(user as any)?.total_xp}</p>
              <p><strong>Total Distance:</strong> {(user as any)?.total_km?.toFixed(1)} km</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
