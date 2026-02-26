import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Plus, Save } from 'lucide-react';
import type { AdminSettings } from './hooks/useAdminData';

interface XPSettingsProps {
  settings: AdminSettings;
  setSettings: React.Dispatch<React.SetStateAction<AdminSettings>>;
  newMultiplierDay: string;
  setNewMultiplierDay: (v: string) => void;
  newMultiplierValue: string;
  setNewMultiplierValue: (v: string) => void;
  onSave: () => void;
  onAddMultiplier: () => void;
}

export const XPSettings: React.FC<XPSettingsProps> = ({
  settings,
  setSettings,
  newMultiplierDay,
  setNewMultiplierDay,
  newMultiplierValue,
  setNewMultiplierValue,
  onSave,
  onAddMultiplier,
}) => {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic XP Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>XP per Run (base)</Label>
              <Input
                type="number"
                value={settings.xpPerRun}
                onChange={(e) => setSettings(prev => ({ ...prev, xpPerRun: parseInt(e.target.value) }))}
              />
            </div>
            <div>
              <Label>XP per KM</Label>
              <Input
                type="number"
                value={settings.xpPerKm}
                onChange={(e) => setSettings(prev => ({ ...prev, xpPerKm: parseInt(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Minimum KM for Run</Label>
              <Input
                type="number"
                step="0.1"
                value={settings.minKmForRun}
                onChange={(e) => setSettings(prev => ({ ...prev, minKmForRun: parseFloat(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Minimum KM for Streak</Label>
              <Input
                type="number"
                step="0.1"
                value={settings.minKmForStreak}
                onChange={(e) => setSettings(prev => ({ ...prev, minKmForStreak: parseFloat(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Minimum Run Date</Label>
              <Input
                type="date"
                value={settings.minRunDate}
                onChange={(e) => setSettings(prev => ({ ...prev, minRunDate: e.target.value }))}
              />
              <div className="text-sm text-muted-foreground mt-1">
                Users cannot log runs before this date
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distance Bonuses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>5KM Bonus</Label>
              <Input
                type="number"
                value={settings.bonus5km}
                onChange={(e) => setSettings(prev => ({ ...prev, bonus5km: parseInt(e.target.value) }))}
              />
            </div>
            <div>
              <Label>10KM Bonus</Label>
              <Input
                type="number"
                value={settings.bonus10km}
                onChange={(e) => setSettings(prev => ({ ...prev, bonus10km: parseInt(e.target.value) }))}
              />
            </div>
            <div>
              <Label>15KM Bonus</Label>
              <Input
                type="number"
                value={settings.bonus15km}
                onChange={(e) => setSettings(prev => ({ ...prev, bonus15km: parseInt(e.target.value) }))}
              />
            </div>
            <div>
              <Label>20KM+ Bonus</Label>
              <Input
                type="number"
                value={settings.bonus20km}
                onChange={(e) => setSettings(prev => ({ ...prev, bonus20km: parseInt(e.target.value) }))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Streak Multipliers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(settings.multipliers).map(([day, multiplier]) => (
              <div key={day} className="flex items-center gap-2">
                <span className="w-16">{day} days:</span>
                <Input
                  type="number"
                  step="0.1"
                  value={multiplier}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    multipliers: { ...prev.multipliers, [parseInt(day)]: parseFloat(e.target.value) },
                  }))}
                  className="w-20"
                />
                <span>x</span>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="Days"
                value={newMultiplierDay}
                onChange={(e) => setNewMultiplierDay(e.target.value)}
                className="w-20"
              />
              <Input
                placeholder="Multiplier"
                value={newMultiplierValue}
                onChange={(e) => setNewMultiplierValue(e.target.value)}
                className="w-24"
              />
              <Button onClick={onAddMultiplier} size="sm">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 text-center">
        <Button onClick={onSave} size="lg">
          <Save className="w-4 h-4 mr-2" />
          Save All Settings
        </Button>
      </div>
    </>
  );
};
