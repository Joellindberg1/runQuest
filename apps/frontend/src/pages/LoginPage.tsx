
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { RunQuestLogo } from '@/shared/components/RunQuestLogo';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <div className="runquest-hybrid min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-sm w-full">

        {/* Logo + tagline */}
        <div className="flex flex-col items-center mb-8">
          <RunQuestLogo className="h-16 w-auto mb-4" />
          {/* Gold separator */}
          <div className="w-24 h-px mb-4" style={{ background: 'linear-gradient(to right, transparent, var(--rq-gold), transparent)' }} />
          <p
            className="text-sm text-muted-foreground tracking-widest uppercase"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            Continue your journey
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/40 text-destructive rounded text-sm">
            {error}
          </div>
        )}

        <Card style={{ borderColor: 'color-mix(in srgb, var(--rq-gold) 30%, transparent)' }}>
          <CardHeader className="pb-3">
            <CardTitle
              className="flex items-center gap-2 text-base uppercase tracking-widest"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', color: 'var(--rq-gold)' }}
            >
              <LogIn className="w-4 h-4" />
              Sign In
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
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;

