import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { computePlayerResults } from '@/data/scoring';

export default function CombineScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutsQuery = useTryoutsQuery(false);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const setCombineTryoutIds = useSessionStore((s) => s.setCombineTryoutIds);

  const combined = useMemo(() => {
    if (!tryoutsQuery.data || combineIds.length < 2) return [];
    const selected = tryoutsQuery.data.filter((t) => combineIds.includes(t.id));
    const rows: { name: string; sport: string; avg: number; count: number }[] = [];
    for (const t of selected) {
      const results = computePlayerResults(t);
      const avg = results.length
        ? results.reduce((sum, r) => sum + r.overall, 0) / results.length
        : 0;
      rows.push({ name: t.name, sport: t.sport, avg, count: results.length });
    }
    return rows.sort((a, b) => b.avg - a.avg);
  }, [tryoutsQuery.data, combineIds]);

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="Combine Assessments" showBack />
        <ErrorState
          message="Could not load assessments."
          onRetry={() => tryoutsQuery.refetch()}
        />
      </Screen>
    );
  }

  if (combineIds.length < 2) {
    return (
      <Screen scroll>
        <Header title="Combine Assessments" showBack />
        <EmptyState
          title="Select 2+ assessments"
          message="From the dashboard, tap Combine mode and select assessments to compare side-by-side."
          actionLabel="Go to Dashboard"
          onAction={() => navigation.replace('/(app)/dashboard')}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Combined View" subtitle={`${combineIds.length} assessments`} showBack />
        <Card accent className="mb-4 gap-2">
          <Text style={{ color: colors.inkMuted }}>
            Cross-assessment comparison using average overall scores (mock aggregate).
          </Text>
          <Button label="Clear Selection" variant="ghost" size="sm" onPress={() => setCombineTryoutIds([])} />
        </Card>
      </View>
      <FlatList
        data={combined}
        keyExtractor={(item) => item.name}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        renderItem={({ item, index }) => (
          <Card className="mb-2 flex-row justify-between items-center">
            <View>
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                #{index + 1} {item.name}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {item.sport} · {item.count} scored
              </Text>
            </View>
            <Badge label={item.avg.toFixed(1)} variant="brand" />
          </Card>
        )}
      />
    </Screen>
  );
}
