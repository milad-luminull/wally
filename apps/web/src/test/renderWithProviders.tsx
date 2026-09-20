import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { i18n } from '@/i18n';
import type { AppLocale } from '@/i18n/locales';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/**
 * `language` defaults to German so the existing suites are untouched; pass 'en' to assert the
 * English surface. No I18nextProvider here on purpose — initReactI18next has already made the
 * instance react-i18next's default, and several tests render without this wrapper at all.
 * setup.ts resets the language after every test.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    queryClient = createTestQueryClient(),
    language = 'de',
  }: { route?: string; queryClient?: QueryClient; language?: AppLocale } = {},
) {
  if (i18n.language !== language) void i18n.changeLanguage(language);

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
