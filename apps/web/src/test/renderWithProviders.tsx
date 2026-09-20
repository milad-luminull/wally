import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/**
 * No I18nextProvider here on purpose — initReactI18next has already made the instance
 * react-i18next's default, and several tests render without this wrapper at all. Tests that
 * want another language `await i18n.changeLanguage(...)` BEFORE rendering; doing it here would
 * emit languageChanged after render, which React reports as an un-acted update. setup.ts
 * resets the language after every test.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = createTestQueryClient() }: { route?: string; queryClient?: QueryClient } = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper }) };
}
