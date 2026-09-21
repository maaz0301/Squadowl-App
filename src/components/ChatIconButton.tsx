import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Header entry point into a team's chat — same visual weight as Header's own
 * back button.
 *
 * `badge` is passed in rather than derived from a season id here, because the
 * guardian portal's icon opens a picker across several teams and so counts a
 * total this component has no way to subscribe to on its own.
 */
export function ChatIconButton({ onPress, badge }: { onPress: () => void; badge?: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="w-12 h-12 rounded-full items-center justify-center"
      style={{ backgroundColor: colors.tile }}
      hitSlop={8}
      accessibilityLabel="Team chat"
    >
      <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
        <Path
          d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
          stroke={colors.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      {/* Overhangs the circle's top-right corner, the way an app-icon badge
          does — inside it, the pill would sit on the speech bubble itself. */}
      {badge ? (
        <View className="absolute" style={{ top: -2, right: -2 }} pointerEvents="none">
          {badge}
        </View>
      ) : null}
    </Pressable>
  );
}
