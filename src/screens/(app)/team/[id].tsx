import { useState } from 'react';
import { Text, View, Alert, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, ErrorState, Header, Input, LoadingState, Modal, Screen } from '@/components/ui';
import { useTeamsQuery, useTryoutsQuery, useUpdateTeamMutation, useDeleteTeamMutation, useUpdateTryoutMutation, useGenerateTestDataMutation, useClearTestDataMutation, useTeamRosterQuery, useAddTeamRosterPlayersMutation, useRemoveTeamRosterPlayerMutation } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { canUseFeature } from '@/data/plans';
import { DummyDataModal } from '@/components/DummyDataModal';
import type { DummyDataOptions } from '@/data/testDataGenerator';

export default function TeamDetailScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const updateTryout = useUpdateTryoutMutation();
  const user = useUser();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showDummy, setShowDummy] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [pickedAthletes, setPickedAthletes] = useState<Set<string>>(new Set());

  const rosterQuery = useTeamRosterQuery(id);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);

  // A team has no roster table of its own — its players are the participants of
  // the assessments linked to it. Resolve the target assessment before the early
  // returns below so these hooks stay unconditional.
  const linkedForHooks = (tryoutsQuery.data ?? []).filter((t) => t.teamId === id);
  const dummyTarget = linkedForHooks[0];
  const genTest = useGenerateTestDataMutation(dummyTarget?.id ?? '');
  const clearTest = useClearTestDataMutation(dummyTarget?.id ?? '');

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading team..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="Team" showBack />
        <ErrorState
          message="Could not load team."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === id);
  if (!team) {
    return (
      <Screen scroll>
        <Header title="Team" showBack />
        <ErrorState message="Team not found." onRetry={() => teamsQuery.refetch()} />
      </Screen>
    );
  }

  const linkedTryouts = (tryoutsQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutsQuery.data ?? []).filter((t) => !t.teamId);
  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const teamPlayers = rosterQuery.data ?? [];
  const onRoster = new Set(teamPlayers.map((p) => p.athleteId));

  // Candidates for the picker: every athlete on any assessment's roster, from
  // ALL assessments (not just this team's), deduped. Athletes already on the
  // team are kept in the list and flagged rather than hidden, so it's obvious
  // they're accounted for instead of looking like they went missing.
  const candidates: {
    athleteId: string;
    first: string;
    last: string;
    jersey?: string;
    pos?: string;
    tryoutId: string;
    tryoutName: string;
    alreadyOnTeam: boolean;
  }[] = [];
  const seenCandidates = new Set<string>();
  for (const t of tryoutsQuery.data ?? []) {
    for (const p of t.roster ?? []) {
      const athleteId = p.athleteId;
      if (!athleteId || seenCandidates.has(athleteId)) continue;
      seenCandidates.add(athleteId);
      candidates.push({
        athleteId,
        first: p.first,
        last: p.last,
        jersey: p.jersey,
        pos: p.pos,
        tryoutId: t.id,
        tryoutName: t.name,
        alreadyOnTeam: onRoster.has(athleteId),
      });
    }
  }
  // Already-on-team entries sink to the bottom so the actionable ones lead.
  candidates.sort((a, b) => Number(a.alreadyOnTeam) - Number(b.alreadyOnTeam));
  const availableCount = candidates.filter((c) => !c.alreadyOnTeam).length;

  const addPickedPlayers = async () => {
    const entries = candidates
      .filter((c) => pickedAthletes.has(c.athleteId))
      .map((c) => ({
        athleteId: c.athleteId,
        jersey: c.jersey,
        pos: c.pos,
        sourceTryoutId: c.tryoutId,
      }));
    if (entries.length === 0) return;
    try {
      await addRosterPlayers.mutateAsync(entries);
      setPickedAthletes(new Set());
      setShowAddPlayers(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add players to the team.');
    }
  };

  const confirmRemovePlayer = (athleteId: string, label: string) => {
    Alert.alert('Remove Player', `Remove ${label} from ${team.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeRosterPlayer.mutate(athleteId),
      },
    ]);
  };

  const runDummy = async (options: DummyDataOptions) => {
    try {
      const res = await genTest.mutateAsync(options);
      setShowDummy(false);
      Alert.alert(
        'Dummy data added',
        `Added ${res.players} players and ${res.evaluations} evaluations to ${dummyTarget?.name}.`,
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message === 'NO_RUBRICS'
        ? 'Add at least one rubric to that assessment before generating scored players.'
        : e?.message || 'Failed to generate dummy data.');
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearTest.mutateAsync();
      Alert.alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to clear dummy data.');
    }
  };

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    await updateTeam.mutateAsync({ id: team.id, updates: { name: name.trim(), season: season.trim() || undefined } });
    setEditing(false);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Team',
      'Are you sure you want to delete this team? This action cannot be undone and will delete all associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTeam.mutateAsync(team.id);
            navigation.replace('DashboardMain');
          },
        },
      ]
    );
  };

  return (
    <Screen scroll>
      <Header title={team.name} showBack />
      <Card accent className="mt-4 mb-4 gap-2">
        {editing ? (
          <View className="gap-3">
            <Input label="Team name" value={name} onChangeText={setName} />
            <Input label="Season" value={season} onChangeText={setSeason} />
            <View className="flex-row gap-2">
              <Button label="Save" onPress={save} loading={updateTeam.isPending} />
              <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
            </View>
          </View>
        ) : (
          <>
            <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
              {team.name}
            </Text>
            {team.season ? (
              <Text style={{ color: colors.inkMuted }}>{team.season}</Text>
            ) : null}
            <Badge label={`${linkedTryouts.length} assessments`} variant="brand" />
            <Button label="Edit Team" variant="secondary" size="sm" onPress={startEdit} />
          </>
        )}
      </Card>

      <Text className="font-display font-bold mb-2" style={{ color: colors.ink }}>
        Linked Assessments
      </Text>
      {linkedTryouts.length === 0 ? (
        <Text style={{ color: colors.inkMuted }}>No assessments linked to this team yet.</Text>
      ) : (
        linkedTryouts.map((t) => (
          <Card key={t.id} className="mb-2">
            <Button
              label={t.name}
              variant="ghost"
              onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: t.id } })}
            />
          </Card>
        ))
      )}

      <View className="flex-row gap-2 mt-4">
        <Button
          label="Create Assessment"
          className="flex-1"
          onPress={() => navigation.navigate('NewAssessment')}
        />
        <Button
          label="Attach Assessment"
          variant="secondary"
          className="flex-1"
          onPress={() => setShowAttachModal(true)}
        />
      </View>

      <View className="flex-row items-center justify-between mt-6 mb-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Players
        </Text>
        <Badge label={`${teamPlayers.length}`} variant={teamPlayers.length ? 'brand' : 'default'} />
      </View>
      {rosterQuery.isLoading ? (
        <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading roster...</Text>
      ) : teamPlayers.length === 0 ? (
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          No players on this team yet — add them from any assessment below.
        </Text>
      ) : (
        teamPlayers.map((p) => (
          <Card key={p.id} className="mb-2 flex-row items-center gap-3">
            <Avatar first={p.first} last={p.last} size={36} pos={p.pos} />
            <View className="flex-1">
              <Text className="font-bold" style={{ color: colors.ink }}>
                {p.first} {p.last}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                {[p.jersey ? `#${p.jersey}` : null, p.pos, p.sourceTryoutName].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Button
              label="Remove"
              size="sm"
              variant="ghost"
              onPress={() => confirmRemovePlayer(p.athleteId, `${p.first} ${p.last}`)}
            />
          </Card>
        ))
      )}

      <Button
        label="Add Players from Assessments"
        variant="secondary"
        className="mt-2"
        onPress={() => {
          setPickedAthletes(new Set());
          setShowAddPlayers(true);
        }}
      />

      {isAssociation ? (
        <Card className="mt-6 gap-2">
          <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Testing Tools
          </Text>
          {dummyTarget ? (
            <>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Generate dummy players — optionally scored — into{' '}
                <Text className="font-bold">{dummyTarget.name}</Text>. They appear in Players above.
              </Text>
              <View className="flex-row flex-wrap gap-2 mt-1">
                <Button label="Dummy Players" size="sm" onPress={() => setShowDummy(true)} />
                <Button
                  label="Clear Dummy Data"
                  size="sm"
                  variant="ghost"
                  loading={clearTest.isPending}
                  onPress={runClearDummy}
                />
              </View>
            </>
          ) : (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Link an assessment to this team first — dummy players are added to an assessment's
              roster, which is what fills the Players list above.
            </Text>
          )}
        </Card>
      ) : null}

      <Card className="mt-6 gap-2">
        <Text className="font-bold" style={{ color: colors.danger }}>Danger Zone</Text>
        <Button label="Delete Team" variant="danger" onPress={handleDelete} loading={deleteTeam.isPending} />
      </Card>

      <Modal visible={showAttachModal} title="Attach Assessment" onClose={() => setShowAttachModal(false)}>
        <View style={{ gap: 2 }}>
          {unlinkedTryouts.length === 0 ? (
            <Text style={{ color: colors.inkMuted, padding: 12 }}>No assessments available to link.</Text>
          ) : (
            unlinkedTryouts.map((t) => (
              <Pressable
                key={t.id}
                onPress={async () => {
                  try {
                    await updateTryout.mutateAsync({ id: t.id, updates: { teamId: team.id } });
                    setShowAttachModal(false);
                  } catch (e: any) {
                    Alert.alert('Error', e.message || 'Could not link assessment.');
                  }
                }}
                style={({ pressed }) => [
                  {
                    padding: 12,
                    backgroundColor: pressed ? colors.border : 'transparent',
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }
                ]}
              >
                <Text className="font-bold" style={{ color: colors.ink }}>{t.name}</Text>
                <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
                  {t.sport} · {t.roster.length} players
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </Modal>

      <Modal
        visible={showAddPlayers}
        title="Add Players from Assessments"
        onClose={() => setShowAddPlayers(false)}
        footer={
          <View className="mt-4">
            <Button
              label={pickedAthletes.size === 0 ? 'Select players to add' : `Add ${pickedAthletes.size} to ${team.name}`}
              disabled={pickedAthletes.size === 0}
              loading={addRosterPlayers.isPending}
              onPress={addPickedPlayers}
            />
          </View>
        }
      >
        {candidates.length === 0 ? (
          <Text className="text-sm py-3" style={{ color: colors.inkMuted }}>
            No assessments have players yet — add players to an assessment roster first.
          </Text>
        ) : (
          <View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs flex-1 pr-2" style={{ color: colors.inkMuted }}>
                Athletes from all of your assessments. Tap to select.
              </Text>
              {availableCount > 0 ? (
                <Pressable
                  onPress={() =>
                    setPickedAthletes((prev) =>
                      prev.size === availableCount
                        ? new Set()
                        : new Set(candidates.filter((c) => !c.alreadyOnTeam).map((c) => c.athleteId)),
                    )
                  }
                  hitSlop={8}
                >
                  <Text className="text-xs font-bold" style={{ color: colors.primary }}>
                    {pickedAthletes.size === availableCount ? 'Clear all' : 'Select all'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {candidates.map((c) => {
              const picked = pickedAthletes.has(c.athleteId);
              return (
                <Pressable
                  key={c.athleteId}
                  disabled={c.alreadyOnTeam}
                  onPress={() =>
                    setPickedAthletes((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.athleteId)) next.delete(c.athleteId);
                      else next.add(c.athleteId);
                      return next;
                    })
                  }
                  className="flex-row items-center gap-3 py-3 px-2 rounded-md border mb-2"
                  style={{
                    borderColor: picked ? colors.primary : colors.border,
                    backgroundColor: picked ? 'rgba(255,107,43,0.12)' : 'transparent',
                    opacity: c.alreadyOnTeam ? 0.5 : 1,
                  }}
                >
                  <Avatar first={c.first} last={c.last} size={32} pos={c.pos} />
                  <View className="flex-1">
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {c.first} {c.last}
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {[c.jersey ? `#${c.jersey}` : null, c.pos, c.tryoutName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {c.alreadyOnTeam ? (
                    <Badge label="On Team" variant="success" />
                  ) : picked ? (
                    <Badge label="Selected" variant="brand" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </Modal>

      <DummyDataModal
        variant="assessment"
        visible={showDummy}
        loading={genTest.isPending}
        hasRubrics={(dummyTarget?.settings.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowDummy(false);
          if (dummyTarget) {
            navigation.navigate('AssessmentFlow', {
              screen: 'AssessmentRubrics',
              params: { id: dummyTarget.id },
            });
          }
        }}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
    </Screen>
  );
}
