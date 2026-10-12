import { Image, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

const MARK = require('../../../assets/SquadOwl-mark.png');
const WORDMARK = {
  light: require('../../../assets/SquadOwl-wordmark-onLight.png'),
  dark: require('../../../assets/SquadOwl-wordmark-onDark.png'),
};
const TAGLINE_COLOR = { light: '#0745A4', dark: '#8DB8FF' };
const SUBTAGLINE_COLOR = { light: '#F45C10', dark: '#FF8A3D' };

/**
 * The full SquadOwl logo. Light and dark mode share one layout (owl, wordmark,
 * tagline as live text at the same size) and only the colors change, so the
 * two themes always match and the tagline stays easy to read in both.
 */
export function BrandLogo({ height = 200 }: { height?: number }) {
  const { isDark } = useTheme();
  const mode = isDark ? 'dark' : 'light';
  const markSize = height * 0.55;
  return (
    <View className="w-full items-center" accessibilityLabel="SquadOwl" style={{ gap: height * 0.03 }}>
      <Image source={MARK} style={{ width: markSize, height: markSize * (343 / 339) }} resizeMode="contain" />
      <Image source={WORDMARK[mode]} style={{ width: height * 0.95, height: height * 0.95 * (86 / 413) }} resizeMode="contain" />
      <Text className="text-center font-bold" style={{ color: TAGLINE_COLOR[mode], fontSize: 15, lineHeight: 20 }}>
        Smarter Assessments. Scheduling. Team Sorting.{'\n'}Clearer communication.
      </Text>
      <Text className="text-center font-bold" style={{ color: SUBTAGLINE_COLOR[mode], fontSize: 15, lineHeight: 20 }}>
        Your All In One Team{'\n'}Management App
      </Text>
    </View>
  );
}
