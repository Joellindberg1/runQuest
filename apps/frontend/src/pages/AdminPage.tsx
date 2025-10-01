import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Users, Trophy, Target, Plus, Save, Info, Edit, Key, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { backendApi } from '@/services/backendApi';
import { toast } from 'sonner';

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
  email: string;
  total_xp?: number;
  current_level?: number;
  total_runs?: number;
  current_streak?: number;
  created_at?: string;
}

const AdminPage: React.FC = () => {
  const navigate = useNavigate();
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

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPasswordForUser, setNewPasswordForUser] = useState('');
  const [newMultiplierDay, setNewMultiplierDay] = useState('');
  const [newMultiplierValue, setNewMultiplierValue] = useState('');

  // Fetch users from database
  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const result = await backendApi.getAllUsers();
      if (result.success && result.data) {
        setUsers(result.data);
      } else {
        toast.error('Failed to fetch users: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

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

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast.error('Please fill in all fields');
      return;
    }

    if (newUser.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      const result = await backendApi.createUser(newUser.name, newUser.email, newUser.password);
      if (result.success && result.data) {
        setUsers([...users, result.data]);
        setNewUser({ name: '', email: '', password: '' });
        toast.success('User created successfully!');
      } else {
        toast.error(result.error || 'Failed to create user');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('Failed to create user');
    }
  };

  const handleResetUserPassword = async (userId: number) => {
    if (!newPasswordForUser || newPasswordForUser.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      const result = await backendApi.resetUserPassword(userId, newPasswordForUser);
      if (result.success) {
        setEditingUser(null);
        setNewPasswordForUser('');
        toast.success('Password reset successfully!');
      } else {
        toast.error(result.error || 'Failed to reset password');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast.error('Failed to reset password');
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

  const handleLogout = () => {
    backendApi.logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <div className="flex justify-between items-center mb-4">
            <div></div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => navigate('/features')}
                className="flex items-center gap-2"
              >
                <Info className="w-4 h-4" />
                Features & Version
              </Button>
              <Button 
                variant="outline" 
                onClick={handleLogout}
                className="flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
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
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        placeholder="Enter email"
                      />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={newUser.password}
                        onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                        placeholder="Enter password (min 6 chars)"
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
                  {loadingUsers ? (
                    <div className="text-center py-4">Loading users...</div>
                  ) : (
                    <div className="space-y-3">
                      {users.map(user => (
                        <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex-1">
                            <div className="font-semibold">{user.name}</div>
                            <div className="text-sm text-muted-foreground">{user.email}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Level {user.current_level} • {user.total_xp} XP • {user.total_runs} runs • {user.current_streak} streak
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {editingUser?.id === user.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="password"
                                  placeholder="New password"
                                  value={newPasswordForUser}
                                  onChange={(e) => setNewPasswordForUser(e.target.value)}
                                  className="w-32"
                                />
                                <Button size="sm" onClick={() => handleResetUserPassword(user.id)}>
                                  <Save className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => {setEditingUser(null); setNewPasswordForUser('');}}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setEditingUser(user)}>
                                <Key className="w-4 h-4 mr-1" />
                                Reset Password
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {users.length === 0 && !loadingUsers && (
                        <div className="text-center py-4 text-muted-foreground">No users found</div>
                      )}
                    </div>
                  )}
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
