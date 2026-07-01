import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useTeamsQuery, useTryoutsQuery, useUpdateTeamMutation } from '@/features/queries';

export default function TeamDetailScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const updateTeam = useUpdateTeamMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');

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

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    await updateTeam.mutateAsync({ id: team.id, updates: { name: name.trim(), season: season.trim() || undefined } });
    setEditing(false);
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
              onPress={() => navigation.navigate('AssessmentRoster', { id: t.id })}
            />
          </Card>
        ))
      )}

      <Button
        label="Create Assessment for Team"
        className="mt-4"
        onPress={() => navigation.navigate('NewAssessment')}
      />
    </Screen>
  );
}
