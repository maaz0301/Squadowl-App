import { useState } from 'react';
import { Text, View, Alert, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, Input, LoadingState, Modal, Screen } from '@/components/ui';
import { useTeamsQuery, useTryoutsQuery, useUpdateTeamMutation, useDeleteTeamMutation, useUpdateTryoutMutation } from '@/features/queries';

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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);

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
    </Screen>
  );
}
