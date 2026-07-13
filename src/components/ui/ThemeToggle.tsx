import { Pressable } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useThemeStore } from '@/state/themeStore';
import { useTheme } from '@/theme/ThemeProvider';

export function ThemeToggle() {
  const { isDark, colors } = useTheme();
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <Pressable
      onPress={toggle}
      className="w-10 h-10 rounded-full items-center justify-center"
      style={{ backgroundColor: colors.tile }}
      hitSlop={8}
      accessibilityLabel="Toggle dark mode"
    >
      {isDark ? (
        // Moon Icon
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : (
        // Sun Icon
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="5" stroke={colors.ink} strokeWidth={2} />
          <Path
            d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </Pressable>
  );
}
