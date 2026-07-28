import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/theme/ThemeProvider';

export type BottomNavKey = 'assessments' | 'teams' | 'profile';

const ICONS: Record<BottomNavKey, string> = {
  assessments:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  teams:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
};

const LABELS: Record<BottomNavKey, string> = {
  assessments: 'Evaluations',
  teams: 'Teams',
  profile: 'Profile',
};

interface BottomNavProps {
  active: BottomNavKey;
  /**
   * The hub swaps its own list in place; every other screen leaves this unset
   * and gets navigation back to the hub on the requested tab.
   */
  onTabPress?: (key: 'assessments' | 'teams') => void;
}

export function BottomNav({ active, onTabPress }: BottomNavProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const press = (key: BottomNavKey) => {
    if (key === 'profile') {
      navigation.navigate('Profile');
      return;
    }
    if (onTabPress) onTabPress(key);
    else navigation.navigate('DashboardMain', { tab: key });
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: Math.max(12, insets.bottom),
        paddingTop: 8,
        paddingHorizontal: 16,
      }}
    >
      <View className="flex-row justify-around items-center">
        {(Object.keys(ICONS) as BottomNavKey[]).map((key) => {
          const isActive = key === active;
          const tint = isActive ? colors.primary : colors.inkMuted;
          return (
            <Pressable
              key={key}
              onPress={() => press(key)}
              className="items-center justify-center flex-1 py-1"
              accessibilityLabel={LABELS[key]}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path
                  d={ICONS[key]}
                  stroke={tint}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text className="text-xs font-medium mt-1" style={{ color: tint }}>
                {LABELS[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
