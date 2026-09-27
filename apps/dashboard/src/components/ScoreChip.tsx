import React from 'react';
import { Chip, type ChipProps } from '@mui/material';
import { scoreBand, type ScoreBand } from '../utils/reviewQueue.js';

/** Chip color of each score band */
export const SCORE_BAND_COLOR: Readonly<Record<ScoreBand, 'success' | 'warning' | 'error'>> = {
  low: 'error',
  medium: 'warning',
  high: 'success',
};

/** Color band of an audit score: 70+ is healthy, 40–69 needs work, below 40 is poor */
export function scoreColor(score: number): 'success' | 'warning' | 'error' {
  return SCORE_BAND_COLOR[scoreBand(score)];
}

/** The original site's audit score as a tinted `n/100` chip */
export const ScoreChip: React.FC<{ score: number; sx?: ChipProps['sx'] }> = ({ score, sx }) => (
  <Chip label={`${score}/100`} size="small" color={scoreColor(score)} sx={sx} />
);
