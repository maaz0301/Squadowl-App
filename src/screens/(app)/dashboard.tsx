import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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
  Modal,
  Screen,
} from '@/components/ui';
import { BottomNav } from '@/components/BottomNav';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { useAuthStore, useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useAssignedTryoutsQuery,
  useRejectAssignmentMutation,
  useGuardianRostersQuery,
  useProfileQuery,
  useDeleteTeamMutation,
  useDeleteTryoutMutation,
  useArchiveTryoutMutation,
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

  const { isGuardian } = usePermissions();
  const isGuardianOnly = isGuardian;

  const [combineMode, setCombineMode] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [assignedExpanded, setAssignedExpanded] = useState(true);
  const [actionTryout, setActionTryout] = useState<{ id: string; name: string } | null>(null);
  const [myAthletesExpanded, setMyAthletesExpanded] = useState(isGuardianOnly);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  // Tracks which card is mid delete/archive so the spinner shows immediately and
  // deterministically — relying on the mutation object's own isPending/variables
  // was flaky here because the modal closes (and re-renders the list) in the same
  // tick mutate() fires, before its pending state has propagated.
  const [busyId, setBusyId] = useState<string | null>(null);
  useFocusEffect(() => {
    setNavigatingId(null);
  });

  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const assignedQuery = useAssignedTryoutsQuery();
  const guardianQuery = useGuardianRostersQuery();
  const deleteTeam = useDeleteTeamMutation();
  const deleteTryout = useDeleteTryoutMutation();
  const archiveTryout = useArchiveTryoutMutation();

  const handleDeleteTeam = (id: string, name: string) => {
    Alert.alert(
      'Delete Team',
      `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusyId(id);
            deleteTeam.mutate(id, { onSettled: () => setBusyId(null) });
          },
        },
      ]
    );
  };

  const handleDeleteAssessment = (id: string, name: string) => {
    setActionTryout({ id, name });
  };

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
    setNavigatingId(id);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: id } });
  };

  const openTeam = (id: string) => {
    setNavigatingId(id);
    navigation.navigate('TeamDetail', { id });
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
      const isNavigating = navigatingId === item.id;
      const isDeleting = busyId === item.id;
      return (
        <Pressable onPress={() => openTeam(item.id)} disabled={isDeleting}>
          <Card className="mb-3" style={isDeleting ? { opacity: 0.5 } : undefined}>
            <View className="flex-row justify-between items-center">
              <View className="flex-1 flex-row items-center">
                {item.logoUrl ? (
                  <View className="mr-4">
                    <Avatar uri={item.logoUrl} first="T" last="M" size={48} />
                  </View>
                ) : null}
                <View className="flex-1">
                  <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                    {item.name}
                  </Text>
                  {item.season ? (
                    <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                      {item.season}
                    </Text>
                  ) : null}
                </View>
              </View>
              {isNavigating || isDeleting ? (
                <ActivityIndicator size="small" color={isDeleting ? colors.danger : colors.primary} />
              ) : (
                <Pressable
                  onPress={() => handleDeleteTeam(item.id, item.name)}
                  hitSlop={8}
                  className="p-1"
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
              )}
            </View>
          </Card>
        </Pressable>
      );
    }

    // Assessments
    const selected = combineIds.includes(item.id);
    const isNavigating = navigatingId === item.id;
    const isBusy = busyId === item.id;
    return (
      <Pressable onPress={() => openTryout(item.id)} disabled={isBusy}>
        <Card accent={selected || combineMode} className="mb-3" style={isBusy ? { opacity: 0.5 } : undefined}>
          <View className="flex-row justify-between items-start">
            <View className="flex-1 pr-2">
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
            <View className="items-end gap-2">
              <View className="flex-row items-center gap-2">
                <Badge label={`${item.roster?.length ?? 0} players`} />
                {isNavigating || isBusy ? (
                  <ActivityIndicator size="small" color={isBusy ? colors.danger : colors.primary} />
                ) : (
                <Pressable
                  onPress={() => handleDeleteAssessment(item.id, item.name)}
                  hitSlop={8}
                  className="p-1"
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                )}
              </View>
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
        extraData={[navigatingId, busyId]}
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
                <View className="flex-row gap-3">
                  <Pressable onPress={() => handleTabChange('assessments')} className="flex-1">
                    <Card accent={tab === 'assessments'} className="gap-1 p-3">
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

                  <Pressable onPress={() => handleTabChange('teams')} className="flex-1">
                    <Card accent={tab === 'teams'} className="gap-1 p-3">
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
                </View>
              </View>
            )}

            {!isGuardianOnly ? (
              <>
                <UsageNudgeBanner tier={user?.planTier ?? 'free'} metric="teams" count={teamCount} label="teams" />
                <UsageNudgeBanner
                  tier={user?.planTier ?? 'free'}
                  metric="assessments"
                  count={evalCount}
                  label="assessments"
                />
              </>
            ) : null}

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
                <Pressable
                  onPress={() => setMyAthletesExpanded(!myAthletesExpanded)}
                  className="flex-row items-center justify-between py-2 mb-1"
                  hitSlop={8}
                >
                  <Text
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: colors.inkMuted }}
                  >
                    My Athletes
                  </Text>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path
                      d={myAthletesExpanded ? "M6 9l6 6 6-6" : "M9 5l7 7-7 7"}
                      stroke={colors.inkMuted}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Pressable>

                {myAthletesExpanded && guardianQuery.data.map((ath) => (
                  <Pressable key={ath.id} onPress={() => navigation.navigate('GuardianPortal', { playerId: ath.id })}>
                    <Card accent className="mb-3 px-4 py-4 border-l-4" style={{ borderLeftColor: colors.primary }}>
                      <View className="flex-row items-center justify-between mb-3">
                        <View className="flex-row items-center gap-3">
                          <Avatar
                            first={ath.firstName}
                            last={ath.lastName}
                            size={44}
                          />
                          <View>
                            <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                              {ath.firstName} {ath.lastName}
                            </Text>
                            <Text className="text-sm font-medium" style={{ color: colors.primary }}>
                              View Athlete Profile
                            </Text>
                          </View>
                        </View>
                        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                          <Path d="M9 5l7 7-7 7" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </View>
                      
                      <View className="h-[1px] w-full mb-3" style={{ backgroundColor: colors.border }} />

                      {ath.tryouts.length === 0 && ath.seasons.length === 0 ? (
                        <Text className="text-sm italic" style={{ color: colors.inkMuted }}>
                          No active tryouts or seasons assigned yet.
                        </Text>
                      ) : (
                        <View className="gap-3">
                          {ath.tryouts.length > 0 ? (
                            <View className="flex-row items-start gap-2">
                              <Badge label="Tryouts" variant="brand" className="mt-0.5" />
                              <View className="flex-1 flex-row flex-wrap gap-2 pt-1">
                                {ath.tryouts.map(t => (
                                  <Text key={t.participantId} className="text-sm" style={{ color: colors.ink }}>
                                    • {t.name}
                                  </Text>
                                ))}
                              </View>
                            </View>
                          ) : null}

                          {ath.seasons.length > 0 ? (
                            <View className="flex-row items-start gap-2">
                              <Badge label="Seasons" variant="info" className="mt-0.5" />
                              <View className="flex-1 flex-row flex-wrap gap-2 pt-1">
                                {ath.seasons.map(s => (
                                  <Text key={s.id} className="text-sm" style={{ color: colors.ink }}>
                                    • {s.name}
                                  </Text>
                                ))}
                              </View>
                            </View>
                          ) : null}
                        </View>
                      )}
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

      <Modal
        visible={!!actionTryout}
        title="Assessment Actions"
        onClose={() => setActionTryout(null)}
      >
        <View className="gap-3">
          <Text className="text-base mb-4" style={{ color: colors.inkMuted }}>
            What would you like to do with "{actionTryout?.name}"?
          </Text>
          <Button
            label="Archive Assessment"
            variant="secondary"
            onPress={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                archiveTryout.mutate(actionTryout.id, { onSettled: () => setBusyId(null) });
              }
              setActionTryout(null);
            }}
          />
          <Button
            label="Delete Permanently"
            variant="danger"
            onPress={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                deleteTryout.mutate(actionTryout.id, { onSettled: () => setBusyId(null) });
              }
              setActionTryout(null);
            }}
          />
        </View>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
