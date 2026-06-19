import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';

export default function SeasonAttendanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);

  const stats = useMemo(() => {
    const season = seasonQuery.data;
    if (!season) return [];
    return season.roster.map((player) => {
      let yes = 0;
      let maybe = 0;
      let no = 0;
      let pending = 0;
      for (const event of season.events) {
        const resp = event.availability?.[player.id] ?? 'pending';
        if (resp === 'yes') yes++;
        else if (resp === 'maybe') maybe++;
        else if (resp === 'no') no++;
        else pending++;
      }
      const total = season.events.length || 1;
      const rate = Math.round((yes / total) * 100);
      return { player, yes, maybe, no, pending, rate };
    });
  }, [seasonQuery.data]);

  if (seasonQuery.isLoading) return <LoadingState message="Loading attendance..." />;

  const season = seasonQuery.data!;

  return (
    <Screen padded={false}>
      <View className="px-4 py-3">
        <Card accent className="gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Attendance Overview
          </Text>
          <Text style={{ color: colors.inkMuted }}>
            Based on availability responses across {season.events.length} events.
          </Text>
        </Card>
      </View>
      <FlatList
        data={stats}
        keyExtractor={(item) => item.player.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState title="No roster" message="Add players to track attendance." />
        }
        renderItem={({ item }) => (
          <Card className="mb-2 flex-row justify-between items-center">
            <View>
              <Text className="font-bold" style={{ color: colors.ink }}>
                {item.player.firstName} {item.player.lastName}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Yes {item.yes} · Maybe {item.maybe} · No {item.no}
              </Text>
            </View>
            <Badge
              label={`${item.rate}%`}
              variant={item.rate >= 80 ? 'success' : item.rate >= 50 ? 'warning' : 'danger'}
            />
          </Card>
        )}
      />
    </Screen>
  );
}
