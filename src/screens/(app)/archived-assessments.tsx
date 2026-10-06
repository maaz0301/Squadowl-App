import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
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
} from '@/components/ui';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { isAtAssessmentLimit, isAtTeamLimit, ownedTryouts } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useUser } from '@/state/authStore';
import {
  useArchivedTeamsQuery,
  useRestoreTeamMutation,
  useRestoreTryoutMutation,
  useTeamsQuery,
  useTryoutsQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';

/**
 * Everything archived, in one place: evaluations and teams the coach archived or
 * a plan downgrade retired (deleted teams are not listed — they stay gone).
 * Restores are held to the plan's limits, so one only works once the plan has
 * room for it again.
 */
export default function ArchivedAssessmentsScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  // Card fields only — see useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(true);
  // The live evaluations, which is what the plan's evaluation limit counts.
  const activeTryoutsQuery = useTryoutsQuery();
  const archivedTeamsQuery = useArchivedTeamsQuery();
  const teamsQuery = useTeamsQuery();
  const restoreTryout = useRestoreTryoutMutation();
  const restoreTeam = useRestoreTeamMutation();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // The mutations are shared across rows, so track which card fired one.
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (
    tryoutsQuery.isLoading ||
    activeTryoutsQuery.isLoading ||
    archivedTeamsQuery.isLoading ||
    teamsQuery.isLoading
  ) {
    return <LoadingState message="Loading archived..." />;
  }
  if (tryoutsQuery.isError || activeTryoutsQuery.isError || archivedTeamsQuery.isError || teamsQuery.isError) {
    return (
      <Screen padded>
        <Header title="Archived" showBack />
        <ErrorState
          message="Could not load archived items."
          onRetry={() => {
            void tryoutsQuery.refetch();
            void activeTryoutsQuery.refetch();
            void archivedTeamsQuery.refetch();
            void teamsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const tier = user?.planTier ?? 'free';
  const licenses = user?.extraTeamLicenses ?? 0;
  const archived = (tryoutsQuery.data ?? []).filter((t) => t.archived);
  const archivedTeams = archivedTeamsQuery.data ?? [];
  // Delegated teams belong to the club that pays for them, not to this plan.
  const activeTeamCount = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
  const busy = restoreTryout.isPending || restoreTeam.isPending;

  const handleRestoreTryout = async (id: string) => {
    // Restoring adds a live evaluation, so it is held to the plan limit the
    // same way creating one is — otherwise a downgrade's archive could be undone
    // on the spot.
    if (isAtAssessmentLimit(tier, ownedTryouts(activeTryoutsQuery.data ?? [], teamsQuery.data ?? []).length)) {
      setLimitMsg(buildLimitReachedMessage(tier, 'assessments', 'evaluations'));
      return;
    }
    setRestoringId(id);
    try {
      await restoreTryout.mutateAsync(id);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not restore the evaluation.');
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreTeam = async (id: string) => {
    if (isAtTeamLimit(tier, activeTeamCount, licenses)) {
      setLimitMsg(buildLimitReachedMessage(tier, 'teams', 'teams', licenses));
      return;
    }
    setRestoringId(id);
    try {
      await restoreTeam.mutateAsync(id);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not restore the team.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Archived" showBack />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}>
        {archived.length === 0 && archivedTeams.length === 0 ? (
          <EmptyState
            title="Nothing archived"
            message="Evaluations and teams you archive, or that a plan change archives, will appear here. You can restore them at any time your plan has room."
          />
        ) : null}

        {archived.length > 0 ? (
          <View className="mb-6">
            <Text
              className="text-xs font-bold uppercase mb-3"
              style={{ color: colors.inkMuted, letterSpacing: 0.8 }}
            >
              Evaluations
            </Text>
            {archived.map((item) => (
              <Card key={item.id} className="mb-3 gap-2">
                <Pressable
                  onPress={() =>
                    navigation.navigate('AssessmentFlow', { screen: 'AssessmentSettings', params: { id: item.id } })
                  }
                >
                  <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                    {item.name}
                  </Text>
                  <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                    {item.sport} · {item.playerCount} players
                  </Text>
                </Pressable>
                <View className="flex-row gap-2 mt-2">
                  <Badge
                    label={item.archivedReason === 'plan_downgrade' ? 'Archived · plan change' : 'Archived'}
                    variant="warning"
                  />
                  <Button
                    label="Restore"
                    size="sm"
                    loading={restoringId === item.id}
                    disabled={busy}
                    onPress={() => handleRestoreTryout(item.id)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {archivedTeams.length > 0 ? (
          <View>
            <Text
              className="text-xs font-bold uppercase mb-3"
              style={{ color: colors.inkMuted, letterSpacing: 0.8 }}
            >
              Teams
            </Text>
            {archivedTeams.map((team) => (
              <Card key={team.id} className="mb-3 gap-2">
                <View className="flex-row items-center gap-3">
                  <Avatar uri={team.logoUrl} first={team.name} last="" size={40} />
                  <View className="flex-1">
                    <Text className="text-lg font-display font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                      {team.name}
                    </Text>
                    {team.season ? (
                      <Text className="text-sm" numberOfLines={1} style={{ color: colors.inkMuted }}>
                        {team.season}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View className="flex-row gap-2 mt-2">
                  <Badge
                    label={team.archivedReason === 'plan_downgrade' ? 'Archived · plan change' : 'Archived'}
                    variant="warning"
                  />
                  <Button
                    label="Restore"
                    size="sm"
                    loading={restoringId === team.id}
                    disabled={busy}
                    onPress={() => handleRestoreTeam(team.id)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
