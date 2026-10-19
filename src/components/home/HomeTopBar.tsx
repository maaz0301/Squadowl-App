import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme, useThemeColors } from '@/theme/ThemeProvider';
import { useThemeStore } from '@/state/themeStore';

const MOON = 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z';
const SUN =
  'M12 8a4 4 0 100 8 4 4 0 000-8zM12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42';
const SEARCH = 'M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z';

function IconButton({ d, label, onPress }: { d: string; label: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="items-center justify-center rounded-full"
      style={{ width: 40, height: 40 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path d={d} stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

/** Light/dark switch, matching the web app's. Shows the mode you'd switch to. */
function ThemeToggleButton() {
  const { isDark } = useTheme();
  const colors = useThemeColors();
  const setMode = useThemeStore((s) => s.setMode);
  return (
    <Pressable
      onPress={() => setMode(isDark ? 'light' : 'dark')}
      hitSlop={8}
      className="items-center justify-center rounded-full"
      style={{ width: 40, height: 40, backgroundColor: colors.tile }}
      accessibilityRole="button"
      accessibilityLabel="Toggle dark mode"
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d={isDark ? MOON : SUN} stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

/**
 * The home screen's top row: emblem and SQUADOWL wordmark on the left, then
 * search and the account avatar. `avatar` is passed in so the screen keeps
 * owning the user's name/photo; it's the only way to Profile & settings here —
 * a separate gear icon used to sit next to it and open the exact same screen,
 * which just made "which one do I tap" the only question it answered.
 */
export function HomeTopBar({
  onSearch,
  avatar,
}: {
  /** Omitted for guardians, who have nothing to search. */
  onSearch?: () => void;
  avatar: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between pt-3 pb-4">
      <View className="flex-row items-center gap-2">
        <Image
          source={require('../../../assets/SquadOwl-logo.png')}
          style={{ width: 40, height: 40 }}
          resizeMode="contain"
        />
        {/* Always the light wordmark: it must not change colour with the theme. */}
        <Image
          source={require('../../../assets/SquadOwl-wordmark-light.png')}
          style={{ width: 130, height: 28 }}
          resizeMode="contain"
          accessibilityRole="header"
          accessibilityLabel="SquadOwl"
        />
      </View>
      <View className="flex-row items-center gap-1">
        <ThemeToggleButton />
        {onSearch ? <IconButton d={SEARCH} label="Search" onPress={onSearch} /> : null}
        {avatar}
      </View>
    </View>
  );
}
