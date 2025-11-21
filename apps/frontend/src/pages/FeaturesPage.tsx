import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { CheckCircle, Trophy, Zap, Target, Users, Smartphone, Settings, ChevronDown, ChevronRight, Sparkles, Wrench, Bug, ScrollText, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { ProfileMenu } from '@/features/profile';

const FeaturesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = (user as any)?.name?.toLowerCase() === 'admin';
  
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [versionOpen, setVersionOpen] = useState(false);
  const [workingOnOpen, setWorkingOnOpen] = useState(false);

  const currentVersion = "Version 0.1.0";
  const releaseDate = "6 okt 2025";

  // Features som visas direkt i 2x3 grid
  const currentFeatures = [
    {
      icon: <Trophy className="w-6 h-6" />,
      title: "Leaderboard",
      description: "Real-time ranking and level progression"
    },
    {
      icon: <Trophy className="w-6 h-6" />,
      title: "Title System",
      description: "Competitive achievements and titles"
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Run Logging",
      description: "Manual run entry with XP calculation"
    },
    {
      icon: <Target className="w-6 h-6" />,
      title: "Strava Integration",
      description: "Automatic import from Strava"
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "User Profiles",
      description: "Personal stats and achievements"
    },
    {
      icon: <Smartphone className="w-6 h-6" />,
      title: "Mobile Responsive",
      description: "Optimized for all devices"
    }
  ];

  // Working on features
  const workingOnFeatures = [
    {
      icon: <Moon className="w-5 h-5" />,
      title: "Dark mode",
      description: "Change between light and dark themes", 
      details: ["Runquest will choose system theme first"]
    }
  ];

  // Version changelog
  // const versionChanges = {
  //   newFeatures: [
  //     "Lagt till \"Dark Mode\"",
  //     "Ny statistikvy på dashboard"
  //   ],
  //   improvements: [
  //     "Snabbare sidladdning på mobiler"
  //   ],
  //   bugFixes: [
  //     "Fixat problem där vissa användare inte kunde byta lösenord"
  //   ]
  // };

  const handleFeaturesToggle = () => {
    if (!featuresOpen) {
      setFeaturesOpen(true);
      setVersionOpen(false);
      setWorkingOnOpen(false);
    }
  };

  const handleVersionToggle = () => {
    if (!versionOpen) {
      setVersionOpen(true);
      setFeaturesOpen(false);
      setWorkingOnOpen(false);
    } else {
      setVersionOpen(false);
      setFeaturesOpen(true);
    }
  };

  const handleWorkingOnToggle = () => {
    if (!workingOnOpen) {
      setWorkingOnOpen(true);
      setFeaturesOpen(false);
      setVersionOpen(false);
    } else {
      setWorkingOnOpen(false);
      setFeaturesOpen(true);
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
            <p className="text-lg text-gray-600">Features and version information</p>
          </div>
        </header>

        <div className="space-y-6">
          {/* Features Section - Always shows first */}
          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={handleFeaturesToggle}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Features
                </div>
                {featuresOpen ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </CardTitle>
            </CardHeader>
            {featuresOpen && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentFeatures.map((feature, index) => (
                    <div key={index} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-3">
                        <div className="text-blue-600 mt-1">{feature.icon}</div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                          <p className="text-sm text-gray-600">{feature.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Version Section */}

          {/* <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={handleVersionToggle}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-5 h-5 text-purple-600" />
                  {currentVersion} – {releaseDate}
                </div>
                {versionOpen ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </CardTitle>
            </CardHeader>
            {versionOpen && (
              <CardContent className="space-y-6"> */}

                {/* New Features */}

                {/* <div>
                  <h3 className="flex items-center gap-2 font-semibold text-lg mb-3">
                    <Sparkles className="w-5 h-5 text-green-600" />
                    New Features
                  </h3>
                  <ul className="space-y-2">
                    {versionChanges.newFeatures.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2"></div>
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div> */}

                {/* Improvements */}

                {/* <div>
                  <h3 className="flex items-center gap-2 font-semibold text-lg mb-3">
                    <Wrench className="w-5 h-5 text-blue-600" />
                    Improvements
                  </h3>
                  <ul className="space-y-2">
                    {versionChanges.improvements.map((improvement, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2"></div>
                        <span className="text-gray-700">{improvement}</span>
                      </li>
                    ))}
                  </ul>
                </div> */}

                {/* Bug Fixes */}

                {/* <div>
                  <h3 className="flex items-center gap-2 font-semibold text-lg mb-3">
                    <Bug className="w-5 h-5 text-red-600" />
                    Bug Fixes
                  </h3>
                  <ul className="space-y-2">
                    {versionChanges.bugFixes.map((fix, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2"></div>
                        <span className="text-gray-700">{fix}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            )}
          </Card> */}

          {/* Working On Section */}
          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={handleWorkingOnToggle}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-yellow-600" />
                  Working On
                </div>
                {workingOnOpen ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </CardTitle>
            </CardHeader>
            {workingOnOpen && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {workingOnFeatures.map((feature, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-yellow-600">{feature.icon}</div>
                        <h3 className="font-semibold">{feature.title}</h3>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{feature.description}</p>
                      <ul className="text-xs text-gray-500 space-y-1">
                        {feature.details.map((detail, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                            {detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default FeaturesPage;

