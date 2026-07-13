import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';

export default function SeasonHubScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const seasonQuery = useSeasonQuery(id);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return (
      <Screen scroll>
        <Header title="Season" showBack />
        <ErrorState message="Could not load season hub." onRetry={() => seasonQuery.refetch()} />
      </Screen>
    );
  }
  const season = seasonQuery.data;

  const upcoming = [...season.events]
    .filter((e) => e.date >= new Date().toISOString().split('T')[0])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return (
    <Screen scroll>
      <Header title="Season Hub" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
          {season.teamName}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {season.sport} · {season.year} · {season.division ?? '—'}
        </Text>
        {season.coach ? <Text style={{ color: colors.inkFaint }}>Coach: {season.coach}</Text> : null}
      </Card>

      <View className="flex-row gap-2 mb-4">
        <Badge label={`${season.roster.length} players`} variant="brand" />
        <Badge label={`${season.events.length} events`} />
      </View>

      <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
        Upcoming Events
      </Text>
      {upcoming.length === 0 ? (
        <Card className="mb-4">
          <Text style={{ color: colors.inkMuted }}>No upcoming events. Add one in Schedule.</Text>
        </Card>
      ) : (
        upcoming.map((ev) => (
          <Card key={ev.id} className="mb-2">
            <View className="flex-row justify-between">
              <Text className="font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
              <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {ev.date} · {ev.startTime ?? '—'} · {ev.location ?? 'TBD'}
            </Text>
          </Card>
        ))
      )}

      <Button label="Add Event" variant="secondary" onPress={() => navigation.navigate('SeasonSchedule', { id: id })} />
    </Screen>
  );
}
