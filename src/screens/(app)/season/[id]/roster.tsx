import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, Screen } from '@/components/ui';
import { useSeasonQuery, useAddSeasonPlayerMutation } from '@/features/queries';

export default function SeasonRosterScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const seasonQuery = useSeasonQuery(id);
  const addPlayer = useAddSeasonPlayerMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jersey, setJersey] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  if (seasonQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => seasonQuery.refetch()} />;
  }

  const season = seasonQuery.data;

  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    await addPlayer.mutateAsync({
      seasonId: id!,
      player: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jersey: jersey.trim() || undefined,
        guardianEmail: guardianEmail.trim() || undefined,
      },
    });
    setFirstName('');
    setLastName('');
    setJersey('');
    setGuardianEmail('');
    setShowAdd(false);
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={season.roster}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            title="No roster players"
            message="Import from assessments or add manually."
            actionLabel="Add Player"
            onAction={() => setShowAdd(true)}
          />
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('SeasonPlayer', { id: id, playerId: item.id })}>
            <Card className="mb-2 flex-row justify-between items-center">
              <View>
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  #{item.jersey ?? '—'} · {item.guardianEmail ?? 'No guardian email'}
                </Text>
              </View>
              {item.portalInviteSentAt ? (
                <Badge label="Portal invited" variant="success" />
              ) : (
                <Badge label="No invite" variant="warning" />
              )}
            </Card>
          </Pressable>
        )}
      />

      <View className="absolute bottom-6 left-4 right-4">
        <Button label="+ Add Player" onPress={() => setShowAdd(true)} />
      </View>

      <Modal visible={showAdd} title="Add Season Player" onClose={() => setShowAdd(false)}>
        <View className="gap-3">
          <Input label="First name" value={firstName} onChangeText={setFirstName} />
          <Input label="Last name" value={lastName} onChangeText={setLastName} />
          <Input label="Jersey" value={jersey} onChangeText={setJersey} />
          <Input label="Guardian email" value={guardianEmail} onChangeText={setGuardianEmail} autoCapitalize="none" />
          <Button label="Add to Roster" onPress={handleAdd} loading={addPlayer.isPending} />
        </View>
      </Modal>
    </Screen>
  );
}
