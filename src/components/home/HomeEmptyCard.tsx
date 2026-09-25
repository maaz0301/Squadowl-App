import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Empty state that lives inside a HomePanel: icon and title on one line, one
 * line of guidance, and orange swooshes rising from the panel's bottom corners.
 * The negative margins cancel the panel's padding so the art reaches its edges.
 */
export function HomeEmptyCard({ icon, title, message }: { icon: string; title: string; message: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="items-center"
      style={{ marginHorizontal: -12, marginBottom: -12, paddingTop: 14, paddingHorizontal: 24, paddingBottom: 64 }}
    >
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 }} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 360 56" preserveAspectRatio="none">
        <Path d="M0 56 L0 26 C50 28 110 46 170 56 Z" fill="#ff6b2b" fillOpacity={0.55} />
        <Path d="M0 56 L0 38 C40 40 90 52 130 56 Z" fill="#ff6b2b" />
        <Path d="M360 56 L360 18 C310 24 250 44 190 56 Z" fill="#ff6b2b" fillOpacity={0.55} />
        <Path d="M360 56 L360 32 C320 36 270 50 230 56 Z" fill="#ff6b2b" />
        <Path d="M0 28 C50 30 110 48 170 56" stroke="#ff9a5c" strokeWidth={1.2} fill="none" />
        <Path d="M360 20 C310 26 250 46 190 56" stroke="#ff9a5c" strokeWidth={1.2} fill="none" />
      </Svg>
      </View>

      <View className="flex-row items-center gap-2">
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Path d={icon} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
          {title}
        </Text>
      </View>
      <Text className="text-xs text-center mt-2" style={{ color: colors.inkMuted, lineHeight: 15 }}>
        {message}
      </Text>
    </View>
  );
}
