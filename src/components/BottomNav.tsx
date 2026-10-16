import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useBottomInset } from '@/hooks/useBottomInset';

import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions, useUser } from '@/state/authStore';
import { useTeamsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { isAtAssessmentLimit, isAtTeamLimit, ownedTryouts } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Modal } from '@/components/ui';

export type BottomNavKey = 'hub' | 'assessments' | 'teams' | 'calendar' | 'library' | 'profile';

/** Slots in the bar, left to right; the centre one is the "+" button. */
type Slot = 'hub' | 'library' | 'add' | 'calendar' | 'profile';
const SLOTS: Slot[] = ['hub', 'library', 'add', 'calendar', 'profile'];

const ICONS: Record<Exclude<Slot, 'add'>, string> = {
  hub: 'M3 11l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10',
  library: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
};

const LABELS: Record<Exclude<Slot, 'add'>, string> = {
  hub: 'Hub',
  library: 'Library',
  calendar: 'Calendar',
  profile: 'Profile',
};

const SHEET_ICONS = {
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  teams: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  plus: 'M12 5v14M5 12h14',
  library: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
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
  const bottomInset = useBottomInset();
  const navigation = useNavigation<any>();
  const { isGuardian, role } = usePermissions();
  const user = useUser();
  const [addOpen, setAddOpen] = useState(false);
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  if (isGuardian || role === 'guardian') {
    return null;
  }

  const go = (fn: () => void) => {
    setAddOpen(false);
    fn();
  };
  const openList = (key: 'assessments' | 'teams') => go(() => (onTabPress ? onTabPress(key) : navigation.navigate('DashboardMain', { tab: key })));
  const newEvaluation = () =>
    go(() => {
      const count = ownedTryouts(tryoutsQuery.data ?? [], teamsQuery.data ?? []).length;
      if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
        setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'evaluations'));
        return;
      }
      navigation.navigate('NewAssessment');
    });
  const newTeam = () =>
    go(() => {
      const owned = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
      if (isAtTeamLimit(user?.planTier ?? 'free', owned, user?.extraTeamLicenses ?? 0)) {
        setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0));
        return;
      }
      navigation.navigate('NewTeam');
    });

  const press = (slot: Slot) => {
    if (slot === 'add') return onTabPress ? onTabPress('assessments') : navigation.navigate('DashboardMain', { tab: 'assessments' });
    navigation.navigate(slot === 'hub' ? 'Hub' : slot === 'library' ? 'Library' : slot === 'calendar' ? 'Calendar' : 'Profile');
  };

  const sheetItems = [
    { label: 'New evaluation', hint: 'Start a tryout or evaluation', icon: SHEET_ICONS.plus, onPress: newEvaluation },
    { label: 'New team', hint: 'Create a team and roster', icon: SHEET_ICONS.plus, onPress: newTeam },
    { label: 'Evaluations', hint: 'All your tryouts and evaluations', icon: SHEET_ICONS.clipboard, onPress: () => openList('assessments') },
    { label: 'Teams', hint: 'Rosters, schedules and team details', icon: SHEET_ICONS.teams, onPress: () => openList('teams') },
  ];

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
        {SLOTS.map((slot) => {
          if (slot === 'add') {
            return (
              <Pressable
                key={slot}
                onPress={() => press(slot)}
                accessibilityRole="button"
                accessibilityLabel="Add"
                className="flex-1 items-center"
              >
                <View
                  className="items-center justify-center"
                  style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primary, marginTop: -18 }}
                >
                  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 5v14M5 12h14" stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" />
                  </Svg>
                </View>
              </Pressable>
            );
          }
          const isActive = slot === active;
          const tint = isActive ? colors.primary : colors.inkMuted;
          return (
            <Pressable
              key={slot}
              onPress={() => press(slot)}
              className="items-center justify-center flex-1 py-1"
              accessibilityLabel={LABELS[slot]}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d={ICONS[slot]} stroke={tint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text className="text-xs font-medium mt-1" style={{ color: tint }}>
                {LABELS[slot]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Modal visible={addOpen} title="Add" onClose={() => setAddOpen(false)}>
        <View className="gap-2">
          {sheetItems.map((it) => (
            <Pressable
              key={it.label}
              onPress={it.onPress}
              className="flex-row items-center gap-3 rounded-xl border px-4 py-3"
              style={{ backgroundColor: colors.tile, borderColor: colors.border }}
            >
              <View
                className="items-center justify-center rounded-lg"
                style={{ width: 40, height: 40, backgroundColor: 'rgba(255,107,43,0.16)' }}
              >
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d={it.icon} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold" style={{ color: colors.ink }}>{it.label}</Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>{it.hint}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Modal>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </View>
  );
}
