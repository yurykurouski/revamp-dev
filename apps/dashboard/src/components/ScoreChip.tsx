import React from 'react';
import { Chip, type ChipProps } from '@mui/material';

/** Color band of an audit score: 70+ is healthy, 40–69 needs work, below 40 is poor */
export function scoreColor(score: number): 'success' | 'warning' | 'error' {
  return score >= 70 ? 'success' : score >= 40 ? 'warning' : 'error';
}

/** The original site's audit score as a tinted `n/100` chip */
export const ScoreChip: React.FC<{ score: number; sx?: ChipProps['sx'] }> = ({ score, sx }) => (
  <Chip label={`${score}/100`} size="small" color={scoreColor(score)} sx={sx} />
);
