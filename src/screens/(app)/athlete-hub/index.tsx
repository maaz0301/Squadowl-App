import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Avatar, Card, EmptyState, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useAthleteHubQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { playerDisplayName } from '@/data/rubrics';
import { foldAthletes } from '@/data/duplicates';

/**
 * Every athlete under this subscription, whichever team or evaluation they came
 * in through, in one searchable list. Replaces the old Shared Athletes screen,
 * which only listed profiles guardians pushed to a coach.
 */
export default function AthleteHubScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  // The search runs on the server, so wait for a pause in typing.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const hubQuery = useAthleteHubQuery(search);
  // The same player added to several evaluations is several athlete records; show them once.
  const athletes = useMemo(() => foldAthletes(hubQuery.data?.pages.flatMap((p) => p.rows) ?? []), [hubQuery.data]);

  const header = (
    <View className="px-4">
      <Header title="Athlete Hub" showBack />
      <Input placeholder="Search by name or guardian" value={query} onChangeText={setQuery} autoCapitalize="none" />
    </View>
  );

  if (hubQuery.isError && athletes.length === 0) {
    return (
      <Screen padded={false}>
        {header}
        <ErrorState message="Could not load athletes." onRetry={() => hubQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {header}
      {hubQuery.isLoading ? (
        <LoadingState message="Loading athletes..." />
      ) : (
        <FlatList
          data={athletes}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => {
            if (hubQuery.hasNextPage && !hubQuery.isFetchingNextPage) void hubQuery.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, flexGrow: 1 }}
          ListFooterComponent={hubQuery.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
          ListEmptyComponent={
            <EmptyState
              title={search ? 'No matches' : 'No athletes yet'}
              message={
                search ? 'Try a different name.' : 'Players added to your teams and evaluations show up here.'
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('PlayerProfile', { athleteId: item.id, alsoAthleteIds: item.alsoIds })}>
              <Card className="mb-2 flex-row items-center gap-3">
                <Avatar first={item.first} last={item.last} pos={item.currentPosition} size={44} uri={item.avatarUrl} />
                <View className="flex-1">
                  <Text className="font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                    {playerDisplayName(item)}
                  </Text>
                  <Text className="text-sm" numberOfLines={1} style={{ color: colors.inkMuted }}>
                    {[item.currentPosition, item.guardianName].filter(Boolean).join(' · ') || 'Athlete'}
                  </Text>
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
