import React from 'react';
import { Box } from '@mui/material';

/** The geometric "R" of the Revamp mark, on a 24-unit grid; the favicon (public/favicon.svg) draws the same path */
export const REVAMP_LOGO_R_PATH =
  'M7 4h6.5a4.5 4.5 0 0 1 1.6 8.71L18 20h-3.2l-2.6-7H10v7H7V4zm3 3v3h3.5a1.5 1.5 0 0 0 0-3H10z';

interface RevampLogoProps {
  /** Rendered width and height in px */
  size?: number;
}

/** The Revamp logo mark (REV-75): a rounded tile in the primary tone with the "R" in its contrast text, both from the theme */
export const RevampLogo: React.FC<RevampLogoProps> = ({ size = 32 }) => (
  <Box
    component="svg"
    viewBox="0 0 24 24"
    role="img"
    aria-label="Revamp"
    data-testid="revamp-logo"
    sx={(theme) => ({ width: size, height: size, display: 'block', flexShrink: 0, color: theme.palette.primary.main })}
  >
    <rect width="24" height="24" rx="6" fill="currentColor" />
    <Box component="path" d={REVAMP_LOGO_R_PATH} fillRule="evenodd" sx={(theme) => ({ fill: theme.palette.primary.contrastText })} />
  </Box>
);
