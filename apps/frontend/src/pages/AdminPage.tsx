import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Users, Trophy, Target, Plus, Save } from 'lucide-react';

interface AdminSettings {
  xpPerRun: number;
  xpPerKm: number;
  bonus5km: number;
  bonus10km: number;
  bonus15km: number;
  bonus20km: number;
  minKmForRun: number;
  minKmForStreak: number;
  minRunDate: string;
  streakBonuses: { [key: number]: number };
  multipliers: { [key: number]: number };
}

interface User {
  id: number;
  name: string;
  password: string;
  profilePicture?: string;
}

const AdminPage: React.FC = () => {
  const [adminPassword, setAdminPassword] = useState('admin123');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [settings, setSettings] = useState<AdminSettings>({
    xpPerRun: 15,
    xpPerKm: 2,
    bonus5km: 5,
    bonus10km: 15,
    bonus15km: 25,
    bonus20km: 50,
    minKmForRun: 1.0,
    minKmForStreak: 1.0,
    minRunDate: '2025-06-01',
    streakBonuses: {
      10: 50,
      30: 50,
      60: 50,
      90: 50,
      120: 50,
      150: 50,
      180: 50,
      210: 50,
      240: 50,
      270: 50,
      300: 50,
      330: 50
    },
    multipliers: {
      5: 1.1,
      15: 1.2,
      30: 1.3,
      60: 1.4,
      90: 1.5,
      120: 1.6,
      180: 1.7,
      220: 1.8,
      240: 1.9,
      270: 2.0
    }
  });

  const [users, setUsers] = useState<User[]>([
    { id: 1, name: "Alex Runner", password: "pass123" },
    { id: 2, name: "Sarah Swift", password: "pass456" }
  ]);

  const [newUser, setNewUser] = useState({ name: '', password: '', profilePicture: '' });
  const [newMultiplierDay, setNewMultiplierDay] = useState('');
  const [newMultiplierValue, setNewMultiplierValue] = useState('');

  const handleSaveSettings = () => {
    // Save settings to localStorage or backend
    localStorage.setItem('adminSettings', JSON.stringify(settings));
    alert('Settings saved successfully!');
  };

  const handleChangeAdminPassword = () => {
    if (newAdminPassword.trim()) {
      setAdminPassword(newAdminPassword);
      setNewAdminPassword('');
      alert('Admin password changed successfully!');
    }
  };

  const handleAddUser = () => {
    if (newUser.name && newUser.password) {
      const newId = Math.max(...users.map(u => u.id)) + 1;
      setUsers([...users, { ...newUser, id: newId }]);
      setNewUser({ name: '', password: '', profilePicture: '' });
      alert('User added successfully!');
    }
  };

  const handleAddMultiplier = () => {
    const day = parseInt(newMultiplierDay);
    const value = parseFloat(newMultiplierValue);
    if (day && value) {
      setSettings({
        ...settings,
        multipliers: { ...settings.multipliers, [day]: value }
      });
      setNewMultiplierDay('');
      setNewMultiplierValue('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Göteborgsvarvet 2026 - Admin Panel</h1>
          <p className="text-lg text-gray-600">Configure Running Challenge Settings</p>
        </header>

        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              XP Settings
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="titles">
              <Trophy className="w-4 h-4 mr-2" />
              Titles
            </TabsTrigger>
            <TabsTrigger value="admin">
              <Target className="w-4 h-4 mr-2" />
              Admin
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
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
                      onChange={(e) => setSettings({...settings, xpPerRun: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>XP per KM</Label>
                    <Input
                      type="number"
                      value={settings.xpPerKm}
                      onChange={(e) => setSettings({...settings, xpPerKm: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Minimum KM for Run</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={settings.minKmForRun}
                      onChange={(e) => setSettings({...settings, minKmForRun: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Minimum KM for Streak</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={settings.minKmForStreak}
                      onChange={(e) => setSettings({...settings, minKmForStreak: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Minimum Run Date</Label>
                    <Input
                      type="date"
                      value={settings.minRunDate}
                      onChange={(e) => setSettings({...settings, minRunDate: e.target.value})}
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
                      onChange={(e) => setSettings({...settings, bonus5km: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>10KM Bonus</Label>
                    <Input
                      type="number"
                      value={settings.bonus10km}
                      onChange={(e) => setSettings({...settings, bonus10km: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>15KM Bonus</Label>
                    <Input
                      type="number"
                      value={settings.bonus15km}
                      onChange={(e) => setSettings({...settings, bonus15km: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>20KM+ Bonus</Label>
                    <Input
                      type="number"
                      value={settings.bonus20km}
                      onChange={(e) => setSettings({...settings, bonus20km: parseInt(e.target.value)})}
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
                        onChange={(e) => setSettings({
                          ...settings,
                          multipliers: { ...settings.multipliers, [parseInt(day)]: parseFloat(e.target.value) }
                        })}
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
                    <Button onClick={handleAddMultiplier} size="sm">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="mt-6 text-center">
              <Button onClick={handleSaveSettings} size="lg">
                <Save className="w-4 h-4 mr-2" />
                Save All Settings
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="users">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Add New User</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={newUser.name}
                        onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                        placeholder="Enter name"
                      />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input
                        value={newUser.password}
                        onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                        placeholder="Enter password"
                      />
                    </div>
                    <div>
                      <Label>Profile Picture URL (optional)</Label>
                      <Input
                        value={newUser.profilePicture}
                        onChange={(e) => setNewUser({...newUser, profilePicture: e.target.value})}
                        placeholder="Enter image URL"
                      />
                    </div>
                  </div>
                  <Button onClick={handleAddUser} className="mt-4">
                    <Plus className="w-4 h-4 mr-2" />
                    Add User
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Current Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {users.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <span className="font-semibold">{user.name}</span>
                          <span className="text-sm text-muted-foreground ml-2">ID: {user.id}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Password: {user.password}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="titles">
            <Card>
              <CardHeader>
                <CardTitle>Title Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    Current competitive titles are hardcoded. Future updates will allow customization.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold">The Reborn Eliud Kipchoge</h4>
                      <p className="text-sm text-muted-foreground">Longest single run (12km+ to unlock)</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold">The Daaaaaaaaaaaaaaaaaaaaaaaaavid GOGGINGS</h4>
                      <p className="text-sm text-muted-foreground">Longest streak (20+ days to unlock)</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold">The Ultra Man</h4>
                      <p className="text-sm text-muted-foreground">Most total km (100km+ to unlock)</p>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold">The Weekend Destroyer</h4>
                      <p className="text-sm text-muted-foreground">Best weekend average (9km+ to unlock)</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admin">
            <Card>
              <CardHeader>
                <CardTitle>Admin Password Management</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label>Current Admin Password</Label>
                    <Input value={adminPassword} disabled />
                  </div>
                  <div>
                    <Label>New Admin Password</Label>
                    <Input
                      type="password"
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                  </div>
                  <Button onClick={handleChangeAdminPassword}>
                    Change Password
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPage;
