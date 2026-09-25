import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';

/** Gear icon: opens Profile & settings. */
const GEAR =
  'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z';
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
 * The home screen's top row: crest and TRYOUT|HQ wordmark on the left, then
 * search, settings and the account avatar. `avatar` is passed in so the screen
 * keeps owning the user's name/photo.
 */
export function HomeTopBar({
  onSearch,
  onSettings,
  avatar,
}: {
  /** Omitted for guardians, who have nothing to search. */
  onSearch?: () => void;
  onSettings: () => void;
  avatar: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between pt-3 pb-4">
      <View className="flex-row items-center gap-2">
        <Image
          source={require('../../../assets/TryoutHQ-logo.png')}
          style={{ width: 40, height: 40 }}
          resizeMode="contain"
        />
        <Text
          className="font-display font-bold"
          style={{ fontSize: 22, letterSpacing: 1, color: colors.ink }}
          accessibilityRole="header"
        >
          TRYOUT<Text style={{ color: colors.primary }}>HQ</Text>
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        {onSearch ? <IconButton d={SEARCH} label="Search" onPress={onSearch} /> : null}
        <IconButton d={GEAR} label="Settings" onPress={onSettings} />
        {avatar}
      </View>
    </View>
  );
}
