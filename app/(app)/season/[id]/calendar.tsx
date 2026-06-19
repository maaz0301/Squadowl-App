import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';

export default function SeasonCalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);

  if (seasonQuery.isLoading) return <LoadingState />;
  const season = seasonQuery.data!;

  const byMonth = season.events.reduce<Record<string, typeof season.events>>((acc, ev) => {
    const month = ev.date.slice(0, 7);
    if (!acc[month]) acc[month] = [];
    acc[month].push(ev);
    return acc;
  }, {});

  return (
    <Screen scroll padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, events]) => (
            <View key={month} className="mb-6">
              <Text className="text-lg font-display font-bold mb-3" style={{ color: colors.primary }}>
                {month}
              </Text>
              {events
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((ev) => (
                  <Card key={ev.id} className="mb-2 flex-row gap-3 items-center">
                    <View className="w-12 items-center">
                      <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
                        {ev.date.slice(8)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
                      <Text className="text-sm" style={{ color: colors.inkMuted }}>
                        {ev.startTime ?? '—'} · {ev.location ?? 'TBD'}
                      </Text>
                    </View>
                    <Badge label={ev.type} />
                  </Card>
                ))}
            </View>
          ))}
      </ScrollView>
    </Screen>
  );
}
