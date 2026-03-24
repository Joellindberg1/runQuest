import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import {
  CheckCircle, Trophy, Zap, Target, Users, Smartphone, Settings,
  ChevronDown, ChevronRight, Moon, Bug, Wrench, Sparkles, ScrollText, Swords
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useGroupName } from '@/shared/hooks/useGroupName';
import {
  getLatestRelease,
  getPreviousReleases,
  type Release,
  type ChangeType,
  type ReleaseType
} from '@/shared/utils/changelogHelpers';

// ─── Helpers ────────────────────────────────────────────────────────────────

const releaseTypeMeta: Record<ReleaseType, { label: string; className: string }> = {
  major: { label: 'Major', className: 'border-[var(--rq-gold)] text-[var(--rq-gold)]' },
  minor: { label: 'Minor', className: 'border-foreground/30 text-muted-foreground' },
  patch: { label: 'Patch', className: 'border-foreground/15 text-muted-foreground/60' },
};

const changeTypeMeta: Record<ChangeType, { icon: React.ReactNode; color: string }> = {
  feature:     { icon: <Sparkles className="w-4 h-4" />, color: 'var(--rq-success)' },
  bugfix:      { icon: <Bug className="w-4 h-4" />,      color: 'var(--rq-danger)'  },
  improvement: { icon: <Wrench className="w-4 h-4" />,   color: 'var(--rq-text-soft)' },
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
    <Card className="bg-sidebar border-2 border-foreground/15">
      <CardHeader
        className="cursor-pointer hover:bg-accent transition-colors"
        onClick={onToggle}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <ScrollText className="w-5 h-5 text-muted-foreground" />
            <Badge variant="outline" className={typeMeta.className}>
              {typeMeta.label}
            </Badge>
            <span className="font-semibold">v{release.version}</span>
            <span className="text-muted-foreground font-normal text-sm">— {release.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground font-normal hidden sm:block">{release.date}</span>
            {isOpen
              ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
              : <ChevronRight className="w-5 h-5 text-muted-foreground" />
            }
          </div>
        </CardTitle>
      </CardHeader>

      {isOpen && (
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3 sm:hidden">{release.date}</p>
          <ul className="space-y-2">
            {release.changes.map((change, i) => {
              const meta = changeTypeMeta[change.type];
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0" style={{ color: meta.color }}>{meta.icon}</span>
                  <span className="text-sm text-foreground">{change.description}</span>
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
  const groupName = useGroupName();
  const latest = getLatestRelease();
  const previous = getPreviousReleases();

  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [workingOnOpen, setWorkingOnOpen] = useState(false);
  const [openVersion, setOpenVersion] = useState<string | null>(latest.version);

  const toggleRelease = (version: string) => {
    setOpenVersion(prev => (prev === version ? null : version));
  };

  const currentFeatures = [
    { icon: <Trophy className="w-6 h-6" />,     title: 'Leaderboard',        description: 'Real-time ranking and level progression' },
    { icon: <Trophy className="w-6 h-6" />,     title: 'Title System',        description: '20 competitive titles — from longest streak to fastest marathon, night runs to mountain elevation' },
    { icon: <Zap className="w-6 h-6" />,        title: 'Run Logging',         description: 'Manual run entry with XP calculation' },
    { icon: <Target className="w-6 h-6" />,     title: 'Strava Integration',  description: 'Automatic import from Strava' },
    { icon: <Users className="w-6 h-6" />,      title: 'User Profiles',       description: 'Personal stats and achievements' },
    { icon: <Smartphone className="w-6 h-6" />, title: 'Mobile Responsive',   description: 'Optimized for all devices' },
    { icon: <Moon className="w-6 h-6" />,       title: 'Dark Mode',           description: 'Switch between light and dark theme — defaults to system preference' },
    { icon: <Swords className="w-6 h-6" />,     title: 'Challenges',          description: '1v1 challenges between group members — earn tokens at level-up, pick a metric and duration, winner gets a boost' },
  ];

  const workingOnFeatures: { icon: React.ReactNode; title: string; description: string; details: string[] }[] = [
    {
      icon: <Trophy className="w-6 h-6" />,
      title: 'Badges',
      description: 'Visual achievements earned by hitting milestones and running in tough conditions',
      details: ['Weather-based badges', 'Streak and distance milestones', 'Special event badges'],
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: 'Public Profiles',
      description: 'Visit any member\'s profile to see their stats, titles and run history',
      details: ['Public stats and titles', 'Full run history', 'Accessible from the leaderboard'],
    },
    {
      icon: <Swords className="w-6 h-6" />,
      title: 'App Challenges',
      description: 'Group-wide challenges triggered by real weather forecasts',
      details: ['Rain, wind and cold-weather runs', 'Automatic challenge triggers', 'Collaborative group goals'],
    },
    {
      icon: <Smartphone className="w-6 h-6" />,
      title: 'Notifications',
      description: 'Stay updated on challenges, titles and group activity',
      details: ['Challenge invites and results', 'Title changes', 'Group milestones'],
    },
  ];

  return (
    <AppLayout groupName={groupName}>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-2">
            <Badge variant="outline" className="text-base px-4 py-1">
              Version {latest.version}
            </Badge>
            <span className="text-muted-foreground">Released {latest.date}</span>
          </div>
        </div>

        <div className="space-y-6">

          {/* Features */}
          <Card className="bg-sidebar border-2 border-foreground/15">
            <CardHeader
              className="cursor-pointer hover:bg-accent transition-colors"
              onClick={() => setFeaturesOpen(o => !o)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" style={{ color: 'var(--rq-success)' }} />
                  Features
                </div>
                {featuresOpen
                  ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  : <ChevronRight className="w-5 h-5 text-muted-foreground" />
                }
              </CardTitle>
            </CardHeader>
            {featuresOpen && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentFeatures.map((feature, index) => (
                    <div key={index} className="bg-background border border-foreground/50 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-3">
                        <div className="text-primary mt-1">{feature.icon}</div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                          <p className="text-sm text-muted-foreground">{feature.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Working On */}
          <Card className="bg-sidebar border-2 border-foreground/15">
            <CardHeader
              className="cursor-pointer hover:bg-accent transition-colors"
              onClick={() => { setWorkingOnOpen(o => !o); setFeaturesOpen(false); }}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5" style={{ color: 'var(--rq-gold)' }} />
                  Working On
                </div>
                {workingOnOpen
                  ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  : <ChevronRight className="w-5 h-5 text-muted-foreground" />
                }
              </CardTitle>
            </CardHeader>
            {workingOnOpen && (
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {workingOnFeatures.map((feature, index) => (
                    <div key={index} className="bg-background border border-foreground/50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div style={{ color: 'var(--rq-gold)' }}>{feature.icon}</div>
                        <h3 className="font-semibold">{feature.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{feature.description}</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {feature.details.map((detail, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <div className="w-1 h-1 bg-muted-foreground rounded-full" />
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
          <p className="text-lg text-muted-foreground text-center">Releases</p>

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
    </AppLayout>
  );
};

export default FeaturesPage;
