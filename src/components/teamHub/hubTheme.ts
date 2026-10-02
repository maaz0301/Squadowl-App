import { useTheme } from '@/theme/ThemeProvider';

/**
 * Surfaces the Team Hub paints. The hub's panels carry a navy-blue cast in
 * dark mode (see the design), so they are derived here rather than borrowed
 * from `colors.card`; light mode falls back to the plain theme surfaces.
 */
export function useHubSurfaces() {
  const { colors, isDark } = useTheme();
  return {
    isDark,
    /** Neutral panel: event cards, inactive tabs. */
    panelBg: isDark ? 'rgba(17,31,58,0.85)' : colors.card,
    panelBorder: isDark ? 'rgba(74,120,200,0.28)' : colors.border,
    /** Blue-tinted action panel: Add to Calendar, Directions, Edit. */
    blueBg: isDark ? 'rgba(20,52,104,0.42)' : colors.tile,
    blueBorder: isDark ? 'rgba(59,130,246,0.42)' : colors.border,
    blueInk: isDark ? '#7db4ff' : colors.primary,
    orangeBg: 'rgba(255,107,43,0.10)',
    orangeBorder: 'rgba(255,107,43,0.55)',
  };
}

/** 24x24 stroke paths shared across the hub. */
export const HUB_ICONS = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  calendarPlus:
    'M8 2v4M16 2v4M3 10h18M12 14v4M10 16h4M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  players:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  clipboard:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  pin: 'M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  edit: 'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
  trash:
    'M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2',
  chevron: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 19l-7-7 7-7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  video: 'M23 7l-7 5 7 5V7zM3 5h11a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2z',
  image: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  chat: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
  feed: 'M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  check: 'M5 13l4 4L19 7',
  question: 'M9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 4M12 17h.01',
  close: 'M6 6l12 12M18 6L6 18',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  clock: 'M12 7v5l3 2M12 22a10 10 0 100-20 10 10 0 000 20z',
} as const;
