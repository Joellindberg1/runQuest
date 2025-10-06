import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Clock, AlertTriangle, Trophy, Zap, Target, Users, Smartphone, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ProfileMenu } from '@/components/ProfileMenu';

const FeaturesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = (user as any)?.name?.toLowerCase() === 'admin';

  const currentVersion = "v0.1.0-beta";
  const releaseDate = "October 1, 2025";

  const coreFeatures = [
    {
      icon: <Trophy className="w-5 h-5" />,
      title: "Leaderboard System",
      description: "Real-time ranking based on XP, levels, and streaks",
      status: "stable",
      details: ["Level progression (1-30)", "XP calculation system", "Live rankings"]
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Run Logging",
      description: "Manual run entry with XP calculation",
      status: "stable", 
      details: ["Distance tracking", "Automatic XP calculation", "Streak management"]
    },
    {
      icon: <Target className="w-5 h-5" />,
      title: "Strava Integration",
      description: "Automatic import of runs from Strava",
      status: "stable",
      details: ["OAuth authentication", "Automatic sync", "Token management"]
    },
    {
      icon: <Users className="w-5 h-5" />,
      title: "User Profiles",
      description: "Personal stats and achievements",
      status: "stable",
      details: ["Total stats", "Streak tracking", "Run history"]
    }
  ];

  const betaFeatures = [
    {
      icon: <Trophy className="w-5 h-5" />,
      title: "Title System",
      description: "Competitive achievements and titles",
      status: "beta",
      details: ["5 competitive titles", "Real-time tracking", "Achievement unlocks"]
    },
    {
      icon: <Settings className="w-5 h-5" />,
      title: "Admin Panel",
      description: "System configuration and user management",
      status: "beta",
      details: ["XP settings", "User management", "System monitoring"]
    },
    {
      icon: <Smartphone className="w-5 h-5" />,
      title: "Mobile Responsive",
      description: "Optimized for mobile devices",
      status: "beta",
      details: ["Touch-friendly UI", "Mobile layouts", "Cross-device sync"]
    }
  ];

  const upcomingFeatures = [
    {
      icon: <Users className="w-5 h-5" />,
      title: "User Password Management",
      description: "Allow users to change their own passwords",
      status: "planned",
      details: ["Password change in settings", "Secure validation", "Email verification"]
    },
    {
      icon: <Trophy className="w-5 h-5" />,
      title: "Challenge System", 
      description: "Weekly and monthly challenges",
      status: "planned",
      details: ["Distance challenges", "Streak challenges", "Group competitions"]
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Push Notifications",
      description: "Real-time updates and reminders", 
      status: "planned",
      details: ["Achievement notifications", "Streak reminders", "Challenge updates"]
    }
  ];

  const recentFixes = [
    {
      title: "Streak Calculation Bug",
      description: "Fixed inconsistent streak values across UI components",
      date: "Oct 1, 2025",
      type: "critical"
    },
    {
      title: "Strava Sync Improvements", 
      description: "Enhanced error handling and auto token refresh",
      date: "Oct 1, 2025",
      type: "enhancement"
    },
    {
      title: "Password Security",
      description: "All user passwords now properly encrypted",
      date: "Oct 1, 2025", 
      type: "security"
    }
  ];

  const knownIssues = [
    {
      title: "Mobile Safari Display",
      description: "Minor layout issues on older iOS devices",
      severity: "low",
      workaround: "Use Chrome or update iOS"
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable': return 'bg-green-100 text-green-800';
      case 'beta': return 'bg-blue-100 text-blue-800';
      case 'planned': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'stable': return <CheckCircle className="w-4 h-4" />;
      case 'beta': return <Clock className="w-4 h-4" />;
      case 'planned': return <AlertTriangle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex justify-between items-start mb-6">
            <div></div>
            <ProfileMenu />
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">RunQuest Features</h1>
            <div className="flex items-center justify-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">
                {currentVersion}
              </Badge>
              <span className="text-gray-600">Released {releaseDate}</span>
            </div>
            <p className="text-lg text-gray-600">Beta testing with current user group</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Core Features */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Core Features (Stable)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {coreFeatures.map((feature, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-green-600 mt-1">{feature.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{feature.title}</h3>
                        <Badge className={getStatusColor(feature.status)}>
                          {feature.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{feature.description}</p>
                      <ul className="text-xs text-gray-500 space-y-1">
                        {feature.details.map((detail, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                            {detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Beta Features */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                Beta Features
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {betaFeatures.map((feature, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-blue-600 mt-1">{feature.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{feature.title}</h3>
                        <Badge className={getStatusColor(feature.status)}>
                          {feature.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{feature.description}</p>
                      <ul className="text-xs text-gray-500 space-y-1">
                        {feature.details.map((detail, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                            {detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Features */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Upcoming Features
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {upcomingFeatures.map((feature, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-yellow-600">{feature.icon}</div>
                    <h3 className="font-semibold">{feature.title}</h3>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{feature.description}</p>
                  <Badge className={getStatusColor(feature.status)}>
                    {feature.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Fixes */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Fixes & Updates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentFixes.map((fix, index) => (
                <div key={index} className="border-l-4 border-green-500 pl-4 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm">{fix.title}</h4>
                    <Badge variant="outline" className="text-xs">
                      {fix.type}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600">{fix.description}</p>
                  <p className="text-xs text-gray-500 mt-1">{fix.date}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Feedback & Issues */}
          <Card>
            <CardHeader>
              <CardTitle>Feedback & Known Issues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">Beta Feedback</h4>
                <p className="text-sm text-blue-700 mb-2">
                  We value your feedback! Report any issues or suggestions directly to Joel.
                </p>
                <div className="text-xs text-blue-600">
                  Focus areas: Performance, UI/UX, Feature requests, Bug reports
                </div>
              </div>
              
              {knownIssues.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Known Issues</h4>
                  {knownIssues.map((issue, index) => (
                    <div key={index} className="border rounded-lg p-3 bg-yellow-50">
                      <div className="flex items-center gap-2 mb-1">
                        <h5 className="font-medium text-sm">{issue.title}</h5>
                        <Badge variant="outline" className="text-xs">
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{issue.description}</p>
                      {issue.workaround && (
                        <p className="text-xs text-gray-500">
                          <strong>Workaround:</strong> {issue.workaround}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Beta Status */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Beta Testing Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600 mb-1">7</div>
                <div className="text-sm text-green-700">Active Beta Users</div>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600 mb-1">8</div>
                <div className="text-sm text-blue-700">Core Features</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-purple-600 mb-1">95%</div>
                <div className="text-sm text-purple-700">System Stability</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FeaturesPage;