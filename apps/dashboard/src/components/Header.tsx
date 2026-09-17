import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Avatar,
  Chip,
  Button,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BoltIcon from '@mui/icons-material/Bolt';

export const Header: React.FC = () => {
  return (
    <AppBar
      position="static"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#0F172A' }}>
            Воронка лидов
          </Typography>
          <Chip
            icon={<BoltIcon sx={{ fontSize: 16 }} />}
            label="Single-Tenant Mode"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ fontWeight: 500 }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            sx={{ px: 2, py: 1 }}
          >
            Новый сайт на аудит
          </Button>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 2, borderLeft: '1px solid #E2E8F0' }}>
            <Avatar sx={{ width: 34, height: 34, bgcolor: '#4F46E5', fontSize: '0.875rem' }}>
              OP
            </Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#0F172A', lineHeight: 1.2 }}>
                Оператор
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B' }}>
                HITL Reviewer
              </Typography>
            </Box>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
