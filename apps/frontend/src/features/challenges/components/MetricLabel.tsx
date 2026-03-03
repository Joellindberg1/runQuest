import React from 'react';
import type { ChallengeMetric } from '@/types/run';

const METRIC_LABELS: Record<ChallengeMetric, string> = {
  km:       'Längst distans',
  runs:     'Flest rundor',
  total_xp: 'Mest XP',
};

interface MetricLabelProps {
  metric: ChallengeMetric;
}

export const MetricLabel: React.FC<MetricLabelProps> = ({ metric }) => (
  <span>{METRIC_LABELS[metric]}</span>
);
