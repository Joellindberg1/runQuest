import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Plus, Save, Key } from 'lucide-react';
import type { User } from '@runquest/types';

interface NewUser {
  name: string;
  email: string;
  password: string;
}

interface UserManagementProps {
  users: User[];
  loadingUsers: boolean;
  newUser: NewUser;
  setNewUser: (u: NewUser) => void;
  editingUser: User | null;
  setEditingUser: (u: User | null) => void;
  newPasswordForUser: string;
  setNewPasswordForUser: (p: string) => void;
  onAddUser: () => void;
  onResetUserPassword: (userId: string) => void;
  onRefreshUsers: () => void;
}

export const UserManagement: React.FC<UserManagementProps> = ({
  users,
  loadingUsers,
  newUser,
  setNewUser,
  editingUser,
  setEditingUser,
  newPasswordForUser,
  setNewPasswordForUser,
  onAddUser,
  onResetUserPassword,
  onRefreshUsers,
}) => {
  return (
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
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Enter name"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="Enter email"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Enter password (min 6 chars)"
              />
            </div>
          </div>
          <Button onClick={onAddUser} className="mt-4">
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Current Users</CardTitle>
            <Button variant="outline" size="sm" onClick={onRefreshUsers} disabled={loadingUsers}>
              🔄 Refresh Users
            </Button>
          </div>
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
                        <Button size="sm" onClick={() => onResetUserPassword(user.id)}>
                          <Save className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setEditingUser(null); setNewPasswordForUser(''); }}
                        >
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
  );
};
