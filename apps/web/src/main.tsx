import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initI18n } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { ThemeProvider } from '@/lib/theme';
import { Toaster } from '@/components/ui/toaster';
import { App } from './App';
import './styles/globals.css';
import './styles/palettes.css';
import './styles/welcome.css';
import './styles/board-shell.css';

// Before render, and synchronously: the first authenticated API call is the one that
// provisions the profile and names the board, and it has to carry the right Accept-Language.
initI18n();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Inside AuthProvider (it gates the /me query on auth status) and inside
            QueryClientProvider (it runs that query), but outside the router — it is
            route-independent. */}
        <LanguageProvider>
          <ThemeProvider>
            <TooltipProvider>
              <App />
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </LanguageProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
