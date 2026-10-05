import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useBottomInset } from '@/hooks/useBottomInset';

import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { Modal } from '@/components/ui';

export type BottomNavKey = 'assessments' | 'teams' | 'calendar' | 'library' | 'profile' | 'more';

const ICONS: Record<BottomNavKey, string> = {
  assessments:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  teams:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  library: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

const LABELS: Record<BottomNavKey, string> = {
  assessments: 'Evaluations',
  teams: 'Teams',
  calendar: 'Calendar',
  library: 'Library',
  profile: 'Profile',
  more: 'More',
};

/** Screens the More sheet opens — the secondary destinations that have no tab of their own. */
const MORE_LINKS: { label: string; hint: string; route: string; feature?: 'billing' }[] = [
  { label: 'Archived', hint: 'Past evaluations and teams', route: 'ArchivedAssessments' },
  { label: 'Shared Athletes', hint: 'Profiles shared with you', route: 'SharedAthletes' },
  { label: 'Plans & Upgrade', hint: 'Your plan and what it includes', route: 'Upgrade', feature: 'billing' },
  { label: 'Send Feedback', hint: 'Tell us how it is going', route: 'Feedback' },
];

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
  const bottomInset = useBottomInset();
  const navigation = useNavigation<any>();
  const { isGuardian, role } = usePermissions();
  const [moreOpen, setMoreOpen] = useState(false);
  // Sections the founder has turned off platform-wide stay out of the sheet.
  const { data: blockedFeatures } = usePlatformBlockedFeaturesQuery();

  if (isGuardian || role === 'guardian') {
    return null;
  }

  const press = (key: BottomNavKey) => {
    if (key === 'profile') {
      navigation.navigate('Profile');
      return;
    }
    if (key === 'calendar') {
      navigation.navigate('Calendar');
      return;
    }
    if (key === 'library') {
      navigation.navigate('Library');
      return;
    }
    if (key === 'more') {
      setMoreOpen(true);
      return;
    }
    if (onTabPress) onTabPress(key as 'assessments' | 'teams');
    else navigation.navigate('DashboardMain', { tab: key });
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: bottomInset,
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
                  strokeWidth={key === 'more' ? 3 : 2}
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
      <Modal visible={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <View className="gap-2">
          {MORE_LINKS.filter((l) => !l.feature || !(blockedFeatures ?? []).includes(l.feature)).map((l) => (
            <Pressable
              key={l.route}
              onPress={() => {
                setMoreOpen(false);
                navigation.navigate(l.route);
              }}
              className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: colors.tile, borderColor: colors.border }}
            >
              <Text className="text-base font-bold" style={{ color: colors.ink }}>
                {l.label}
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {l.hint}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}
