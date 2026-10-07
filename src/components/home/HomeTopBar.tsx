import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme, useThemeColors } from '@/theme/ThemeProvider';

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
  const { isDark } = useTheme();
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between pt-3 pb-4">
      <View className="flex-row items-center gap-2">
        <Image
          source={require('../../../assets/SquadOwl-logo.png')}
          style={{ width: 40, height: 40 }}
          resizeMode="contain"
        />
        <Image
          source={
            isDark
              ? require('../../../assets/SquadOwl-wordmark-dark.png')
              : require('../../../assets/SquadOwl-wordmark-light.png')
          }
          style={{ width: 130, height: 28 }}
          resizeMode="contain"
          accessibilityRole="header"
          accessibilityLabel="SquadOwl"
        />
      </View>
      <View className="flex-row items-center gap-1">
        {onSearch ? <IconButton d={SEARCH} label="Search" onPress={onSearch} /> : null}
        {avatar}
      </View>
    </View>
  );
}
