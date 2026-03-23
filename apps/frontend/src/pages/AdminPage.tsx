import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Settings, Users, Trophy, Target } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { XPSettings } from '@/features/admin/XPSettings';
import { UserManagement } from '@/features/admin/UserManagement';
import { TitleConfig } from '@/features/admin/TitleConfig';
import { AdminSecurity } from '@/features/admin/AdminSecurity';
import { useAdminData } from '@/features/admin/hooks/useAdminData';
import { useGroupName } from '@/shared/hooks/useGroupName';

const AdminPage: React.FC = () => {
  const admin = useAdminData();
  const groupName = useGroupName();

  return (
    <AppLayout groupName={groupName}>
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
    </AppLayout>
  );
};

export default AdminPage;
