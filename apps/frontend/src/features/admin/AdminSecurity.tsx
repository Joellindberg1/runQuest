import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Database } from 'lucide-react';
import { backendApi } from '@/shared/services/backendApi';

interface AdminSecurityProps {
  newAdminPassword: string;
  setNewAdminPassword: (p: string) => void;
  onChangeAdminPassword: () => void;
}

export const AdminSecurity: React.FC<AdminSecurityProps> = ({
  newAdminPassword,
  setNewAdminPassword,
  onChangeAdminPassword,
}) => {
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    totalUpdated: number;
    summary: Array<{ user: string; updated: number; error?: string }>;
  } | null>(null);

  const handleBackfill = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    const res = await backendApi.backfillStravaExtendedData();
    setBackfillLoading(false);
    if (res.success && res.data) {
      setBackfillResult(res.data);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Admin Password Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>New Admin Password</Label>
              <Input
                type="password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <Button onClick={onChangeAdminPassword}>Change Password</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Strava Extended Data Backfill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-fetches all historical Strava activities and fills in extended fields
            (pace, elevation, heart rate, suffer score, GPS) for existing runs.
          </p>
          <Button onClick={handleBackfill} disabled={backfillLoading} variant="outline">
            {backfillLoading ? 'Running backfill…' : 'Run backfill'}
          </Button>
          {backfillResult && (
            <div className="text-sm space-y-1 pt-1">
              <p className="font-medium">Total updated: {backfillResult.totalUpdated} runs</p>
              {backfillResult.summary.map(s => (
                <p key={s.user} className={s.error ? 'text-destructive' : 'text-muted-foreground'}>
                  {s.user}: {s.error ?? `${s.updated} runs`}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
