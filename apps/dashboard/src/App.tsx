import React, { useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getTheme } from './theme/theme.js';
import { useThemeStore } from './store/useThemeStore.js';
import { Layout } from './components/Layout.js';
import { LeadsPage } from './pages/LeadsPage.js';

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
  const currentTheme = useMemo(() => getTheme(mode), [mode]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <Layout>
          <LeadsPage />
        </Layout>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
