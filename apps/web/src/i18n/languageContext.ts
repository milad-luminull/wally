import { createContext, useContext } from 'react';
import type { AppLocale } from './locales';

export interface LanguageContextValue {
  language: AppLocale;
  setLanguage: (next: AppLocale) => void;
  isSaving: boolean;
  saveFailed: boolean;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
