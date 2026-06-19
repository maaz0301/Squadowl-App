const themeTokens = require('./src/theme/tokens.tailwind.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: themeTokens.brand,
        navy: themeTokens.navy,
        success: themeTokens.semantic.success,
        danger: themeTokens.semantic.danger,
        warning: themeTokens.semantic.warning,
        info: themeTokens.semantic.info,
        score: themeTokens.scoreColors,
        surface: {
          dark: 'rgba(12,21,40,0.82)',
          glass: 'rgba(17,29,53,0.8)',
        },
        ink: {
          DEFAULT: '#e8eeff',
          muted: '#8fa3c8',
          faint: '#8899bb',
        },
      },
      fontFamily: {
        sans: [themeTokens.fontFamily.sans],
        display: [themeTokens.fontFamily.display],
        mono: [themeTokens.fontFamily.mono],
      },
      fontSize: {
        xs: [`${themeTokens.fontSize.xs}px`, { lineHeight: '1.3' }],
        sm: [`${themeTokens.fontSize.sm}px`, { lineHeight: '1.3' }],
        base: [`${themeTokens.fontSize.base}px`, { lineHeight: '1.55' }],
        md: [`${themeTokens.fontSize.md}px`, { lineHeight: '1.15' }],
        lg: [`${themeTokens.fontSize.lg}px`, { lineHeight: '1.15' }],
        xl: [`${themeTokens.fontSize.xl}px`, { lineHeight: '1.15' }],
        '2xl': [`${themeTokens.fontSize['2xl']}px`, { lineHeight: '1.15' }],
        '3xl': [`${themeTokens.fontSize['3xl']}px`, { lineHeight: '1' }],
        display: [`${themeTokens.fontSize.display}px`, { lineHeight: '1' }],
      },
      borderRadius: {
        xs: `${themeTokens.radius.xs}px`,
        sm: `${themeTokens.radius.sm}px`,
        DEFAULT: `${themeTokens.radius.DEFAULT}px`,
        md: `${themeTokens.radius.md}px`,
        lg: `${themeTokens.radius.lg}px`,
        xl: `${themeTokens.radius.xl}px`,
        '2xl': `${themeTokens.radius['2xl']}px`,
        full: `${themeTokens.radius.full}px`,
      },
      spacing: {
        1: `${themeTokens.spacing[1]}px`,
        2: `${themeTokens.spacing[2]}px`,
        3: `${themeTokens.spacing[3]}px`,
        4: `${themeTokens.spacing[4]}px`,
        6: `${themeTokens.spacing[6]}px`,
        8: `${themeTokens.spacing[8]}px`,
        12: `${themeTokens.spacing[12]}px`,
        16: `${themeTokens.spacing[16]}px`,
      },
    },
  },
  plugins: [],
};
