import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery, useSetAvailabilityMutation } from '@/features/queries';

const RESPONSE_VARIANT = {
  yes: 'success' as const,
  maybe: 'warning' as const,
  no: 'danger' as const,
  pending: 'default' as const,
};

export default function SeasonAvailabilityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const setAvailability = useSetAvailabilityMutation(id!);

  if (seasonQuery.isLoading) return <LoadingState />;
  const season = seasonQuery.data!;

  return (
    <Screen padded={false}>
      <FlatList
        data={season.events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item: event }) => (
          <Card className="mb-4 gap-3">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              {event.title} · {event.date}
            </Text>
            {season.roster.map((player) => {
              const response = (event.availability?.[player.id] ?? 'pending') as keyof typeof RESPONSE_VARIANT;
              return (
                <View key={player.id} className="gap-2 border-b pb-2" style={{ borderColor: colors.border }}>
                  <View className="flex-row justify-between items-center">
                    <Text style={{ color: colors.ink }}>
                      {player.firstName} {player.lastName}
                    </Text>
                    <Badge label={response} variant={RESPONSE_VARIANT[response]} />
                  </View>
                  <View className="flex-row gap-2">
                    {(['yes', 'maybe', 'no'] as const).map((r) => (
                      <Button
                        key={r}
                        label={r}
                        size="sm"
                        variant={response === r ? 'primary' : 'ghost'}
                        onPress={() =>
                          setAvailability.mutate({ eventId: event.id, playerId: player.id, response: r })
                        }
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      />
    </Screen>
  );
}
