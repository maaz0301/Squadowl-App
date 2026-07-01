import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

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
  Tabs,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useAuthStore, useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useSeasonsQuery,
  useAssignedTryoutsQuery,
} from '@/features/queries';
import { APP_CONFIG } from '@/config/app';
import { canUseFeature, isAtAssessmentLimit } from '@/data/plans';

function OnboardingChecklist() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  if (!user || user.onboardingCompleted) return null;

  const steps = [
    {
      key: 'createTeam',
      label: 'Create a team',
      done: user.onboardingSteps.createTeam,
      action: () => navigation.navigate('NewTeam'),
    },
    {
      key: 'createAssessment',
      label: 'Create an assessment',
      done: user.onboardingSteps.createAssessment,
      action: () => navigation.navigate('NewAssessment'),
    },
    {
      key: 'inviteAssessors',
      label: 'Invite assessors',
      done: user.onboardingSteps.inviteAssessors,
      action: () => {
        const tryout = useSessionStore.getState().currentTryoutId;
        if (tryout) navigation.navigate('AssessmentFlow', { screen: 'AssessmentSettings', params: { id: tryout } });
        else navigation.navigate('NewAssessment');
      },
    },
    {
      key: 'addPlayers',
      label: 'Add players',
      done: user.onboardingSteps.addPlayers,
      action: () => {
        const tryout = useSessionStore.getState().currentTryoutId;
        if (tryout) navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: tryout } });
        else navigation.navigate('NewAssessment');
      },
    },
    {
      key: 'scorePlayers',
      label: 'Score players',
      done: user.onboardingSteps.scorePlayers,
      action: () => {
        const tryout = useSessionStore.getState().currentTryoutId;
        if (tryout) navigation.navigate('AssessmentFlow', { screen: 'AssessmentRinkside', params: { id: tryout } });
        else navigation.navigate('NewAssessment');
      },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card accent className="mb-4 gap-3">
      <View className="flex-row justify-between items-center">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Getting Started
        </Text>
        <Badge label={`${doneCount}/${steps.length}`} variant="brand" />
      </View>
      {steps.map((s) => (
        <Pressable key={s.key} onPress={s.done ? undefined : s.action} className="flex-row items-center gap-3">
          <Text style={{ color: s.done ? colors.success : colors.inkMuted }}>{s.done ? '✓' : '○'}</Text>
          <Text style={{ color: s.done ? colors.inkMuted : colors.ink }}>{s.label}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

export default function DashboardScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const toggleCombineTryout = useSessionStore((s) => s.toggleCombineTryout);
  const [tab, setTab] = useState('assessments');
  const [combineMode, setCombineMode] = useState(false);

  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const seasonsQuery = useSeasonsQuery();
  const assignedQuery = useAssignedTryoutsQuery();

  const openAssigned = (id: string) => {
    setCurrentTryout(id);
    setActiveAssessor(user?.displayName ?? null);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRinkside', params: { id: id } });
  };

  if (teamsQuery.isLoading || tryoutsQuery.isLoading || seasonsQuery.isLoading) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <ErrorState
        message="Could not load dashboard data."
        onRetry={() => {
          teamsQuery.refetch();
          tryoutsQuery.refetch();
          seasonsQuery.refetch();
        }}
      />
    );
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
    if (tab === 'seasons') navigation.navigate('NewSeason');
    else if (tab === 'teams') navigation.navigate('NewTeam');
    else {
      const count = tryoutsQuery.data?.length ?? 0;
      if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
        navigation.navigate('Upgrade');
        return;
      }
      navigation.navigate('NewAssessment');
    }
  };

  const fabLabel =
    tab === 'seasons' ? '+ New Season' : tab === 'teams' ? '+ New Team' : '+ New Assessment';

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header
          title={APP_CONFIG.appName}
          subtitle={`Hi, ${user?.displayName ?? 'Coach'}`}
          right={
            <View className="flex-row items-center gap-2">
              <Pressable onPress={() => navigation.navigate('Search')} hitSlop={8}>
                <Badge label="Search" variant="info" />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('Profile')}
                hitSlop={8}
                accessibilityLabel="Profile and settings"
              >
                <Avatar
                  first={(user?.displayName ?? 'Coach').split(' ')[0] ?? 'C'}
                  last={(user?.displayName ?? '').split(' ')[1] ?? ''}
                  size={40}
                />
              </Pressable>
            </View>
          }
        />
        <OnboardingChecklist />
        {assignedQuery.data && assignedQuery.data.length > 0 ? (
          <View className="mb-4">
            <Text
              className="text-xs font-bold uppercase tracking-wider mb-2"
              style={{ color: colors.inkMuted }}
            >
              Assigned to me
            </Text>
            {assignedQuery.data.map((t) => (
              <Pressable key={t.id} onPress={() => openAssigned(t.id)}>
                <Card className="mb-2 flex-row justify-between items-center">
                  <View className="flex-1">
                    <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
                      {t.name}
                    </Text>
                    <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                      {t.sport} · {t.roster.length} players
                    </Text>
                  </View>
                  <Badge label="Score" variant="brand" />
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Tabs
          tabs={[
            { key: 'assessments', label: 'Assessments', badge: tryoutsQuery.data?.length },
            { key: 'seasons', label: 'Team Hub', badge: seasonsQuery.data?.length },
            { key: 'teams', label: 'Teams', badge: teamsQuery.data?.length },
          ]}
          activeKey={tab}
          onChange={setTab}
          className="mb-2"
        />
        {tab === 'assessments' ? (
          <View className="flex-row flex-wrap gap-2 mb-2">
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
        ) : null}
      </View>

      {tab === 'seasons' ? (
        <FlatList
          data={seasonsQuery.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No seasons yet"
              message={
                canUseFeature(user?.planTier ?? 'free', 'seasonHub')
                  ? 'Create a season to manage schedule, roster, and guardian portals.'
                  : 'Upgrade to Coach plan for Team Hub / Season Builder.'
              }
              actionLabel={canUseFeature(user?.planTier ?? 'free', 'seasonHub') ? 'Create Season' : 'View Plans'}
              onAction={() =>
                canUseFeature(user?.planTier ?? 'free', 'seasonHub')
                  ? navigation.navigate('NewSeason')
                  : navigation.navigate('Upgrade')
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('SeasonDetail', { id: item.id })}>
              <Card accent className="mb-3">
                <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                  {item.name}
                </Text>
                <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                  {item.teamName} · {item.sport} · {item.year}
                </Text>
                <View className="flex-row gap-2 mt-2">
                  <Badge label={`${item.roster.length} players`} />
                  <Badge label={`${item.events.length} events`} variant="info" />
                </View>
              </Card>
            </Pressable>
          )}
        />
      ) : tab === 'teams' ? (
        <FlatList
          data={teamsQuery.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No teams yet"
              message="Create a team to organize your assessments."
              actionLabel="Create Team"
              onAction={() => navigation.navigate('NewTeam')}
            />
          }
          renderItem={({ item }) => (
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
          )}
        />
      ) : (
        <FlatList
          data={tryoutsQuery.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No assessments yet"
              message="Create your first tryout or assessment to get started."
              actionLabel="Create Assessment"
              onAction={() => navigation.navigate('NewAssessment')}
            />
          }
          renderItem={({ item }) => {
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
                      <Badge label={`${item.roster.length} players`} />
                      {selected ? <Badge label="Selected" variant="brand" /> : null}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}

      <View className="absolute bottom-6 left-4 right-4">
        <Button label={fabLabel} onPress={fabAction} />
      </View>
    </Screen>
  );
}
