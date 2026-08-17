import { Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Header entry point into a team's chat — same visual weight as Header's own back button. */
export function ChatIconButton({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="w-10 h-10 rounded-full items-center justify-center"
      style={{ backgroundColor: colors.tile }}
      hitSlop={8}
      accessibilityLabel="Team chat"
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
          stroke={colors.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}
