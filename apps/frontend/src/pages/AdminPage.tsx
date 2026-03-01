import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Settings, Users, Trophy, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { ProfileMenu } from '@/features/profile';
import { useAdminData, XPSettings, UserManagement, TitleConfig, AdminSecurity } from '@/features/admin';

const AdminPage: React.FC = () => {
  const navigate = useNavigate();
  const admin = useAdminData();

  const handleLogout = () => {
    backendApi.logout();
    toast.success('Logged out successfully');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <div className="flex justify-between items-center">
            <div></div>
            <div>
              <h1 className="text-4xl font-bold text-gray-800 mb-2">Runquest - Admin Panel</h1>
              <p className="text-lg text-gray-600">Configure Running Challenge Settings</p>
            </div>
            <div>
              <ProfileMenu />
            </div>
          </div>
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
            <XPSettings
              settings={admin.settings}
              setSettings={admin.setSettings}
              newMultiplierDay={admin.newMultiplierDay}
              setNewMultiplierDay={admin.setNewMultiplierDay}
              newMultiplierValue={admin.newMultiplierValue}
              setNewMultiplierValue={admin.setNewMultiplierValue}
              onSave={admin.handleSaveSettings}
              onAddMultiplier={admin.handleAddMultiplier}
            />
          </TabsContent>

          <TabsContent value="users">
            <UserManagement
              users={admin.users}
              loadingUsers={admin.loadingUsers}
              newUser={admin.newUser}
              setNewUser={admin.setNewUser}
              editingUser={admin.editingUser}
              setEditingUser={admin.setEditingUser}
              newPasswordForUser={admin.newPasswordForUser}
              setNewPasswordForUser={admin.setNewPasswordForUser}
              onAddUser={admin.handleAddUser}
              onResetUserPassword={admin.handleResetUserPassword}
              onRefreshUsers={admin.fetchUsers}
            />
          </TabsContent>

          <TabsContent value="titles">
            <TitleConfig />
          </TabsContent>

          <TabsContent value="admin">
            <AdminSecurity
              newAdminPassword={admin.newAdminPassword}
              setNewAdminPassword={admin.setNewAdminPassword}
              onChangeAdminPassword={admin.handleChangeAdminPassword}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPage;
