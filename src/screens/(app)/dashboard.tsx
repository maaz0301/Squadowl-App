import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
} from '@/components/ui';
import { BottomNav } from '@/components/BottomNav';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { useAuthStore, useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useAssignedTryoutsQuery,
  useRejectAssignmentMutation,
  useGuardianRostersQuery,
  useProfileQuery,
} from '@/features/queries';
import { APP_CONFIG } from '@/config/app';
import { canUseFeature, isAtAssessmentLimit } from '@/data/plans';

export default function DashboardScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const toggleCombineTryout = useSessionStore((s) => s.toggleCombineTryout);
  
  const [tab, setTab] = useState<'assessments' | 'teams'>('assessments');
  const listRef = useRef<FlatList>(null);
  const scrollOffsets = useRef<Record<string, number>>({});
  const currentOffset = useRef(0);

  // The bottom nav on other screens routes back here with the tab it wants.
  const route = useRoute<any>();
  useEffect(() => {
    const requested = route.params?.tab;
    if (requested === 'assessments' || requested === 'teams') setTab(requested);
  }, [route.params?.tab]);

  const handleTabChange = (nextTab: 'assessments' | 'teams') => {
    scrollOffsets.current[tab] = currentOffset.current;
    const restored = scrollOffsets.current[nextTab] ?? 0;
    setTab(nextTab);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: restored, animated: false });
    });
  };

  const [combineMode, setCombineMode] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [assignedExpanded, setAssignedExpanded] = useState(true);

  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const assignedQuery = useAssignedTryoutsQuery();
  const guardianQuery = useGuardianRostersQuery();

  const { isGuardian } = usePermissions();
  const isGuardianOnly = isGuardian;

  const openAssigned = (id: string) => {
    setCurrentTryout(id);
    setActiveAssessor(user?.displayName ? { name: user.displayName, email: user.email, role: 'assessor', status: 'accepted' } : null);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: id, isAssessorOnly: true } });
  };

  if (isGuardianOnly) {
    if (guardianQuery.isLoading) {
      return <LoadingState message="Loading portal..." />;
    }
    if (guardianQuery.isError) {
      return (
        <ErrorState
          message={`Could not load guardian dashboard: ${guardianQuery.error?.message || 'Unknown error'}`}
          onRetry={() => guardianQuery.refetch()}
        />
      );
    }
  } else {
    if (teamsQuery.isLoading || tryoutsQuery.isLoading) {
      return <LoadingState message="Loading dashboard..." />;
    }
    if (teamsQuery.isError || tryoutsQuery.isError) {
      const errorMsg =
        teamsQuery.error?.message || tryoutsQuery.error?.message || 'Unknown error';
      return (
        <ErrorState
          message={`Could not load dashboard data: ${errorMsg}`}
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      );
    }
  }

  const openTryout = (id: string) => {
    if (combineMode) {
      toggleCombineTryout(id);
      return;
    }
    setCurrentTryout(id);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: id } });
  };

  const fabAction = () => {
    if (tab === 'teams') navigation.navigate('NewTeam');
    else {
      const count = tryoutsQuery.data?.length ?? 0;
      if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
        setLimitMsg('You have reached the maximum number of assessments for your current plan.');
        return;
      }
      navigation.navigate('NewAssessment');
    }
  };

  const fabLabel = tab === 'teams' ? '+ New Team' : '+ New Assessment';

  const listData = isGuardianOnly ? [] : tab === 'teams' ? teamsQuery.data : tryoutsQuery.data;

  const renderItem = ({ item }: { item: any }) => {
    if (tab === 'teams') {
      return (
        <Pressable onPress={() => navigation.navigate('TeamDetail', { id: item.id })}>
          <Card className="mb-3">
            <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
              {item.name}
            </Text>
            {item.season ? (
              <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                {item.season}
              </Text>
            ) : null}
          </Card>
        </Pressable>
      );
    }

    // Assessments
    const selected = combineIds.includes(item.id);
    return (
      <Pressable onPress={() => openTryout(item.id)}>
        <Card accent={selected || combineMode} className="mb-3">
          <View className="flex-row justify-between items-start">
            <View className="flex-1">
              <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                {item.name}
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                {item.sport} · {item.eventType}
              </Text>
              {item.tryoutDate ? (
                <Text className="text-sm" style={{ color: colors.inkFaint }}>
                  {item.tryoutDate} {item.startTime ? `· ${item.startTime}` : ''}
                </Text>
              ) : null}
            </View>
            <View className="items-end gap-1">
              <Badge label={`${item.roster?.length ?? 0} players`} />
              {selected ? <Badge label="Selected" variant="brand" /> : null}
            </View>
          </View>
        </Card>
      </Pressable>
    );
  };

  const getEmptyState = () => {
    if (isGuardianOnly) return null;
    if (tab === 'teams') {
      return (
        <EmptyState
          title="No teams created"
          message="Create a team to group rosters, schedule practices and games, and manage assessments."
          actionLabel="Create Team"
          onAction={() => navigation.navigate('NewTeam')}
        />
      );
    }
    return (
      <EmptyState
        title="No assessments yet"
        message="Create your first tryout or evaluation to begin scoring players."
        actionLabel="Create Assessment"
        onAction={() => navigation.navigate('NewAssessment')}
      />
    );
  };

  const evalCount = tryoutsQuery.data?.length ?? 0;
  const teamCount = teamsQuery.data?.length ?? 0;

  return (
    <Screen padded={false}>
      <FlatList
        key={isGuardianOnly ? 'guardian' : 'coach'}
        ref={listRef}
        data={listData}
        keyExtractor={(item) => item.id}
        onScroll={(e) => {
          currentOffset.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 24,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          <View className="pt-2">
            <Header
              title={APP_CONFIG.appName}
              subtitle={`Hi, ${user?.displayName ?? (isGuardian ? 'Guardian' : 'Coach')}`}
              right={
                <View className="flex-row items-center gap-2">
                  {!isGuardianOnly && (
                    <Pressable onPress={() => navigation.navigate('Search')} hitSlop={8}>
                      <Badge label="Search" variant="info" />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => navigation.navigate('Profile')}
                    hitSlop={8}
                    accessibilityLabel="Profile and settings"
                  >
                    <Avatar
                      first={(user?.displayName ?? 'Coach').split(' ')[0] ?? 'C'}
                      last={(user?.displayName ?? '').split(' ')[1] ?? ''}
                      size={40}
                      uri={user?.avatarUrl}
                    />
                  </Pressable>
                </View>
              }
            />

            {/* Enterprise entry point — full width above the jump-point row, which
                scrolls horizontally and would push a fourth card off-screen. */}
            {!isGuardianOnly && canUseFeature(user?.planTier ?? 'free', 'enterprise') ? (
              <Pressable onPress={() => navigation.navigate('Enterprise')} className="mb-4">
                <Card accent className="flex-row items-center gap-3 p-4">
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" stroke={colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <View className="flex-1">
                    <Text className="font-bold text-base" style={{ color: colors.ink }}>
                      Enterprise Dashboard
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      Organization-wide reporting & members
                    </Text>
                  </View>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M9 5l7 7-7 7" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Card>
              </Pressable>
            ) : null}

            {/* HUB Landing Overview Cards */}
            {!isGuardianOnly && (
              <View className="mb-4">
                <Text
                  className="text-xs font-bold uppercase tracking-wider mb-2"
                  style={{ color: colors.inkMuted }}
                >
                  Overview & Jump Points
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 px-4 flex-row gap-3">
                  <Pressable onPress={() => handleTabChange('assessments')} className="mr-2">
                    <Card accent={tab === 'assessments'} className="w-36 gap-1 p-3">
                      <View className="flex-row justify-between items-center">
                        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                          <Path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
                        </Svg>
                        <Badge label={`${evalCount}`} variant={tab === 'assessments' ? 'brand' : 'default'} />
                      </View>
                      <Text className="font-bold text-sm mt-1" style={{ color: colors.ink }}>
                        Evaluations
                      </Text>
                      <Text className="text-xs" style={{ color: colors.inkMuted }}>
                        Tryouts & Tests
                      </Text>
                    </Card>
                  </Pressable>

                  <Pressable onPress={() => handleTabChange('teams')} className="mr-2">
                    <Card accent={tab === 'teams'} className="w-36 gap-1 p-3">
                      <View className="flex-row justify-between items-center">
                        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                          <Path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
                        </Svg>
                        <Badge label={`${teamCount}`} variant={tab === 'teams' ? 'brand' : 'default'} />
                      </View>
                      <Text className="font-bold text-sm mt-1" style={{ color: colors.ink }}>
                        Teams
                      </Text>
                      <Text className="text-xs" style={{ color: colors.inkMuted }}>
                        Rosters & Schedules
                      </Text>
                    </Card>
                  </Pressable>

                </ScrollView>
              </View>
            )}

            {/* Assigned Tryouts */}
            {assignedQuery.data && assignedQuery.data.length > 0 ? (
              <View className="mb-4">
                <Pressable
                  onPress={() => setAssignedExpanded(!assignedExpanded)}
                  className="flex-row items-center justify-between py-2 mb-1"
                  hitSlop={8}
                >
                  <Text
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: colors.inkMuted }}
                  >
                    Assigned to me
                  </Text>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path
                      d={assignedExpanded ? "M6 9l6 6 6-6" : "M9 5l7 7-7 7"}
                      stroke={colors.inkMuted}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Pressable>
                {assignedExpanded && assignedQuery.data.map((t) => (
                  <Pressable key={t.id} onPress={() => openAssigned(t.id)}>
                    <Card className="mb-2 flex-row justify-between items-center">
                      <View className="flex-1">
                        <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
                          {t.name}
                        </Text>
                        <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                          {t.sport} · {t.roster?.length ?? 0} players
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Badge label="Score" variant="brand" />
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Guardian View */}
            {guardianQuery.data && guardianQuery.data.length > 0 ? (
              <View className="mb-4">
                <Text
                  className="text-xs font-bold uppercase tracking-wider mb-2"
                  style={{ color: colors.inkMuted }}
                >
                  My Athletes
                </Text>
                {guardianQuery.data.map((ath) => (
                  <Pressable key={ath.id} onPress={() => navigation.navigate('GuardianPortal', { playerId: ath.id })}>
                    <Card className="mb-2">
                      <Text className="text-base font-display font-bold mb-1" style={{ color: colors.ink }}>
                        {ath.firstName} {ath.lastName}
                      </Text>
                      
                      {ath.tryouts.length === 0 && ath.seasons.length === 0 ? (
                        <Text className="text-sm" style={{ color: colors.inkMuted }}>
                          No active tryouts or seasons assigned yet.
                        </Text>
                      ) : null}

                      {ath.tryouts.length > 0 ? (
                        <View className="mt-2">
                          <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Tryouts</Text>
                          {ath.tryouts.map(t => (
                            <Text key={t.participantId} className="text-sm" style={{ color: colors.primary }}>
                              • {t.name} ({t.sport})
                            </Text>
                          ))}
                        </View>
                      ) : null}

                      {ath.seasons.length > 0 ? (
                        <View className="mt-2">
                          <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Seasons</Text>
                          {ath.seasons.map(s => (
                            <Text key={s.id} className="text-sm" style={{ color: colors.primary }}>• {s.name} - {s.teamName}</Text>
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Sub-Header Actions & Section Create Button */}
            {!isGuardianOnly && (
              <View className="mb-3">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                    {tab === 'teams' ? 'Teams' : 'Assessments & Tryouts'}
                  </Text>
                  <Button
                    label={fabLabel}
                    size="sm"
                    onPress={fabAction}
                  />
                </View>

                {tab === 'assessments' && (
                  <View className="flex-row flex-wrap gap-2 mt-1">
                    <Button
                      label={combineMode ? 'Cancel Combine' : 'Combine Mode'}
                      size="sm"
                      variant={combineMode ? 'primary' : 'secondary'}
                      onPress={() => setCombineMode((m) => !m)}
                    />
                    {combineMode && combineIds.length >= 2 ? (
                      <Button label="View Combined" size="sm" onPress={() => navigation.navigate('Combine')} />
                    ) : null}
                    <Button
                      label="Archived"
                      size="sm"
                      variant="ghost"
                      onPress={() => navigation.navigate('ArchivedAssessments')}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={getEmptyState()}
        renderItem={renderItem}
      />

      <BottomNav active={tab} onTabPress={handleTabChange} />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
