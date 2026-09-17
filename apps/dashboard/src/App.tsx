import React from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme/theme.js';
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
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Layout>
          <LeadsPage />
        </Layout>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
