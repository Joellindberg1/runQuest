import React from 'react';
import { AdminScreen } from '@/features/admin/components/AdminScreen';

/** /admin (bara för administratörer — routern skickar andra till /board). Allt ligger i features/admin. */
const AdminPage: React.FC = () => <AdminScreen />;

export default AdminPage;
