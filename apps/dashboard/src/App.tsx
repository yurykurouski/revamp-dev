import React, { useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getTheme } from './theme/theme.js';
import { useThemeStore } from './store/useThemeStore.js';
import { useLanguageStore } from './store/useLanguageStore.js';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes/AppRoutes.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  const { mode } = useThemeStore();
  const { language } = useLanguageStore();
  const currentTheme = useMemo(() => getTheme(mode, language), [mode, language]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
