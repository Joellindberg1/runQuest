import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';

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
  return (
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
  );
};
