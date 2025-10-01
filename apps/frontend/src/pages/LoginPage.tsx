
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LogIn, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    const result = await login(username, password);
    
    setLoading(false);
    
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    const result = await login('admin', adminPassword);
    
    setLoading(false);
    
    if (!result.success) {
      setError(result.error || 'Invalid admin password');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">RunQuest</h1>
          <p className="text-lg text-gray-600">Login to continue your journey</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {!showAdminLogin ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LogIn className="w-5 h-5" />
                User Login
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUserLogin} className="space-y-4">
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    required
                    disabled={loading}
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    disabled={loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Logging in...' : 'Login'}
                </Button>
              </form>
              
              <div className="mt-4 pt-4 border-t">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAdminLogin(true)}
                  className="w-full"
                  disabled={loading}
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Admin Login
                </Button>
              </div>

            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Admin Login
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <Label htmlFor="adminPassword">Admin Password</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    required
                    disabled={loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Logging in...' : 'Login as Admin'}
                </Button>
              </form>
              
              <div className="mt-4 pt-4 border-t">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAdminLogin(false)}
                  className="w-full"
                  disabled={loading}
                >
                  Back to User Login
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
