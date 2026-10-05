import { useTerms, sportLabel } from '@/lib/terms';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Modal,
  Screen,
  TypeToConfirmModal,
  useTypeToConfirm,
} from '@/components/ui';
import { BottomNav } from '@/components/BottomNav';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeTopBar } from '@/components/home/HomeTopBar';
import { HubIcon } from '@/components/teamHub/HubIcon';
import { HUB_ICONS } from '@/components/teamHub/hubTheme';
import { HomeEmptyCard } from '@/components/home/HomeEmptyCard';
import { HomePanel, PanelRow } from '@/components/home/HomePanel';
import { QuickAccessGrid, type QuickAccessItem } from '@/components/home/QuickAccessGrid';
import { SectionHeader } from '@/components/home/SectionHeader';
import { FeatureBlockGate } from '@/components/FeatureBlockGate';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { EditEvaluationModal } from '@/components/assessment/EditEvaluationModal';
import type { TryoutSummary } from '@/data/types';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { SubscriptionEndingBanner } from '@/components/SubscriptionEndingBanner';
import { useAuthStore, useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutSummariesQuery,
  useAssignedTryoutSummariesQuery,
  useAcceptAssignmentMutation,
  useRejectAssignmentMutation,
  useGuardianRostersQuery,
  useProfileQuery,
  useArchiveTeamMutation,
  useDeleteTeamMutation,
  useDeleteTryoutMutation,
  useArchiveTryoutMutation,
  usePrefetchTryout,
  usePlatformBlockedFeaturesQuery,
  useRemoveGuardianAthleteMutation,
} from '@/features/queries';
import { APP_CONFIG } from '@/config/app';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { canUseFeature, isAtAssessmentLimit, isAtTeamLimit } from '@/data/plans';
import { teamBrandSurfaces } from '@/lib/teamBrand';
import { buildLimitReachedMessage } from '@/lib/usageNudges';

/** Athletes shown before "View All" on the home screen. */
const MY_ATHLETES_PREVIEW = 3;

export default function DashboardScreen() {
  const terms = useTerms();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
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
    // Keyed on the params object, not the tab value: navigating with the same
    // tab again (after the user switched tabs by hand) must still re-apply it.
  }, [route.params]);

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
  // Hub sections the founder has turned off — either for this account, or for
  // the whole platform at once (see src/lib/blockableFeatures.ts).
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const blockedFeatures = new Set(platformBlockedFeatures ?? []);

  const [combineMode, setCombineMode] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [assignedExpanded, setAssignedExpanded] = useState(true);
  const [actionTryout, setActionTryout] = useState<{ id: string; name: string } | null>(null);
  // The evaluation whose details are open in the tile's edit dialog.
  const [editingTryout, setEditingTryout] = useState<TryoutSummary | null>(null);
  const [myAthletesExpanded, setMyAthletesExpanded] = useState(isGuardianOnly);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  // Tracks which card is mid delete/archive so the spinner shows immediately and
  // deterministically — relying on the mutation object's own isPending/variables
  // was flaky here because the modal closes (and re-renders the list) in the same
  // tick mutate() fires, before its pending state has propagated.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Memoised: useFocusEffect re-runs whenever the callback changes, and an inline
  // one would clear navigatingId on the very render that set it, so the card's
  // spinner never showed.
  useFocusEffect(
    useCallback(() => {
      setNavigatingId(null);
    }, []),
  );

  const teamsQuery = useTeamsQuery();
  // Summaries, not full tryouts: these cards show a name, a sport, a date and a
  // headcount, and the full read drags every roster, evaluation, score and
  // registration in the account along with it. See useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const assignedQuery = useAssignedTryoutSummariesQuery();
  const guardianQuery = useGuardianRostersQuery();
  const removeGuardianAthlete = useRemoveGuardianAthleteMutation();
  const removeAthleteConfirm = useTypeToConfirm();
  const deleteTeam = useDeleteTeamMutation();
  const [teamToDelete, setTeamToDelete] = useState<{ id: string; name: string } | null>(null);
  const archiveTeam = useArchiveTeamMutation();
  const deleteTryout = useDeleteTryoutMutation();
  const archiveTryout = useArchiveTryoutMutation();
  const acceptAssignment = useAcceptAssignmentMutation();
  const rejectAssignment = useRejectAssignmentMutation();
  const prefetchTryout = usePrefetchTryout();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Pull down to re-read everything this screen shows.
  const refreshControl = usePullToRefresh(() =>
    Promise.all([teamsQuery.refetch(), tryoutsQuery.refetch(), assignedQuery.refetch(), guardianQuery.refetch()]),
  );

  const handleArchiveTeam = (id: string, name: string) => {
    Alert.alert(
      'Archive Team',
      `Archive "${name}"? It moves to the Archived page with its roster and schedule, and you can restore it any time your plan has room.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            setBusyId(id);
            try {
              await archiveTeam.mutateAsync(id);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not archive this team.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeleteTeam = (id: string, name: string) => setTeamToDelete({ id, name });

  const confirmDeleteTeam = async () => {
    if (!teamToDelete) return;
    const { id } = teamToDelete;
    setTeamToDelete(null);
    setBusyId(id);
    try {
      await deleteTeam.mutateAsync(id);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not delete this team.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAssessment = (id: string, name: string) => {
    setActionTryout({ id, name });
  };

  const openAssigned = (id: string) => {
    // Kick the fetch off now so it runs during the navigation animation
    // rather than after the roster has already mounted empty.
    prefetchTryout(id);
    setCurrentTryout(id);
    setAssessorOnlyTryout(id);
    setActiveAssessor(user?.displayName ? { name: user.displayName, email: user.email, role: 'assessor', status: 'accepted' } : null);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: id, isAssessorOnly: true } });
  };

  const acceptAssigned = (id: string) => {
    setAcceptingId(id);
    acceptAssignment.mutate(id, {
      onSettled: () => setAcceptingId(null),
      onSuccess: () => openAssigned(id),
      onError: (error: any) => Alert.alert('Accept Failed', error?.message || 'Could not accept this evaluation.'),
    });
  };

  const declineAssigned = (id: string, name: string) => {
    Alert.alert(
      'Decline Evaluation',
      `Are you sure you want to decline "${name}"? You will lose access to score this evaluation unless invited again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => {
            setDecliningId(id);
            rejectAssignment.mutate(id, {
              onSettled: () => setDecliningId(null),
              onError: (error: any) => Alert.alert('Decline Failed', error?.message || 'Could not decline this evaluation.'),
            });
          },
        },
      ]
    );
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

  if (!isGuardianOnly) {
    const currentTabFeature = tab === 'teams' ? 'teams' : 'evaluations';
    if (blockedFeatures.has(currentTabFeature)) {
      return (
        <Screen padded={false} keyboardAvoiding={false}>
          <View className="flex-1 px-4 pt-2">
            <Header title={APP_CONFIG.appName} subtitle={`Hi, ${user?.displayName ?? 'Coach'}`} />
            <FeatureBlockGate feature={currentTabFeature} />
          </View>
          <BottomNav active={tab} onTabPress={handleTabChange} />
        </Screen>
      );
    }
  }

  const openTryout = (id: string) => {
    if (combineMode) {
      toggleCombineTryout(id);
      return;
    }
    prefetchTryout(id);
    setCurrentTryout(id);
    setAssessorOnlyTryout(null);
    setNavigatingId(id);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: id } });
  };

  const openTeam = (id: string) => {
    setNavigatingId(id);
    navigation.navigate('TeamDetail', { id });
  };

  const fabAction = () => {
    if (tab === 'teams') {
      // Teams delegated by a club don't consume this account's own allowance.
      if (isAtTeamLimit(user?.planTier ?? 'free', ownedTeamCount, user?.extraTeamLicenses ?? 0)) {
        setLimitMsg(
          buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0)
        );
        return;
      }
      navigation.navigate('NewTeam');
    } else {
      const count = tryoutsQuery.data?.length ?? 0;
      if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
        setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'evaluations'));
        return;
      }
      navigation.navigate('NewAssessment');
    }
  };

  const fabLabel = tab === 'teams' ? '+ New Team' : '+ New Evaluation';

  // The Evaluations list is for standalone evaluations. One created for a team
  // lives on that team's own Evaluations tab, so showing it here as well made it
  // look like it belonged to both. Only hidden when its team is one this user
  // can actually open — an evaluation pointing at a team that isn't in their list
  // would otherwise be unreachable from anywhere.
  const visibleTeamIds = new Set((teamsQuery.data ?? []).map((t) => t.id));
  const standaloneTryouts = (tryoutsQuery.data ?? []).filter((t) => !t.teamId || !visibleTeamIds.has(t.teamId));

  const listData = isGuardianOnly ? [] : tab === 'teams' ? teamsQuery.data : standaloneTryouts;

  const renderItem = ({ item }: { item: any }) => {
    if (tab === 'teams') {
      const isNavigating = navigatingId === item.id;
      const isDeleting = busyId === item.id;
      return (
        <Pressable onPress={() => openTeam(item.id)} disabled={isDeleting}>
          <Card
            className="mb-3"
            style={[
              // Teams are recognized by their colour before their name, so the
              // dashboard card carries it too — a left edge in the team's
              // colour plus the same tint its own screens use.
              item.brandColor
                ? { backgroundColor: teamBrandSurfaces(item.brandColor, colors).cardBg,
                    borderLeftWidth: 4,
                    borderLeftColor: item.brandColor }
                : null,
              isDeleting ? { opacity: 0.5 } : null,
            ]}
          >
            <View className="flex-row justify-between items-center">
              <View className="flex-1 flex-row items-center">
                {item.logoUrl ? (
                  <View className="mr-4">
                    <Avatar uri={item.logoUrl} first="T" last="M" size={48} />
                  </View>
                ) : null}
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                      {item.name}
                    </Text>
                    {/* Delegated to this user by a club — not one of their own. */}
                    {item.managed ? <Badge label="Managed" /> : null}
                  </View>
                  {item.season ? (
                    <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                      {item.season}
                    </Text>
                  ) : null}
                </View>
              </View>
              {isNavigating || isDeleting ? (
                <ActivityIndicator size="small" color={isDeleting ? colors.danger : colors.primary} />
              ) : item.managed ? null : (
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => handleArchiveTeam(item.id, item.name)}
                    hitSlop={8}
                    className="p-1"
                    accessibilityLabel="Archive team"
                  >
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke={colors.inkMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteTeam(item.id, item.name)}
                    hitSlop={8}
                    className="p-1"
                    accessibilityLabel="Delete team"
                  >
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                </View>
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
            <View
              className="items-center justify-center rounded-md"
              style={{ width: 36, height: 36, marginRight: 12, backgroundColor: 'rgba(255,107,43,0.12)' }}
            >
              <HubIcon d={HUB_ICONS.clipboard} size={20} color={colors.primary} />
            </View>
            <View className="flex-1 pr-2">
              <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                {item.name}
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                {sportLabel(item.sport, terms)} · {item.eventType}
              </Text>
              {item.tryoutDate ? (
                <Text className="text-sm" style={{ color: colors.inkFaint }}>
                  {item.tryoutDate} {item.startTime ? `· ${item.startTime}` : ''}
                </Text>
              ) : null}
            </View>
            <View className="items-end gap-2">
              <View className="flex-row items-center gap-2">
                <Badge label={`${item.playerCount} ${item.playerCount === 1 ? 'player' : 'players'}`} />
                {isNavigating || isBusy ? (
                  <ActivityIndicator size="small" color={isBusy ? colors.danger : colors.primary} />
                ) : (
                <>
                <Pressable
                  onPress={() => setEditingTryout(item)}
                  hitSlop={8}
                  className="p-1"
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.name}`}
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke={colors.inkMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                <Pressable
                  onPress={() => handleDeleteAssessment(item.id, item.name)}
                  hitSlop={8}
                  className="p-1"
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                </>
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
        <HomeEmptyCard
          icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          title="No teams created"
          message="Create a team to group rosters, schedule practices and games, and manage evaluations."
        />
      );
    }
    return (
      <HomeEmptyCard
        icon="M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z"
        title="No evaluations yet"
        message="Create your first tryout or evaluation to begin scoring players."
      />
    );
  };

  // The tile and the list agree on standalone evaluations; the plan-limit nudge
  // below still counts every evaluation the account owns, team-linked included.
  const evalCount = standaloneTryouts.length;
  const totalEvalCount = tryoutsQuery.data?.length ?? 0;
  // Visible count: every team the user can see, including ones delegated to
  // them. Distinct from ownedTeamCount below, which feeds the plan-limit
  // nudge/gate — delegated teams don't consume this account's own allowance.
  const teamCount = (teamsQuery.data ?? []).length;
  const ownedTeamCount = (teamsQuery.data ?? []).filter((t) => !t.managed).length;

  const quickAccessCandidates: (QuickAccessItem | null)[] = [
    !blockedFeatures.has('evaluations')
      ? {
          key: 'evaluations',
          label: 'Evaluations',
          caption: 'Create and manage your tryouts and evaluations',
          icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
          active: tab === 'assessments',
          onPress: () => handleTabChange('assessments'),
        }
      : null,
    !blockedFeatures.has('teams')
      ? {
          key: 'teams',
          label: 'Teams',
          caption: 'Manage rosters, schedules and team details',
          icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
          active: tab === 'teams',
          onPress: () => handleTabChange('teams'),
        }
      : null,
    !blockedFeatures.has('evaluations')
      ? {
          key: 'reports',
          label: 'Reports',
          caption: 'View comparisons, analytics and export results',
          icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
          onPress: () => navigation.navigate('Reports'),
        }
      : null,
    {
      key: 'athletes',
      label: 'Athletes',
      caption: 'Add, manage and track athlete profiles',
      icon: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6',
      onPress: () => navigation.navigate('SharedAthletes'),
    },
  ];
  const quickAccessItems = quickAccessCandidates.filter((i): i is QuickAccessItem => i !== null);

  return (
    // No text field lives on this screen (the edit/action sheets are their own
    // windows and handle the keyboard themselves), so the Screen's Android
    // KeyboardAvoidingView has nothing to do here. Left on, it can stay shrunk
    // after a sheet has opened and closed, leaving a dead strip under the bottom bar.
    <Screen padded={false} keyboardAvoiding={false}>
      {removeAthleteConfirm.modal}
      <TypeToConfirmModal
        visible={!!teamToDelete}
        title="Delete Team"
        message={`Are you sure you want to delete "${teamToDelete?.name ?? ''}"? This action cannot be undone.`}
        onConfirm={confirmDeleteTeam}
        onCancel={() => setTeamToDelete(null)}
      />
      <FlatList
        key={isGuardianOnly ? 'guardian' : 'coach'}
        ref={listRef}
        refreshControl={refreshControl}
        // The evaluation/team cards render inside the section panel in the header
        // (see below), so the list itself has no rows of its own.
        data={[] as any[]}
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
            <HomeTopBar
              onSearch={isGuardianOnly ? undefined : () => navigation.navigate('Search')}
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

            {/* Compact brand banner — a strip, not a splash, so the sections below
                stay above the fold. */}
            {!isGuardianOnly && (
              <View className="mb-6">
                <HomeHero />
              </View>
            )}

            {/* Enterprise entry point — full width above the jump-point row, which
                scrolls horizontally and would push a fourth card off-screen. */}
            {!isGuardianOnly && !blockedFeatures.has('dashboard') && canUseFeature(user?.planTier ?? 'free', 'enterprise') ? (
              <Pressable onPress={() => navigation.navigate('Enterprise')} className="mb-6">
                <Card className="flex-row items-center gap-3">
                  <View
                    className="items-center justify-center rounded-md"
                    style={{ width: 36, height: 36, backgroundColor: 'rgba(255,107,43,0.12)' }}
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" stroke={colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                  <View className="flex-1">
                    <Text className="font-bold text-base" style={{ color: colors.ink }}>
                      Dashboard
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

            {/* Quick Access — the hub's shortcuts, all in one card style. */}
            {!isGuardianOnly && quickAccessItems.length > 0 && (
              <View className="mb-6">
                <SectionHeader label="Quick Access" />
                <QuickAccessGrid items={quickAccessItems} />
              </View>
            )}

            {!isGuardianOnly ? <SubscriptionEndingBanner /> : null}

            {!isGuardianOnly ? (
              tab === 'teams' ? (
                <UsageNudgeBanner tier={user?.planTier ?? 'free'} metric="teams" count={ownedTeamCount} label="teams" />
              ) : (
                <UsageNudgeBanner
                  tier={user?.planTier ?? 'free'}
                  metric="assessments"
                  count={totalEvalCount}
                  label="evaluations"
                />
              )
            ) : null}

            {/* Assigned Tryouts — assessments only. This is a tryout assignment
                (assessor status on a tryout), which has no meaning on the
                Teams tab; it used to render under both because nothing here
                checked `tab` at all. */}
            {tab === 'assessments' && assignedQuery.data && assignedQuery.data.length > 0 ? (
              <View className="mb-6">
                <SectionHeader
                  label="Assigned to me"
                  expanded={assignedExpanded}
                  onToggle={() => setAssignedExpanded(!assignedExpanded)}
                />
                {assignedExpanded && assignedQuery.data.map((t) => {
                  const mine = t.assessors.find(
                    (a) => (user?.id && a.userId === user.id) || a.email?.toLowerCase() === user?.email?.toLowerCase()
                  );
                  const isPending = (mine?.status ?? 'pending') === 'pending';
                  return (
                    <Card key={t.id} className="mb-3 gap-3">
                      <Pressable onPress={() => openAssigned(t.id)} className="flex-row justify-between items-center">
                        <View className="flex-1">
                          <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
                            {t.name}
                          </Text>
                          <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                            {sportLabel(t.sport, terms)} · {t.playerCount} {(t.playerCount === 1 ? terms.player : terms.players).toLowerCase()}
                          </Text>
                        </View>
                        <Badge label="Score" variant="brand" />
                      </Pressable>
                      {isPending ? (
                        <View className="flex-row gap-2">
                          <Button
                            label="Accept"
                            size="sm"
                            className="flex-1"
                            loading={acceptingId === t.id}
                            onPress={() => acceptAssigned(t.id)}
                          />
                          <Button
                            label="Decline"
                            size="sm"
                            variant="ghost"
                            className="flex-1"
                            loading={decliningId === t.id}
                            onPress={() => declineAssigned(t.id, t.name)}
                          />
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            ) : null}

            {/* Guardian View */}
            {guardianQuery.data && guardianQuery.data.length > 0 && !blockedFeatures.has('myAthletes') ? (
              <View className="mb-6">
                <HomePanel
                  icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  label="My Athletes"
                  right={
                    guardianQuery.data.length > MY_ATHLETES_PREVIEW ? (
                      <Pressable
                        onPress={() => setMyAthletesExpanded(!myAthletesExpanded)}
                        hitSlop={8}
                        className="flex-row items-center gap-1"
                      >
                        <Text className="text-xs font-bold" style={{ color: colors.primary }}>
                          {myAthletesExpanded ? 'Show Less' : 'View All'}
                        </Text>
                        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                          <Path d="M9 5l7 7-7 7" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </Pressable>
                    ) : undefined
                  }
                >
                  <View className="gap-2">
                    {(myAthletesExpanded ? guardianQuery.data : guardianQuery.data.slice(0, MY_ATHLETES_PREVIEW)).map((ath) => (
                      <Pressable key={ath.id} onPress={() => navigation.navigate('GuardianPortal', { playerId: ath.id })}>
                        <PanelRow>
                          <View
                            className="items-center justify-center rounded-full"
                            style={{ width: 40, height: 40, borderWidth: 1.5, borderColor: colors.primary }}
                          >
                            <Avatar first={ath.firstName} last={ath.lastName} size={32} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-base font-display font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                              {ath.firstName} {ath.lastName}
                            </Text>
                            <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                              {ath.seasons.length === 0
                                ? 'No active seasons yet'
                                : ath.seasons.map((s) => s.name).join(' · ')}
                            </Text>
                          </View>
                          <Pressable
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${ath.firstName} ${ath.lastName}`}
                            disabled={removeGuardianAthlete.isPending}
                            onPress={() =>
                              removeAthleteConfirm.ask({
                                title: 'Delete Athlete',
                                message: `Remove ${ath.firstName} ${ath.lastName} from My Athletes? Their team and evaluation records stay with the coach.`,
                                onConfirm: () =>
                                  removeGuardianAthlete.mutate(ath.id, {
                                    onError: (e: any) =>
                                      Alert.alert('Could Not Delete', e?.message || 'Something went wrong.'),
                                  }),
                              })
                            }
                          >
                            <Text className="text-xs font-bold" style={{ color: colors.danger }}>Delete</Text>
                          </Pressable>
                          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                            <Path d="M9 5l7 7-7 7" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                          </Svg>
                        </PanelRow>
                      </Pressable>
                    ))}
                  </View>
                </HomePanel>
              </View>
            ) : null}

            {/* Guardians have no bottom menu, so the Library gets its own row on
                their home screen, whether or not any athlete is linked yet. */}
            {isGuardianOnly ? (
              <View className="mb-6">
                <HomePanel
                  icon="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"
                  label="Library"
                >
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Library')}>
                    <PanelRow>
                      <View className="flex-1">
                        <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
                          Files, notes and videos
                        </Text>
                        <Text className="text-xs" style={{ color: colors.inkMuted }}>
                          Shared with you by the club
                        </Text>
                      </View>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                        <Path d="M9 5l7 7-7 7" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </PanelRow>
                  </Pressable>
                </HomePanel>
              </View>
            ) : null}

            {/* Section panel: header, actions and — when there's nothing to list
                yet, the empty state, all inside one container. Items follow as
                their own cards below. */}
            {!isGuardianOnly && (
              <View className="mb-3">
                <HomePanel
                  icon={
                    tab === 'teams'
                      ? 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z'
                      : 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z'
                  }
                  label={tab === 'teams' ? 'Teams' : 'Evaluations & Tryouts'}
                  right={<Button label={fabLabel} size="sm" onPress={fabAction} />}
                >
                  {tab === 'assessments' && (
                    <View className="flex-row flex-wrap gap-2">
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
                  {(listData ?? []).length === 0 ? (
                    getEmptyState()
                  ) : (
                    // Cancels the last card's bottom margin so the panel's own padding sets the gap.
                    <View style={{ marginTop: tab === 'assessments' ? 12 : 0, marginBottom: -12 }}>
                      {(listData ?? []).map((item: any) => (
                        <View key={item.id}>{renderItem({ item })}</View>
                      ))}
                    </View>
                  )}
                </HomePanel>
              </View>
            )}
          </View>
        }
        renderItem={() => null}
      />

      <BottomNav active={tab} onTabPress={handleTabChange} />

      <Modal
        visible={!!actionTryout}
        title="Evaluation Actions"
        onClose={() => setActionTryout(null)}
      >
        <View className="gap-3">
          <Text className="text-base mb-4" style={{ color: colors.inkMuted }}>
            What would you like to do with "{actionTryout?.name}"?
          </Text>
          <Button
            label="Archive Evaluation"
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
              const target = actionTryout;
              setActionTryout(null);
              if (!target) return;
              // Let the actions sheet finish closing before the confirm opens.
              setTimeout(() => {
                removeAthleteConfirm.ask({
                  title: 'Delete Evaluation',
                  message: `Permanently delete "${target.name}" and all of its scores? This can't be undone.`,
                  onConfirm: () => {
                    setBusyId(target.id);
                    deleteTryout.mutate(target.id, { onSettled: () => setBusyId(null) });
                  },
                });
              }, 350);
            }}
          />
        </View>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
      <EditEvaluationModal tryout={editingTryout} onClose={() => setEditingTryout(null)} />
    </Screen>
  );
}
