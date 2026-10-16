import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { BottomNav } from '@/components/BottomNav';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeTopBar } from '@/components/home/HomeTopBar';
import { HubActions, LiveTryoutCard, ThisWeek, pickLiveTryout } from '@/components/home/HubSections';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Avatar, ErrorState, LoadingState, Screen } from '@/components/ui';
import { isAtAssessmentLimit, ownedTryouts } from '@/data/plans';
import {
  usePlatformBlockedFeaturesQuery,
  usePrefetchTryout,
  useTeamsQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useSessionStore } from '@/state/sessionStore';
import { usePermissions, useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useState } from 'react';

/** Secondary destinations that used to live in the bottom bar's More sheet. */
const MORE_LINKS: { label: string; hint: string; route: string; feature?: 'billing' }[] = [
  { label: 'Archived', hint: 'Past evaluations and teams', route: 'ArchivedAssessments' },
  { label: 'Athlete Hub', hint: 'Every athlete on your teams and evaluations', route: 'AthleteHub' },
  { label: 'Plans & Upgrade', hint: 'Your plan and what it includes', route: 'Upgrade', feature: 'billing' },
  { label: 'Send Feedback', hint: 'Tell us how it is going', route: 'Feedback' },
];

/** Home: the evaluation in progress, quick actions, this week's events and the secondary links. */
export default function HubScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const { isGuardian } = usePermissions();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const { data: blockedFeatures } = usePlatformBlockedFeaturesQuery();
  const prefetchTryout = usePrefetchTryout();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const refreshControl = usePullToRefresh(() => Promise.all([teamsQuery.refetch(), tryoutsQuery.refetch()]));

  // Guardians have no coach hub: their home is the guardian dashboard.
  useEffect(() => {
    if (isGuardian) navigation.replace('DashboardMain');
  }, [isGuardian, navigation]);
  if (isGuardian) return null;

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <ErrorState
        message="Could not load the hub."
        onRetry={() => {
          teamsQuery.refetch();
          tryoutsQuery.refetch();
        }}
      />
    );
  }

  const blocked = new Set(blockedFeatures ?? []);
  const evaluationsOn = !blocked.has('evaluations');
  const live = pickLiveTryout(tryoutsQuery.data ?? []);

  const createTryout = () => {
    const count = ownedTryouts(tryoutsQuery.data ?? [], teamsQuery.data ?? []).length;
    if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'evaluations'));
      return;
    }
    navigation.navigate('NewAssessment');
  };

  const resumeScoring = (id: string) => {
    prefetchTryout(id);
    setCurrentTryout(id);
    setAssessorOnlyTryout(null);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRinkside', params: { id } });
  };

  return (
    <Screen padded={false} keyboardAvoiding={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} refreshControl={refreshControl}>
        <HomeTopBar
          name={(user?.displayName ?? '').split(' ')[0] || undefined}
          onSearch={() => navigation.navigate('Search')}
          avatar={
            <Pressable
              onPress={() => navigation.navigate('Profile')}
              hitSlop={8}
              accessibilityLabel="Profile and settings"
              className="ml-1"
            >
              <Avatar
                first={(user?.displayName ?? 'Coach').split(' ')[0] ?? 'C'}
                last={(user?.displayName ?? '').split(' ')[1] ?? ''}
                size={40}
                uri={user?.avatarUrl}
              />
            </Pressable>
          }
        />

        <AnnouncementBanner />

        <View className="mb-6">
          {live && evaluationsOn ? (
            <LiveTryoutCard tryout={live.tryout} kind={live.kind} onResume={() => resumeScoring(live.tryout.id)} />
          ) : (
            <HomeHero />
          )}
        </View>

        <View className="mb-6 gap-6">
          <HubActions
            actions={[
              {
                key: 'schedule',
                label: 'Schedule\nEvents',
                icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
                onPress: () => navigation.navigate('Calendar'),
              },
              ...(evaluationsOn
                ? [
                    { key: 'create', label: 'Create\nTryout', icon: 'M12 5v14M5 12h14', onPress: createTryout },
                    {
                      key: 'sort',
                      label: 'Sort\nOut',
                      icon: 'M4 7h12M4 12h8M4 17h4M18 8v10m0 0l-3-3m3 3l3-3',
                      onPress: () =>
                        live
                          ? navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: live.tryout.id } })
                          : navigation.navigate('DashboardMain', { tab: 'assessments' }),
                    },
                  ]
                : []),
            ]}
          />
          <ThisWeek
            tryouts={tryoutsQuery.data ?? []}
            onOpenTryout={(tid) => {
              prefetchTryout(tid);
              setCurrentTryout(tid);
              setAssessorOnlyTryout(null);
              navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: tid } });
            }}
            onSeeAll={() => navigation.navigate('Calendar')}
            onOpenEvent={(ev, teamId) => {
              if (teamId) navigation.navigate('TeamDetail', { id: teamId, tab: 'schedule', eventId: ev.id });
              else navigation.navigate('Calendar');
            }}
          />
        </View>

        <Text className="text-lg font-display font-bold mb-3" style={{ color: colors.ink }}>More</Text>
        <View className="gap-2">
          {MORE_LINKS.filter((l) => !l.feature || !blocked.has(l.feature)).map((l) => (
            <Pressable
              key={l.route}
              onPress={() => navigation.navigate(l.route)}
              className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: colors.tile, borderColor: colors.border }}
            >
              <Text className="text-base font-bold" style={{ color: colors.ink }}>{l.label}</Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>{l.hint}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
      <BottomNav active="hub" />
    </Screen>
  );
}
