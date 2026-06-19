import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import {
  getThemeColors,
  themeTokens,
  type ThemeColors,
  type ThemeMode,
  type ThemeTokens,
} from './tokens';
import { useThemeStore } from '@/state/themeStore';

export interface AppTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  tokens: ThemeTokens;
  isDark: boolean;
}

const ThemeContext = createContext<AppTheme | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemeStore((s) => s.mode);
  const systemScheme = useSystemColorScheme();
  const mode: ThemeMode =
    preference === 'system'
      ? systemScheme === 'light'
        ? 'light'
        : 'dark'
      : preference;

  const value = useMemo<AppTheme>(
    () => ({
      mode,
      colors: getThemeColors(mode),
      tokens: themeTokens,
      isDark: mode === 'dark',
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within AppThemeProvider');
  }
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}
