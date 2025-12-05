import React, { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { CheckCircle, AlertCircle, XCircle, ExternalLink, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { backendApi } from '@/shared/services/backendApi';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Separator } from '@/shared/components/ui/separator';
import { StravaIcon } from '@/shared/components/ui/StravaIcon';
import { ProfileMenu } from '@/features/profile';

interface StravaStatus {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
  connection_date?: string;
  last_sync?: string;
}

interface SyncInfo {
  last_sync_attempt: string | null;
  last_sync_status: string;
  next_sync_estimated: string | null;
  users_synced?: number;
  total_users?: number;
  new_runs?: number;
}

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [stravaStatus, setStravaStatus] = useState<StravaStatus>({ connected: false, expired: false });
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  
  // Password change state
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);
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
      const [statusResult, syncResult] = await Promise.all([
        backendApi.getStravaStatus(),
        backendApi.getStravaLastSync()
      ]);
      
      if (statusResult.success && statusResult.data) {
        setStravaStatus(statusResult.data);
        
        // Visa meddelande om token auto-refreshades
        if (statusResult.data.auto_refreshed) {
          toast.success('Strava-anslutning automatiskt förnyad!');
        } else if (statusResult.data.refresh_failed) {
          toast.warning('Strava-token kunde inte förnyas automatiskt');
        }
      } else {
        toast.error('Failed to fetch Strava status');
      }
      
      if (syncResult.success && syncResult.data) {
        setSyncInfo(syncResult.data);
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

  const handleChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }

    setPasswordLoading(true);
    try {
      const result = await backendApi.changePassword(passwordData.currentPassword, passwordData.newPassword);
      if (result.success) {
        toast.success('Password changed successfully!');
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        toast.error(result.error || 'Failed to change password');
      }
    } catch (error) {
      console.error('Password change error:', error);
      toast.error('Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

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

  const handleDebugStrava = async () => {
    if (!backendApi.isAuthenticated()) {
      toast.error("Authentication required");
      return;
    }

    try {
      console.log("🔍 Fetching Strava debug info...");
      const result = await backendApi.debugStravaActivities();

      if (result.success && result.data) {
        console.log("🔍 Debug data:", result.data);
        
        // Show detailed info in console
        console.log("📅 Connection date:", result.data.connection_date);
        console.log("📅 Fetching activities after:", result.data.after_date);
        console.log("📊 Total activities from Strava:", result.data.total_activities);
        console.log("🏃 Running activities:", result.data.running_activities);
        console.log("💾 Already imported (count):", result.data.existing_runs_count);
        console.log("💾 Already imported (IDs):", result.data.existing_run_ids);
        console.log("✨ New runs available:", result.data.new_runs_count);
        
        console.log("\n📋 All activities:");
        result.data.all_activities.forEach(a => {
          console.log(`  ${a.date}: ${a.name} (${a.distance}, ${a.type}) ${a.already_imported ? '✅ Already imported' : '🆕 New'}`);
        });
        
        if (result.data.new_runs_count > 0) {
          toast.info(`Found ${result.data.new_runs_count} new runs. Check console for details.`);
        } else {
          toast.info("No new runs found. Check console for details.");
        }
      } else {
        console.error("❌ Debug error:", result.error);
        toast.error(result.error || "Failed to fetch debug info");
      }
    } catch (err) {
      console.error("❌ Debug exception:", err);
      toast.error("Failed to fetch debug info");
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
    return 'Your Strava connection is active and tokens are automatically renewed as needed.';
  };

  const formatLastSync = (syncInfo: SyncInfo | null) => {
    if (!syncInfo?.last_sync_attempt) {
      return 'No server sync yet';
    }
    
    const syncDate = new Date(syncInfo.last_sync_attempt);
    const hours = syncDate.getHours().toString().padStart(2, '0');
    const minutes = syncDate.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatNextSync = (syncInfo: SyncInfo | null) => {
    if (!syncInfo?.next_sync_estimated) {
      return 'Unknown';
    }
    
    const nextSyncDate = new Date(syncInfo.next_sync_estimated);
    const now = new Date();
    
    if (nextSyncDate.getTime() < now.getTime()) {
      return 'Overdue';
    }
    
    const hours = nextSyncDate.getHours().toString().padStart(2, '0');
    const minutes = nextSyncDate.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatConnectionDate = (connectionDate: string | null | undefined) => {
    if (!connectionDate) return 'Unknown';
    const date = new Date(connectionDate);
    return date.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <div className="flex justify-between items-start mb-6">
            <div></div>
            <ProfileMenu />
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Settings</h1>
            <p className="text-lg text-gray-600">
              Manage your account and Strava connection
            </p>
          </div>
        </header>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Strava Integration</CardTitle>
                  <CardDescription>{getStatusDescription()}</CardDescription>
                  {stravaStatus.connected && (
                    <div className="text-sm text-gray-600 space-y-1 mt-6">
                      <p>
                        ✅ Your Strava runs are imported automatically every 3
                        hours.
                      </p>
                      <p>
                        ✅ Only running activities (type "Run") are imported.
                      </p>
                      <p>✅ Duplicate activities are automatically filtered.</p>
                    </div>
                  )}
                </div>
                {stravaStatus.connected && (
                  <div className="flex flex-col items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    {getStatusBadge()}
                    <StravaIcon size={24} />
                    <div className="text-xs text-gray-500 text-center space-y-1">
                      <div>
                        Connected:{" "}
                        {formatConnectionDate(stravaStatus.connection_date)}
                      </div>
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
                  <Button
                    onClick={handleConnectStrava}
                    className="flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" /> Connect Strava
                  </Button>
                )}
                {stravaStatus.connected && (
                  <>
                    <div className="flex items-center gap-4">
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
                          <>🔄 Sync Now</>
                        )}
                      </Button>
                      <Button
                        onClick={handleDebugStrava}
                        variant="secondary"
                        className="flex items-center gap-2"
                      >
                        🔍 Debug Strava
                      </Button>
                      <span className="text-xs text-gray-400">
                        Remember, your data will be automatically synced!
                      </span>
                    </div>
                  </>
                )}
                <Separator className="my-4" />
                {/* Hidden manual test button - keeping for debugging if needed
                <Button variant="outline" onClick={handleTestManualStravaCode}>
                  💻 Testa Strava-kod manuellt
                </Button>
                */}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setPasswordSectionOpen(!passwordSectionOpen)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Change Password
                </div>
                {passwordSectionOpen ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </CardTitle>
            </CardHeader>
            {passwordSectionOpen && (
              <>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={passwordData.currentPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          currentPassword: e.target.value,
                        })
                      }
                      placeholder="Enter current password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={passwordData.newPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          newPassword: e.target.value,
                        })
                      }
                      placeholder="Enter new password (min 6 chars)"
                    />
                  </div>
                  <div>
                    <Label htmlFor="confirmPassword">
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={passwordData.confirmPassword}
                      onChange={(e) =>
                        setPasswordData({
                          ...passwordData,
                          confirmPassword: e.target.value,
                        })
                      }
                      placeholder="Confirm new password"
                    />
                  </div>
                  <Button
                    onClick={handleChangePassword}
                    disabled={passwordLoading}
                    className="flex items-center gap-2"
                  >
                    {passwordLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Changing...
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        Change Password
                      </>
                    )}
                  </Button>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

