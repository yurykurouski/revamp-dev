import React from 'react';
import { Box, Typography } from '@mui/material';

interface DiscoveryDrawerFooterProps {
  /** A line above the actions, e.g. what happens after import */
  hint?: string;
  children: React.ReactNode;
}

/** The discovery drawer's pinned footer (REV-78): an optional hint, the back action left, the next one right */
export const DiscoveryDrawerFooter: React.FC<DiscoveryDrawerFooterProps> = ({ hint, children }) => (
  <Box
    sx={{
      flexShrink: 0,
      px: 3,
      py: 2,
      borderTop: '1px solid',
      borderColor: 'divider',
      display: 'flex',
      flexDirection: 'column',
      gap: 1.25,
    }}
  >
    {hint && (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    )}
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>{children}</Box>
  </Box>
);
