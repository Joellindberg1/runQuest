import React from 'react';
import type { ChallengeMetric } from '@runquest/types';

const METRIC_LABELS: Record<ChallengeMetric, string> = {
  km:       'Most km',
  runs:     'Most runs',
  total_xp: 'Tot XP',
};

interface MetricLabelProps {
  metric: ChallengeMetric;
}

export const MetricLabel: React.FC<MetricLabelProps> = ({ metric }) => (
  <span>{METRIC_LABELS[metric]}</span>
);
