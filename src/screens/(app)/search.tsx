import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, EmptyState, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useSeasonsQuery, useTryoutsQuery } from '@/features/queries';
import { globalSearch } from '@/data/extras';
import { useSessionStore } from '@/state/sessionStore';

export default function SearchScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const tryoutsQuery = useTryoutsQuery(true);
  const seasonsQuery = useSeasonsQuery();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  const results = useMemo(() => {
    if (!tryoutsQuery.data) return { assessments: [], players: [], seasons: [] };
    const seasons = (seasonsQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      teamName: s.teamName,
    }));
    return globalSearch(tryoutsQuery.data, seasons, query);
  }, [tryoutsQuery.data, seasonsQuery.data, query]);

  if (tryoutsQuery.isLoading || seasonsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutsQuery.isError || seasonsQuery.isError) {
    return (
      <Screen padded>
        <Header title="Search" showBack />
        <ErrorState
          message="Could not load search data."
          onRetry={() => {
            tryoutsQuery.refetch();
            seasonsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const hasQuery = query.trim().length > 0;
  const empty = !results.assessments.length && !results.players.length && !results.seasons.length;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Search" showBack />
        <Input
          label="Search assessments, players, seasons"
          value={query}
          onChangeText={setQuery}
          placeholder="Tryout name, player, team..."
          autoFocus
        />
      </View>

      {!hasQuery ? (
        <View className="px-4">
          <EmptyState title="Start typing" message="Search across assessments, rosters, and seasons." />
        </View>
      ) : empty ? (
        <View className="px-4">
          <EmptyState title="No results" message={`Nothing matched "${query.trim()}".`} />
        </View>
      ) : (
        <FlatList
          data={[
            ...results.assessments.map((a) => ({ type: 'assessment' as const, ...a })),
            ...results.players.map((p) => ({ type: 'player' as const, ...p })),
            ...results.seasons.map((s) => ({ type: 'season' as const, ...s })),
          ]}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                if (item.type === 'assessment') {
                  setCurrentTryout(item.id);
                  navigation.navigate(`/(app)/assessment/${item.id}/roster`);
                } else if (item.type === 'player') {
                  setCurrentTryout(item.tryoutId);
                  navigation.navigate(`/(app)/assessment/${item.tryoutId}/player/${item.id}`);
                } else {
                  navigation.navigate(`/(app)/season/${item.id}`);
                }
              }}
            >
              <Card className="mb-2">
                <Text className="text-xs uppercase font-bold mb-1" style={{ color: colors.inkMuted }}>
                  {item.type}
                </Text>
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  {'name' in item && item.type !== 'player' ? item.name : (item as { name: string }).name}
                </Text>
                {item.type === 'player' ? (
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {(item as { tryoutName: string }).tryoutName}
                  </Text>
                ) : null}
                {item.type === 'season' ? (
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {(item as { teamName: string }).teamName}
                  </Text>
                ) : null}
                {item.type === 'assessment' ? (
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {(item as { sport: string }).sport}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
