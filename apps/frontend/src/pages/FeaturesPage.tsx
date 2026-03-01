import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import {
  CheckCircle, Trophy, Zap, Target, Users, Smartphone, Settings,
  ChevronDown, ChevronRight, Moon, Bug, Wrench, Sparkles, ScrollText
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth';
import { ProfileMenu } from '@/features/profile';
import { Logo } from '@/shared/components/Logo';
import {
  getLatestRelease,
  getPreviousReleases,
  type Release,
  type ChangeType,
  type ReleaseType
} from '@/shared/utils/changelogHelpers';

// ─── Helpers ────────────────────────────────────────────────────────────────

const releaseTypeMeta: Record<ReleaseType, { label: string; className: string }> = {
  major: { label: 'Major', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  minor: { label: 'Minor', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  patch: { label: 'Patch', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const changeTypeMeta: Record<ChangeType, { icon: React.ReactNode; className: string }> = {
  feature:     { icon: <Sparkles className="w-4 h-4" />, className: 'text-green-600' },
  bugfix:      { icon: <Bug className="w-4 h-4" />,      className: 'text-red-500'   },
  improvement: { icon: <Wrench className="w-4 h-4" />,   className: 'text-blue-500'  },
};

// ─── Release Card ────────────────────────────────────────────────────────────

interface ReleaseCardProps {
  release: Release;
  isOpen: boolean;
  onToggle: () => void;
}

const ReleaseCard: React.FC<ReleaseCardProps> = ({ release, isOpen, onToggle }) => {
  const typeMeta = releaseTypeMeta[release.type];

  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <ScrollText className="w-5 h-5 text-purple-600" />
            <Badge variant="outline" className={typeMeta.className}>
              {typeMeta.label}
            </Badge>
            <span className="font-semibold">v{release.version}</span>
            <span className="text-gray-500 font-normal text-sm">— {release.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 font-normal hidden sm:block">{release.date}</span>
            {isOpen
              ? <ChevronDown className="w-5 h-5 text-gray-500" />
              : <ChevronRight className="w-5 h-5 text-gray-500" />
            }
          </div>
        </CardTitle>
      </CardHeader>

      {isOpen && (
        <CardContent>
          <p className="text-sm text-gray-400 mb-3 sm:hidden">{release.date}</p>
          <ul className="space-y-2">
            {release.changes.map((change, i) => {
              const meta = changeTypeMeta[change.type];
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 ${meta.className}`}>{meta.icon}</span>
                  <span className="text-sm text-gray-700">{change.description}</span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

const FeaturesPage: React.FC = () => {
  const { user } = useAuth();
  const latest = getLatestRelease();
  const previous = getPreviousReleases();

  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [workingOnOpen, setWorkingOnOpen] = useState(false);
  // Tracks which release version is expanded — latest starts open
  const [openVersion, setOpenVersion] = useState<string | null>(latest.version);

  const toggleRelease = (version: string) => {
    setOpenVersion(prev => (prev === version ? null : version));
  };

  const currentFeatures = [
    { icon: <Trophy className="w-6 h-6" />,     title: 'Leaderboard',        description: 'Real-time ranking and level progression' },
    { icon: <Trophy className="w-6 h-6" />,     title: 'Title System',        description: 'Competitive achievements and titles' },
    { icon: <Zap className="w-6 h-6" />,        title: 'Run Logging',         description: 'Manual run entry with XP calculation' },
    { icon: <Target className="w-6 h-6" />,     title: 'Strava Integration',  description: 'Automatic import from Strava' },
    { icon: <Users className="w-6 h-6" />,      title: 'User Profiles',       description: 'Personal stats and achievements' },
    { icon: <Smartphone className="w-6 h-6" />, title: 'Mobile Responsive',   description: 'Optimized for all devices' },
  ];

  const workingOnFeatures = [
    {
      icon: <Moon className="w-5 h-5" />,
      title: 'Dark mode',
      description: 'Change between light and dark themes',
      details: ['RunQuest will choose system theme first'],
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <Logo className="h-10" />
            <ProfileMenu />
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100 mb-2">RunQuest Features</h1>
            <div className="flex items-center justify-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">
                Version {latest.version}
              </Badge>
              <span className="text-gray-600 dark:text-gray-400">Released {latest.date}</span>
            </div>
            <p className="text-lg text-gray-600 dark:text-gray-400">Features and version information</p>
          </div>
        </header>

        <div className="space-y-6">

          {/* Features */}
          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => { setFeaturesOpen(true); setWorkingOnOpen(false); }}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Features
                </div>
                {featuresOpen
                  ? <ChevronDown className="w-5 h-5 text-gray-500" />
                  : <ChevronRight className="w-5 h-5 text-gray-500" />
                }
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

          {/* Working On */}
          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => { setWorkingOnOpen(o => !o); setFeaturesOpen(false); }}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-yellow-600" />
                  Working On
                </div>
                {workingOnOpen
                  ? <ChevronDown className="w-5 h-5 text-gray-500" />
                  : <ChevronRight className="w-5 h-5 text-gray-500" />
                }
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
                            <div className="w-1 h-1 bg-gray-400 rounded-full" />
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

          {/* Releases header */}
          <p className="text-lg text-gray-600 text-center">Releases</p>

          {/* Latest Release */}
          <ReleaseCard
            release={latest}
            isOpen={openVersion === latest.version}
            onToggle={() => toggleRelease(latest.version)}
          />

          {/* Previous Releases */}
          {previous.length > 0 && (
            <div className="space-y-3">
              {previous.map(release => (
                <ReleaseCard
                  key={release.version}
                  release={release}
                  isOpen={openVersion === release.version}
                  onToggle={() => toggleRelease(release.version)}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default FeaturesPage;
